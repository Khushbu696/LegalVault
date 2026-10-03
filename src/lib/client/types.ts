// What the browser receives from the API (dates arrive as ISO strings).
export type DocumentStatus = "uploading" | "extracting" | "chunking" | "ready" | "failed";

export interface DocumentDTO {
  id: string;
  originalFilename: string;
  fileType: "pdf" | "docx";
  sizeBytes: number;
  status: DocumentStatus;
  errorCode: string | null;
  errorMessage: string | null;
  charCount: number;
  chunkCount: number;
  pageCount: number | null;
  emptyPages: number[];
  createdAt: string;
  updatedAt: string;
}

export interface PageRangeDTO { page: number; start: number; end: number }
export interface DocumentTextDTO { text: string; pageRanges: PageRangeDTO[]; emptyPages: number[] }
export interface AppConfigDTO { maxUploadBytes: number; maxPages: number; partSize: number; acceptedTypes: string[] }

/** An upload that is still being sent from this browser. */
export interface UploadItem {
  key: string;
  docId?: string;
  name: string;
  size: number;
  percent: number;
  phase: "sending" | "error";
  error?: string;
}

export type QuoteStatus = "verified" | "unverified";
export interface QuoteDTO {
  ordinal: number;
  quoteText: string;
  normalizedQuote: string;
  status: QuoteStatus;
  matchType: "exact" | "whitespace" | "punctuation" | null;
  startOffset: number | null;
  endOffset: number | null;
  matchedText: string | null;
  occurrenceCount: number;
  occurrenceIndex: number | null;
  chunkId: string | null;
  pageStart: number | null;
  reason: string | null;
}

export type MessageStatus = "streaming" | "complete" | "stopped" | "error";
export interface ChatMessageDTO {
  id: string;
  chatId: string;
  documentId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  quotes: QuoteDTO[];
  retrievalScope: { chunkIndexes: number[]; totalChunks: number; coverage: "full" | "partial" } | null;
  createdAt: string;
}
