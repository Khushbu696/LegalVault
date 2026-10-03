import type { FileType, PageRange } from "../repositories/types";
import { MESSAGES } from "../documents/messages";
import { buildDocumentText } from "./canonical";
import { extractDocxText } from "./docx";
import { ExtractionError } from "./errors";
import { extractPdfPages } from "./pdf";
import { assessReadability, MIN_TOTAL_CHARS } from "./scanned";

export { ExtractionError } from "./errors";

export interface ExtractedDocument {
  text: string;
  pageRanges: PageRange[]; // empty for DOCX (no page concept)
  emptyPages: number[];
}

export async function extractDocument(
  buf: Buffer,
  fileType: FileType,
  opts: { maxPages: number },
): Promise<ExtractedDocument> {
  if (fileType === "pdf") {
    const pages = await extractPdfPages(buf, opts.maxPages);
    const readability = assessReadability(pages);
    if (!readability.readable) throw new ExtractionError("SCANNED_PDF", MESSAGES.scannedPdf);
    const { text, pageRanges } = buildDocumentText(pages);
    return { text, pageRanges, emptyPages: readability.emptyPages };
  }

  const raw = await extractDocxText(buf);
  if (raw.replace(/\s/g, "").length < MIN_TOTAL_CHARS) {
    throw new ExtractionError("EMPTY_DOCUMENT", MESSAGES.emptyDocument);
  }
  return { text: buildDocumentText([raw]).text, pageRanges: [], emptyPages: [] };
}
