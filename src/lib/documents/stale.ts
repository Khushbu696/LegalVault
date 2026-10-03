import type { Repositories } from "../repositories/types";
import { MESSAGES } from "./messages";
import { STALE_PROCESSING_MS, STALE_UPLOAD_MS } from "./constants";

/**
 * Serverless functions can be killed mid-job, which would leave a document "extracting" forever.
 * Called whenever the library is listed: anything stuck too long is failed with a clear message.
 * Uses compare-and-set so it can never overwrite a document that just finished.
 */
export async function reapStaleDocuments(repos: Repositories, now = Date.now()): Promise<number> {
  const docs = await repos.documents.list();
  let reaped = 0;
  for (const d of docs) {
    const age = now - d.updatedAt.getTime();
    const stale =
      (d.status === "uploading" && age > STALE_UPLOAD_MS)
        ? { code: "UPLOAD_INCOMPLETE" as const, message: MESSAGES.uploadIncomplete }
        : (d.status === "extracting" && age > STALE_PROCESSING_MS)
          ? { code: "PROCESSING_TIMEOUT" as const, message: MESSAGES.processingTimeout }
          : null;
    if (!stale) continue;
    const changed = await repos.documents.transitionStatus(d.id, d.status, {
      status: "failed", errorCode: stale.code, errorMessage: stale.message, storageRef: null,
    });
    if (!changed) continue;
    reaped++;
    if (d.storageRef) await repos.storage.remove(d.storageRef).catch(() => undefined);
    await repos.uploads.deleteByDocument(d.id).catch(() => undefined);
  }
  return reaped;
}
