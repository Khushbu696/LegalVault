import type { Repositories } from "../repositories/types";
import { MESSAGES } from "../documents/messages";
import { buildDocumentChunks } from "../documents/chunks";
import { ExtractionError, extractDocument } from "../extraction";

/**
 * Runs after the client has uploaded every part and the document was claimed (uploading -> extracting).
 * Always ends in `ready` or `failed`. A failed document never keeps text, chunks or the stored file,
 * so a scanned/unreadable PDF can never look like a successful, empty document.
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
    const chunks = buildDocumentChunks(result.text, result.pageRanges).map((chunk) => ({
      ...chunk,
      documentId: id,
      sectionHeading: chunk.sectionHeading ?? null,
    }));

    await repos.documents.update(id, {
      extractedText: result.text,
      pageRanges: result.pageRanges,
      emptyPages: result.emptyPages,
      charCount: result.text.length,
      chunkCount: chunks.length,
      status: "chunking",
      errorCode: null,
      errorMessage: null,
    });

    if (chunks.length > 0) {
      await repos.chunks.insertMany(chunks);
    }

    await repos.documents.update(id, {
      chunkCount: chunks.length,
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
    await repos.chunks.deleteByDocument(id).catch(() => undefined);
  }
}
