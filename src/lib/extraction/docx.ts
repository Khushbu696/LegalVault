import mammoth from "mammoth";
import { MESSAGES } from "../documents/messages";
import { ExtractionError } from "./errors";

export async function extractDocxText(buf: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  } catch {
    throw new ExtractionError("CORRUPT_FILE", MESSAGES.corrupt("DOCX"));
  }
}
