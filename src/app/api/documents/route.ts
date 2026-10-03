import { getLimitsEnv } from "@/lib/config/env";
import { PART_SIZE } from "@/lib/documents/constants";
import { reapStaleDocuments } from "@/lib/documents/stale";
import { validateUpload } from "@/lib/documents/validate";
import { apiError, handle, publicDocument } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";

/** List the library. Also fails documents that got stuck (e.g. a killed serverless job). */
export const GET = handle(async () => {
  const repos = await getRepositories();
  await reapStaleDocuments(repos);
  const docs = await repos.documents.list();
  return Response.json({ documents: docs.map(publicDocument) });
});

/**
 * Step 1 of a chunked upload. Validates name + size BEFORE any bytes are sent, so the user gets a
 * specific message (unsupported type, too large) instead of a generic 413 after a long upload.
 */
export const POST = handle(async (req) => {
  const body = await req.json().catch(() => null);
  const { MAX_UPLOAD_MB } = getLimitsEnv();
  const v = validateUpload(
    { filename: body?.filename, size: body?.size },
    { maxBytes: Math.floor(MAX_UPLOAD_MB * 1024 * 1024) },
  );
  if (!v.ok) return apiError(v.status, v.code, v.message);

  const repos = await getRepositories();
  const doc = await repos.documents.create({
    originalFilename: v.filename,
    fileType: v.fileType,
    sizeBytes: v.size,
  });
  return Response.json(
    { id: doc.id, partSize: PART_SIZE, totalParts: Math.ceil(v.size / PART_SIZE), status: doc.status },
    { status: 201 },
  );
});
