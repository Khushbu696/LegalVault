import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";

type P = { id: string };

/** The canonical extracted text (what the reader pane shows and quote offsets point into). */
export const GET = handle<P>(async (_req, { id }) => {
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This document no longer exists.");
  if (doc.status !== "ready" || doc.extractedText === null) {
    return apiError(409, "NOT_READY", "This document hasn't finished processing.");
  }
  return Response.json({ text: doc.extractedText, pageRanges: doc.pageRanges, emptyPages: doc.emptyPages });
});
