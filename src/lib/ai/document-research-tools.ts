import { buildDocumentChunks } from "@/lib/documents/chunks";
import { normalizeForSearch, retrieveRelevantChunks } from "@/lib/ai/retrieval";
import type { ChunkRecord } from "@/lib/repositories/types";

export interface ResearchSection {
  number: string;
  title: string;
  startOffset: number;
  endOffset: number;
}

export interface DocumentResearchContext {
  documentId: string;
  documentText: string;
  chunks: ChunkRecord[];
}

export type DocumentResearchResult = Record<string, unknown> & { error?: true; message?: string };

const MAX_SEARCH_RESULTS = 4;
const MAX_RESULT_TEXT = 1_800;
const MAX_SECTION_TEXT = 18_000;
const NUMBERED_HEADING = /^[ \t]*(?:(?:section|clause|article)[ \t]+)?(\d+(?:\.\d+)*)(?:[.)])?[ \t]+([A-Z][^\r\n]{0,100}?)(?:\.[ \t]+|[ \t]*$)/gm;
const TOOL_NAMES = new Set(["list_clauses", "search_document", "get_section"]);

export function findNumberedSections(text: string): ResearchSection[] {
  const matches = [...text.matchAll(NUMBERED_HEADING)];
  return matches.map((match, index) => ({
    number: match[1],
    title: match[2].trim().replace(/[.:]+$/, ""),
    startOffset: match.index ?? 0,
    endOffset: matches[index + 1]?.index ?? text.length,
  }));
}

function parseArguments(raw: string): Record<string, unknown> | DocumentResearchResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: true, message: "Malformed tool arguments. Provide valid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: true, message: "Tool arguments must be a JSON object." };
  }
  return value as Record<string, unknown>;
}

function sectionForOffset(sections: ResearchSection[], offset: number): ResearchSection | undefined {
  return sections.find((section) => offset >= section.startOffset && offset < section.endOffset);
}

function sectionForChunk(sections: ResearchSection[], chunk: ChunkRecord): ResearchSection | undefined {
  const section = sectionForOffset(sections, chunk.startOffset);
  return section && chunk.endOffset <= section.endOffset ? section : undefined;
}

function sectionEnd(sections: ResearchSection[], index: number, textLength: number): number {
  const section = sections[index];
  const depth = section.number.split(".").length;
  const next = sections.slice(index + 1).find((candidate) => candidate.number.split(".").length <= depth);
  return next?.startOffset ?? textLength;
}

export function executeDocumentResearchTool(
  name: string,
  rawArguments: string,
  context: DocumentResearchContext,
): DocumentResearchResult {
  if (!TOOL_NAMES.has(name)) return { error: true, message: "Unknown document research tool." };

  const args = parseArguments(rawArguments);
  if ("error" in args && args.error === true) return args;
  if (typeof args.documentId !== "string" || !args.documentId.trim()) {
    return { error: true, message: "A documentId is required." };
  }
  if (args.documentId !== context.documentId) {
    return { error: true, message: "This tool can only access the document selected for this request." };
  }

  const sections = findNumberedSections(context.documentText);
  if (name === "list_clauses") {
    if (sections.length > 0) {
      return {
        sections: sections.slice(0, 100).map(({ number, title }) => ({ number, title })),
        truncated: sections.length > 100,
      };
    }
    const chunks = context.chunks.length > 0
      ? context.chunks
      : buildDocumentChunks(context.documentText);
    return {
      sections: chunks.slice(0, 100).map((chunk) => ({
        number: null,
        title: `Text chunk ${chunk.chunkIndex + 1}`,
        chunkId: "id" in chunk ? chunk.id : null,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      })),
      truncated: chunks.length > 100,
      note: "No explicit numbered clauses were found; these are text chunks, not clause numbers.",
    };
  }

  if (name === "search_document") {
    if (typeof args.query !== "string" || !args.query.trim()) {
      return { error: true, message: "search_document requires a non-empty query." };
    }
    if (args.query.length > 500) {
      return { error: true, message: "Search queries must be 500 characters or fewer." };
    }
    const chunks = context.chunks.length > 0
      ? context.chunks
      : buildDocumentChunks(context.documentText).map((chunk, index) => ({
          ...chunk,
          id: `${context.documentId}-reconstructed-${index}`,
          documentId: context.documentId,
          sectionHeading: chunk.sectionHeading ?? null,
        }));
    const selection = retrieveRelevantChunks(args.query.trim(), chunks);
    const results = selection.selected.slice(0, MAX_SEARCH_RESULTS).map((chunk) => {
      const section = sectionForChunk(sections, chunk);
      const text = chunk.text.slice(0, MAX_RESULT_TEXT);
      return {
        sectionNumber: section?.number ?? null,
        sectionTitle: section?.title ?? chunk.sectionHeading,
        text,
        truncated: chunk.text.length > text.length,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      };
    });
    return {
      results,
      chunkIndexes: results.filter((result) => !result.truncated).map((result) => result.chunkIndex),
      searchedChunks: results.length,
      totalChunks: selection.totalChunks,
      coverage: selection.coverage,
    };
  }

  if (typeof args.sectionNumber !== "string" || !/^\d+(?:\.\d+)*$/.test(args.sectionNumber)) {
    return { error: true, message: "get_section requires a valid numbered section, such as 8 or 8.1." };
  }
  const sectionIndex = sections.findIndex((section) => section.number === args.sectionNumber);
  if (sectionIndex < 0) {
    return { error: true, message: `Section ${args.sectionNumber} was not found in this document.` };
  }
  const section = sections[sectionIndex];
  const endOffset = sectionEnd(sections, sectionIndex, context.documentText.length);
  if (endOffset - section.startOffset > MAX_SECTION_TEXT) {
    return { error: true, message: "This section is too large to retrieve in full. Use search_document for bounded excerpts." };
  }
  return {
    sectionNumber: section.number,
    sectionTitle: section.title,
    text: context.documentText.slice(section.startOffset, endOffset).trim(),
    startOffset: section.startOffset,
    endOffset,
  };
}

