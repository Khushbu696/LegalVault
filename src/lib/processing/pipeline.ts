import type { Repositories } from "../repositories/types";
import { MESSAGES } from "../documents/messages";
import { ExtractionError, extractDocument } from "../extraction";

/**
 * Runs after the client has uploaded every part and the document was claimed (uploading -> extracting).
 * Always ends in `ready` or `failed`. A failed document never keeps text, chunks or the stored file,
 * so a scanned/unreadable PDF can never look like a successful, empty document.
 *
 * NOTE (Step 4): "ready" currently means "text extracted". Step 6 adds chunking before `ready`.
 */
export async function processUploadedDocument(
  repos: Repositories,
  id: string,
  opts: { maxPages: number },
): Promise<void> {
  const doc = await repos.documents.get(id);
  if (!doc || doc.status !== "extracting") return; // not ours to process

  let storageRef = doc.storageRef;
  try {
    let buffer: Buffer;
    if (!storageRef) {
      const parts = await repos.uploads.getParts(id);
      buffer = Buffer.concat(parts.map((p) => p.data));
      if (buffer.length !== doc.sizeBytes) {
        throw new ExtractionError("UPLOAD_INCOMPLETE", MESSAGES.uploadIncomplete);
      }
      storageRef = await repos.storage.save(doc.originalFilename, buffer);
      await repos.documents.update(id, { storageRef });
      await repos.uploads.deleteByDocument(id);
    } else {
      buffer = await repos.storage.read(storageRef);
    }

    const result = await extractDocument(buffer, doc.fileType, opts);
    await repos.documents.update(id, {
      extractedText: result.text,
      pageRanges: result.pageRanges,
      emptyPages: result.emptyPages,
      charCount: result.text.length,
      status: "ready",
      errorCode: null,
      errorMessage: null,
    });
  } catch (e) {
    const known = e instanceof ExtractionError;
    if (!known) console.error(`[pipeline] unexpected failure for document ${id}:`, e);
    await repos.documents.update(id, {
      status: "failed",
      errorCode: known ? e.code : "EXTRACTION_FAILED",
      errorMessage: known ? e.message : MESSAGES.generic,
      extractedText: null,
      pageRanges: [],
      emptyPages: [],
      charCount: 0,
      storageRef: null,
    });
    if (storageRef) await repos.storage.remove(storageRef).catch(() => undefined);
    await repos.uploads.deleteByDocument(id).catch(() => undefined);
  }
}
