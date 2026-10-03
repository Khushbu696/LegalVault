import { after } from "next/server";
import { getLimitsEnv } from "@/lib/config/env";
import { PART_SIZE } from "@/lib/documents/constants";
import { MESSAGES } from "@/lib/documents/messages";
import { sniffFileType } from "@/lib/documents/validate";
import { apiError, handle, publicDocument } from "@/lib/http";
import { processUploadedDocument } from "@/lib/processing/pipeline";
import { getRepositories } from "@/lib/repositories";

export const runtime = "nodejs";
export const maxDuration = 300; // processing continues after the response via after()

type P = { id: string };

/** Step 3: all parts sent. Claims the document and processes it in the background. */
export const POST = handle<P>(async (_req, { id }) => {
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This upload no longer exists.");
  if (doc.status !== "uploading") {
    return Response.json({ document: publicDocument(doc) }, { status: 202 }); // idempotent
  }

  const totalParts = Math.ceil(doc.sizeBytes / PART_SIZE);
  const present = new Set(await repos.uploads.listIndexes(id));
  const missing = Array.from({ length: totalParts }, (_, i) => i).filter((i) => !present.has(i));
  if (missing.length > 0) {
    return apiError(400, "MISSING_PARTS", "Some parts of the upload are missing. Please retry.", { missing });
  }

  // Check the real bytes of the first part against the claimed type before doing any work.
  const first = await repos.uploads.getPart(id, 0);
  if (!first || sniffFileType(first) !== doc.fileType) {
    await repos.documents.transitionStatus(id, "uploading", {
      status: "failed",
      errorCode: "UNSUPPORTED_TYPE",
      errorMessage: MESSAGES.contentMismatch(doc.fileType),
    });
    await repos.uploads.deleteByDocument(id);
    return apiError(415, "UNSUPPORTED_TYPE", MESSAGES.contentMismatch(doc.fileType));
  }

  const claimed = await repos.documents.transitionStatus(id, "uploading", { status: "extracting" });
  if (!claimed) {
    const current = await repos.documents.get(id);
    return Response.json({ document: current ? publicDocument(current) : null }, { status: 202 });
  }

  const { MAX_PAGES } = getLimitsEnv();
  after(() =>
    processUploadedDocument(repos, id, { maxPages: MAX_PAGES }).catch((e) =>
      console.error(`[complete] processing crashed for ${id}:`, e),
    ),
  );
  return Response.json({ id, status: "extracting" }, { status: 202 });
});
