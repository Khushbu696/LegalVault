import type { DocumentRecord } from "@/lib/repositories/types";

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

/** What the browser is allowed to see: never the stored file reference or the full text. */
export function publicDocument(d: Omit<DocumentRecord, "extractedText"> | DocumentRecord) {
  return {
    id: d.id,
    originalFilename: d.originalFilename,
    fileType: d.fileType,
    sizeBytes: d.sizeBytes,
    status: d.status,
    errorCode: d.errorCode,
    errorMessage: d.errorMessage,
    charCount: d.charCount,
    chunkCount: d.chunkCount,
    pageCount: d.pageRanges.length || null,
    emptyPages: d.emptyPages,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Wraps a handler so an unexpected error becomes a clean JSON 500 instead of an HTML error page. */
export function handle<P = Record<string, string>>(
  fn: (req: Request, params: P) => Promise<Response>,
) {
  return async (req: Request, ctx?: { params: Promise<P> }): Promise<Response> => {
    try {
      return await fn(req, ctx ? await ctx.params : ({} as P));
    } catch (e) {
      console.error("[api] unhandled error:", e);
      const detail = process.env.NODE_ENV !== "production" && e instanceof Error ? e.message : undefined;
      return apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.", { detail });
    }
  };
}
