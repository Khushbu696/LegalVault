import { PART_SIZE } from "@/lib/documents/constants";
import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";

type P = { id: string; index: string };

/** Step 2: one raw-binary part (<= 3 MiB). Safe to retry; re-sending a part replaces it. */
export const PUT = handle<P>(async (req, { id, index: rawIndex }) => {
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) return apiError(400, "INVALID_REQUEST", "Invalid part number.");

  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This upload no longer exists.");
  if (doc.status !== "uploading") return apiError(409, "CONFLICT", "This upload is already finished.");

  const totalParts = Math.ceil(doc.sizeBytes / PART_SIZE);
  if (index >= totalParts) return apiError(400, "INVALID_REQUEST", "Part number out of range.");

  const data = Buffer.from(await req.arrayBuffer());
  const expected = index < totalParts - 1 ? PART_SIZE : doc.sizeBytes - PART_SIZE * (totalParts - 1);
  if (data.length !== expected) {
    return apiError(400, "INVALID_REQUEST", `Part ${index} must be ${expected} bytes but was ${data.length}.`);
  }

  await repos.uploads.putPart(id, index, data);
  await repos.documents.update(id, {}); // heartbeat: keeps a slow upload from being reaped as stale
  return Response.json({ ok: true, index });
});
