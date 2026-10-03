import type { ChunkRecord } from "@/lib/repositories/types";

export interface RetrievalSelection {
  chunkIndexes: number[];
  totalChunks: number;
  coverage: "full" | "partial";
  selected: ChunkRecord[];
  documentWide: boolean;
}

const STANDARD_CHUNK_LIMIT = 8;
const DOCUMENT_WIDE_CHUNK_LIMIT = 20;
const STOP_WORDS = new Set([
  "a", "about", "after", "all", "an", "and", "are", "as", "at", "be", "been", "before", "being",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "into", "is", "it", "its", "may", "might", "of", "on", "or", "our", "please",
  "shall", "should", "tell", "than", "that", "the", "their", "there", "these", "they", "this", "those",
  "to", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you",
  "your", "agreement", "clause", "contract", "document", "page", "section",
]);

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildChunkContext(chunks: ChunkRecord[]): string {
  return chunks
    .map((chunk) => {
      const heading = chunk.sectionHeading ? `\n${chunk.sectionHeading}\n` : "";
      return `${heading}Section ${chunk.chunkIndex + 1}\n${chunk.text}`.trim();
    })
    .join("\n\n---\n\n");
}

function questionReference(question: string): { kind: "section" | "page"; value: string } | null {
  const section = question.match(/\b(?:section|clause)\s+(\d+(?:\.\d+)*)\b/i);
  if (section) return { kind: "section", value: section[1] };
  const page = question.match(/\bpage\s+(\d+)\b/i);
  return page ? { kind: "page", value: page[1] } : null;
}

function isDocumentWideQuestion(question: string): boolean {
  return /^(?:does|do|is there|are there|whether)\b/i.test(question.trim()) &&
    /\b(?:contain|include|mention|have|exist|any)\b/i.test(question);
}

function matchesReference(chunk: ChunkRecord, reference: NonNullable<ReturnType<typeof questionReference>>): boolean {
  if (reference.kind === "page") {
    const page = Number(reference.value);
    return chunk.pageStart !== null && chunk.pageEnd !== null && chunk.pageStart <= page && page <= chunk.pageEnd;
  }

  const numberPattern = reference.value.split(".").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\.");
  const pattern = new RegExp(`\\b(?:section|clause)\\s+${numberPattern}(?:\\.\\d+)*(?![\\d.])`, "i");
  return pattern.test(`${chunk.sectionHeading ?? ""}\n${chunk.text}`);
}

function startsWithReferencedHeading(chunk: ChunkRecord, reference: NonNullable<ReturnType<typeof questionReference>>): boolean {
  if (reference.kind !== "section") return false;
  const numberPattern = reference.value.split(".").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\.");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:section|clause)\\s+${numberPattern}(?:\\.\\d+)*(?![\\d.])`, "i");
  return pattern.test(`${chunk.sectionHeading ?? ""}\n${chunk.text}`);
}

function questionTokens(question: string): string[] {
  return normalizeForSearch(question)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreChunks(question: string, chunks: ChunkRecord[]) {
  const tokens = questionTokens(question);
  return chunks.map((chunk) => {
    const text = normalizeForSearch(`${chunk.sectionHeading ?? ""} ${chunk.text}`);
    let score = 0;
    for (const token of tokens) {
      const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      score += (text.match(regex) ?? []).length;
    }
    return { chunk, score };
  });
}

function sampleAcrossDocument(chunks: ChunkRecord[], limit: number): ChunkRecord[] {
  if (chunks.length <= limit) return [...chunks];
  return Array.from({ length: limit }, (_, index) => chunks[Math.floor(index * chunks.length / limit)]);
}

function selectDocumentWideChunks(
  scored: ReturnType<typeof scoreChunks>,
  chunks: ChunkRecord[],
): ChunkRecord[] {
  const limit = Math.min(DOCUMENT_WIDE_CHUNK_LIMIT, chunks.length);
  const selected = new Map<number, ChunkRecord>();
  const ranked = [...scored].filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  if (ranked.length > 0) {
    for (let bucket = 0; bucket < limit; bucket += 1) {
      const start = Math.floor(bucket * chunks.length / limit);
      const end = Math.floor((bucket + 1) * chunks.length / limit);
      const match = scored.slice(start, Math.max(start + 1, end))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)[0];
      if (match) selected.set(match.chunk.chunkIndex, match.chunk);
    }
  }

  for (const entry of ranked) {
    if (selected.size >= limit) break;
    selected.set(entry.chunk.chunkIndex, entry.chunk);
  }
  for (const chunk of sampleAcrossDocument(chunks, limit)) {
    if (selected.size >= limit) break;
    selected.set(chunk.chunkIndex, chunk);
  }

  return [...selected.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export function retrieveRelevantChunks(question: string, chunks: ChunkRecord[]): RetrievalSelection {
  const total = chunks.length;
  const documentWide = isDocumentWideQuestion(question) && questionReference(question) === null;
  if (total === 0) {
    return { chunkIndexes: [], totalChunks: 0, coverage: "partial", selected: [], documentWide };
  }

  const scored = scoreChunks(question, chunks);
  let selected: ChunkRecord[];
  if (documentWide) {
    selected = selectDocumentWideChunks(scored, chunks);
  } else {
    const reference = questionReference(question);
    const targeted = reference
      ? chunks.filter((chunk) => matchesReference(chunk, reference)).sort((a, b) => {
          const headingDifference = Number(startsWithReferencedHeading(b, reference)) - Number(startsWithReferencedHeading(a, reference));
          const scoreDifference = scored.find((entry) => entry.chunk.chunkIndex === b.chunkIndex)!.score -
            scored.find((entry) => entry.chunk.chunkIndex === a.chunkIndex)!.score;
          return headingDifference || scoreDifference || a.chunkIndex - b.chunkIndex;
        })
      : [];
    const ranked = [...scored].sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);
    const limit = Math.min(STANDARD_CHUNK_LIMIT, total);
    const selectedByIndex = new Map<number, ChunkRecord>();
    for (const chunk of targeted) {
      if (selectedByIndex.size >= limit) break;
      selectedByIndex.set(chunk.chunkIndex, chunk);
    }
    for (const entry of ranked) {
      if (selectedByIndex.size >= limit) break;
      if (entry.score > 0) selectedByIndex.set(entry.chunk.chunkIndex, entry.chunk);
    }
    if (selectedByIndex.size === 0) {
      for (const chunk of sampleAcrossDocument(chunks, limit)) selectedByIndex.set(chunk.chunkIndex, chunk);
    }
    selected = [...selectedByIndex.values()];
  }

  return {
    chunkIndexes: selected.map((chunk) => chunk.chunkIndex),
    totalChunks: total,
    coverage: selected.length >= total ? "full" : "partial",
    selected,
    documentWide,
  };
}
