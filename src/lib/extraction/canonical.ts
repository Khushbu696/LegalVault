import type { PageRange } from "../repositories/types";

/**
 * The canonical text is the single source of truth: stored once, chunked once, and every quote
 * offset refers to it. Only line endings and NULs are touched; nothing else is altered.
 */
export function canonicalize(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
}

export function buildDocumentText(pages: string[]): { text: string; pageRanges: PageRange[] } {
  let text = "";
  const pageRanges: PageRange[] = [];
  pages.forEach((page, i) => {
    if (i > 0) text += "\n\n";
    const start = text.length;
    text += canonicalize(page);
    pageRanges.push({ page: i + 1, start, end: text.length });
  });
  return { text, pageRanges };
}
