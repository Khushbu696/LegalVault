import type { PageRange, QuoteRecord } from "@/lib/repositories/types";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTolerancePattern(quote: string): RegExp {
  const words = quote.trim().split(/\s+/).filter(Boolean).map((word) => escapeRegExp(word));
  if (words.length === 0) return /$^/g;
  const body = words.join("(?:\\s+|\\s*[\\p{P}]*\\s*)");
  return new RegExp(body, "giu");
}

function pageForOffset(offset: number, pageRanges: PageRange[]): number | null {
  if (pageRanges.length === 0) return null;
  for (let i = 0; i < pageRanges.length; i++) {
    const range = pageRanges[i];
    if (offset >= range.start && offset <= range.end) return range.page;
  }
  return pageRanges[pageRanges.length - 1].page;
}

export function verifyQuoteAgainstDocument(
  documentText: string,
  quote: string,
  pageRanges: PageRange[] = [],
): QuoteRecord {
  const cleanQuote = quote.trim();
  const normalizedQuote = normalizeForQuoteSearch(cleanQuote);

  if (!cleanQuote) {
    return {
      ordinal: 0,
      quoteText: "",
      normalizedQuote: "",
      status: "unverified",
      matchType: null,
      startOffset: null,
      endOffset: null,
      matchedText: null,
      occurrenceCount: 0,
      occurrenceIndex: null,
      chunkId: null,
      pageStart: null,
      reason: "No quote provided.",
    };
  }

  const exactIndex = documentText.indexOf(cleanQuote);
  const pattern = buildTolerancePattern(cleanQuote);
  const matches = [...documentText.matchAll(pattern)];

  if (matches.length === 0 && exactIndex === -1) {
    return {
      ordinal: 0,
      quoteText: cleanQuote,
      normalizedQuote,
      status: "unverified",
      matchType: null,
      startOffset: null,
      endOffset: null,
      matchedText: null,
      occurrenceCount: 0,
      occurrenceIndex: null,
      chunkId: null,
      pageStart: null,
      reason: "⚠️ Unverified: not found in text",
    };
  }

  const match = matches[0] ?? { index: exactIndex, 0: cleanQuote };
  const startOffset = match.index ?? exactIndex;
  const matchedText = match[0] ?? documentText.slice(startOffset, startOffset + cleanQuote.length);
  const endOffset = startOffset + matchedText.length;
  const occurrenceIndex = matches.findIndex((candidate) => candidate.index === startOffset);
  const matchType = matchedText === cleanQuote ? "exact" : normalizeForQuoteSearch(matchedText) === normalizedQuote ? "whitespace" : "punctuation";

  return {
    ordinal: 0,
    quoteText: cleanQuote,
    normalizedQuote,
    status: "verified",
    matchType,
    startOffset,
    endOffset,
    matchedText,
    occurrenceCount: matches.length || 1,
    occurrenceIndex: occurrenceIndex >= 0 ? occurrenceIndex : 0,
    chunkId: null,
    pageStart: pageForOffset(startOffset, pageRanges),
    reason: "✓ Verified in Text",
  };
}
