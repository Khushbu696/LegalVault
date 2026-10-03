import type { AppConfigDTO, DocumentDTO, DocumentTextDTO } from "./types";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
    this.name = "ApiError";
  }
}

export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

function fallbackMessage(status: number) {
  if (status === 413) return "That request was too large for the server to accept.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request failed. Please try again.";
}

/** Turns an error response body into an ApiError, using the server's own message when it sent one. */
export function apiErrorFrom(status: number, bodyText: string): ApiError {
  let body: { error?: { code?: string; message?: string } } | null = null;
  try { body = JSON.parse(bodyText); } catch { /* not JSON */ }
  return new ApiError(body?.error?.code ?? `HTTP_${status}`, body?.error?.message ?? fallbackMessage(status), status);
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw apiErrorFrom(res.status, await res.text());
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getConfig = () => request<AppConfigDTO>("/api/config");
export const listDocuments = async () =>
  (await request<{ documents: DocumentDTO[] }>("/api/documents", { cache: "no-store" })).documents;
export const deleteDocument = (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" });
export const getDocumentText = (id: string) => request<DocumentTextDTO>(`/api/documents/${id}/text`);
