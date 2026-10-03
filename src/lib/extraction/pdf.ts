import { extractText, getDocumentProxy } from "unpdf";
import { MESSAGES } from "../documents/messages";
import { ExtractionError } from "./errors";

/** Returns one string per page, in order. */
export async function extractPdfPages(buf: Buffer, maxPages: number): Promise<string[]> {
  let pdf;
  try {
    // Copy: pdf.js may take ownership of the bytes it is given.
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") {
      throw new ExtractionError("PASSWORD_PROTECTED", MESSAGES.passwordProtected);
    }
    throw new ExtractionError("CORRUPT_FILE", MESSAGES.corrupt("PDF"));
  }
  if (pdf.numPages > maxPages) {
    throw new ExtractionError("TOO_MANY_PAGES", MESSAGES.tooManyPages(pdf.numPages, maxPages));
  }
  try {
    const result = await extractText(pdf, { mergePages: false });
    return Array.isArray(result.text) ? result.text : [result.text];
  } catch {
    throw new ExtractionError("CORRUPT_FILE", MESSAGES.corrupt("PDF"));
  }
}
