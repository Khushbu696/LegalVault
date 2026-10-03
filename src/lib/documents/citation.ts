import type { PageRange } from "@/lib/repositories/types";

export interface QuoteOccurrence {
  startOffset: number;
  endOffset: number;
  matchedText: string;
  pageStart: number | null;
  pageEnd: number | null;
  occurrenceIndex: number;
  occurrenceCount: number;
  contextScore: number;
}

export function normalizeForQuoteSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\u2019/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function pageForOffset(offset: number, pageRanges: PageRange[]): number | null {
  if (pageRanges.length === 0) return null;
  for (const range of pageRanges) {
    if (offset >= range.start && offset <= range.end) return range.page;
  }
  return pageRanges[pageRanges.length - 1]?.page ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTolerancePattern(quote: string): RegExp {
  const words = quote.trim().split(/\s+/).filter(Boolean).map((word) => escapeRegExp(word));
  if (words.length === 0) return /$^/giu;
  const body = words.join("(?:\\s+|\\s*[\\p{P}]*\\s*)");
  return new RegExp(body, "giu");
}

function precedingContext(documentText: string, startOffset: number): string {
  const radius = 180;
  return documentText.slice(Math.max(0, startOffset - radius), startOffset);
}

export function locateQuoteOccurrence(
  documentText: string,
  quote: string,
  pageRanges: PageRange[] = [],
  options: { contextText?: string; preferredPage?: number | null } = {},
): QuoteOccurrence | null {
  const cleanQuote = quote.trim();
  if (!cleanQuote || !documentText) return null;

  const normalizedQuote = normalizeForQuoteSearch(cleanQuote);
  const contextText = options.contextText ? options.contextText.trim() : "";
  const contextTokens = contextText ? normalizeForQuoteSearch(contextText).split(/\s+/).filter(Boolean) : [];

  const matchCandidates: Array<{ start: number; end: number; text: string; normalized: string }> = [];
  const exactIndex = documentText.indexOf(cleanQuote);
  if (exactIndex >= 0) {
    matchCandidates.push({ start: exactIndex, end: exactIndex + cleanQuote.length, text: cleanQuote, normalized: normalizeForQuoteSearch(cleanQuote) });
  }

  const pattern = buildTolerancePattern(cleanQuote);
  for (const match of documentText.matchAll(pattern)) {
    const start = match.index ?? 0;
    const text = match[0] ?? "";
    if (!text.trim()) continue;
    const current = { start, end: start + text.length, text, normalized: normalizeForQuoteSearch(text) };
    if (!matchCandidates.some((candidate) => candidate.start === current.start && candidate.end === current.end)) {
      matchCandidates.push(current);
    }
  }

  const ranked = matchCandidates
    .filter((candidate) => candidate.normalized === normalizedQuote || candidate.normalized.includes(normalizedQuote) || normalizedQuote.includes(candidate.normalized))
    .map((candidate) => {
      const preceding = precedingContext(documentText, candidate.start);
      const normalizedPreceding = normalizeForQuoteSearch(preceding);
      const contextualText = contextText ? normalizeForQuoteSearch(contextText) : "";
      const headingReference = contextText.match(/(?:section|clause|article)\s*\d+(?:\.\d+)*/i)?.[0] ?? "";
      const normalizedHeadingReference = headingReference ? normalizeForQuoteSearch(headingReference) : "";

      let contextScore = 0;
      if (contextTokens.length > 0) {
        contextScore = contextTokens.reduce((sum, token) => sum + (normalizedPreceding.includes(token) ? 1 : 0), 0);
      }
      if (contextualText && normalizedPreceding.includes(contextualText)) contextScore += 50;
      if (normalizedHeadingReference && normalizedPreceding.includes(normalizedHeadingReference)) contextScore += 100;

      const pageStart = pageForOffset(candidate.start, pageRanges);
      const pageEnd = pageForOffset(Math.max(candidate.start, candidate.end - 1), pageRanges);
      const preferredPenalty = options.preferredPage != null && pageStart !== null
        ? Math.abs(pageStart - options.preferredPage)
        : 0;
      return {
        ...candidate,
        pageStart,
        pageEnd,
        occurrenceIndex: 0,
        occurrenceCount: 0,
        contextScore: contextScore - preferredPenalty,
      };
    })
    .sort((a, b) => {
      if (b.contextScore !== a.contextScore) return b.contextScore - a.contextScore;
      if ((a.pageStart ?? Number.MAX_SAFE_INTEGER) !== (b.pageStart ?? Number.MAX_SAFE_INTEGER)) {
        return (a.pageStart ?? Number.MAX_SAFE_INTEGER) - (b.pageStart ?? Number.MAX_SAFE_INTEGER);
      }
      return a.start - b.start;
    });

  if (ranked.length === 0) return null;

  const best = ranked[0];
  const allMatches = matchCandidates.filter((candidate) => candidate.normalized === normalizedQuote || candidate.normalized.includes(normalizedQuote) || normalizedQuote.includes(candidate.normalized));
  const occurrenceIndex = allMatches.findIndex((candidate) => candidate.start === best.start && candidate.end === best.end);

  return {
    startOffset: best.start,
    endOffset: best.end,
    matchedText: best.text,
    pageStart: best.pageStart,
    pageEnd: best.pageEnd,
    occurrenceIndex: occurrenceIndex >= 0 ? occurrenceIndex : 0,
    occurrenceCount: allMatches.length || 1,
    contextScore: best.contextScore,
  };
}
