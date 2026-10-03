export const MIN_PAGE_CHARS = 20;          // fewer non-whitespace chars than this = page counted as empty
export const MIN_TOTAL_CHARS = 50;         // fewer than this in the whole document = no text at all
export const MIN_READABLE_FRACTION = 0.3;  // below this share of readable pages = mostly scanned

export interface Readability {
  readable: boolean;
  reason?: "NO_TEXT" | "MOSTLY_UNREADABLE";
  /** 1-based pages with no extractable text. A readable document can still have some. */
  emptyPages: number[];
  totalChars: number;
}

const nonWhitespace = (s: string) => s.replace(/\s/g, "").length;

export function assessReadability(pages: string[]): Readability {
  const counts = pages.map(nonWhitespace);
  const totalChars = counts.reduce((a, b) => a + b, 0);
  const emptyPages = counts.flatMap((n, i) => (n < MIN_PAGE_CHARS ? [i + 1] : []));
  if (pages.length === 0 || totalChars < MIN_TOTAL_CHARS) {
    return { readable: false, reason: "NO_TEXT", emptyPages, totalChars };
  }
  const readableFraction = (pages.length - emptyPages.length) / pages.length;
  if (readableFraction < MIN_READABLE_FRACTION) {
    return { readable: false, reason: "MOSTLY_UNREADABLE", emptyPages, totalChars };
  }
  return { readable: true, emptyPages, totalChars };
}
