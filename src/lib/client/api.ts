import type { AppConfigDTO, ChatMessageDTO, DocumentDTO, DocumentTextDTO } from "./types";

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
export const listDocumentMessages = (id: string) =>
  request<{ messages: ChatMessageDTO[] }>(`/api/documents/${id}/chat`, { cache: "no-store" }).then((data) => data.messages);

export interface ChatEvent { type: "delta" | "done" | "error" | "agent_activity"; text?: string; answer?: string; quotes?: ChatMessageDTO["quotes"]; retrievalScope?: ChatMessageDTO["retrievalScope"]; message?: string; }
export interface MultiQuoteEvent {
  documentId: string;
  sourceDocument: string;
  quoteText: string;
  startOffset: number | null;
  endOffset: number | null;
  pageStart: number | null;
  status: "verified";
  reason: string;
}
export interface MultiChatEvent {
  type: "delta" | "done" | "error";
  text?: string;
  answer?: string;
  quotes?: MultiQuoteEvent[];
  message?: string;
}

export async function askDocumentQuestion(
  id: string,
  question: string,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/documents/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw apiErrorFrom(res.status, text);
  }

  if (!res.body) throw new ApiError("STREAM", "The streaming answer isn't available yet.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const payload = JSON.parse(line.slice(5).trim()) as ChatEvent;
        onEvent(payload);
      } catch {
        // Ignore malformed frame lines from the stream.
      }
    }
  }

  if (buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith("data:")) {
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
      } catch {
        // Ignore malformed final frame.
      }
    }
  }
}

export async function askAcrossDocuments(
  documentIds: string[],
  question: string,
  signal: AbortSignal,
  onEvent: (event: MultiChatEvent) => void,
): Promise<void> {
  const res = await fetch("/api/documents/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds, question }),
    signal,
  });
  if (!res.ok) throw apiErrorFrom(res.status, await res.text());
  if (!res.body) throw new ApiError("STREAM", "The streaming answer isn't available yet.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      let event: MultiChatEvent;
      try { event = JSON.parse(line.slice(5).trim()) as MultiChatEvent; } catch { continue; }
      onEvent(event);
    }
  }
  if (buffer.trim().startsWith("data:")) {
    let event: MultiChatEvent;
    try { event = JSON.parse(buffer.trim().slice(5).trim()) as MultiChatEvent; } catch { return; }
    onEvent(event);
  }
}
