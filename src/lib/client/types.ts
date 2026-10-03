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