export function getFullyCoveredChunkIndexes(chunks: ChunkRecord[], result: DocumentResearchResult): number[] {
  const indexes = new Set<number>();
  if (Array.isArray(result.chunkIndexes)) {
    for (const index of result.chunkIndexes) {
      if (typeof index === "number" && chunks.some((chunk) => chunk.chunkIndex === index)) indexes.add(index);
    }
  }
  if (typeof result.startOffset === "number" && typeof result.endOffset === "number") {
    for (const chunk of chunks) {
      if (result.startOffset <= chunk.startOffset && result.endOffset >= chunk.endOffset) indexes.add(chunk.chunkIndex);
    }
  }
  return [...indexes];
}

export function getCoveredResearchIndexes(
  chunks: ChunkRecord[],
  sections: ResearchSection[],
  result: DocumentResearchResult,
): number[] {
  if (sections.length === 0) return getFullyCoveredChunkIndexes(chunks, result);

  const indexes = new Set<number>();
  const coverRange = (startOffset: number, endOffset: number) => {
    sections.forEach((section, index) => {
      if (section.startOffset >= startOffset && section.endOffset <= endOffset) indexes.add(index);
    });
  };
  if (typeof result.startOffset === "number" && typeof result.endOffset === "number") {
    coverRange(result.startOffset, result.endOffset);
  }
  if (Array.isArray(result.results)) {
    for (const searchResult of result.results) {
      if (!searchResult || typeof searchResult !== "object") continue;
      const item = searchResult as Record<string, unknown>;
      if (item.truncated === false && typeof item.startOffset === "number" && typeof item.endOffset === "number") {
        coverRange(item.startOffset, item.endOffset);
      }
    }
  }
  return [...indexes];
}

export function selectEvidenceQuote(question: string, evidenceTexts: string[]): string | null {
  const ignored = new Set(["about", "after", "all", "also", "an", "and", "are", "as", "at", "be", "been", "before", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "if", "in", "into", "is", "it", "its", "may", "might", "of", "on", "or", "our", "please", "shall", "should", "that", "the", "their", "these", "they", "this", "those", "to", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your"]);
  const terms = normalizeForSearch(question).split(/\s+/).filter((term) => term.length > 2 && !ignored.has(term));
  if (terms.length === 0) return null;
  const relatedTerms: Record<string, string[]> = {
    deadline: ["due", "within", "date", "days"],
    liability: ["liable", "cap", "capped", "limit"],
    cap: ["capped", "limit", "maximum", "exceed"],
    payment: ["pay", "paid", "rent", "invoice", "fee", "due"],
    termination: ["terminate", "terminated", "notice", "end"],
  };
  const searchTerms = new Set(terms.flatMap((term) => [term, ...(relatedTerms[term] ?? [])]));
  const candidates = evidenceTexts
    .flatMap((text) => text.split(/(?<=[.!?])\s+|\n+/))
    .map((text) => text.trim())
    .filter((text) => text.length >= 25 && text.length <= 500)
    .map((text) => {
      const normalized = normalizeForSearch(text);
      const words = new Set(normalized.split(" "));
      const score = [...searchTerms].reduce((total, term) => total + (words.has(term) ? 1 : 0), 0);
      return { text, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.text.length - right.text.length);
  return candidates[0]?.text ?? null;
}