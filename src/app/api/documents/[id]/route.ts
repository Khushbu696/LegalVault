import { apiError, handle, publicDocument } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";

type P = { id: string };

export const GET = handle<P>(async (_req, { id }) => {
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This document no longer exists.");
  return Response.json({ document: publicDocument(doc) });
});

/** Idempotent: deleting something already gone is a success. */
export const DELETE = handle<P>(async (_req, { id }) => {
  const repos = await getRepositories();
  await repos.documents.delete(id);
  return new Response(null, { status: 204 });
});
