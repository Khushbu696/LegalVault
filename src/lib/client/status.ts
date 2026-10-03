import type { DocumentDTO, DocumentStatus } from "./types";

export const isProcessing = (s: DocumentStatus) => s === "uploading" || s === "extracting" || s === "chunking";

/** Short human text for what the server is doing right now. */
export function processingText(s: DocumentStatus): string {
  switch (s) {
    case "uploading": return "Waiting for the upload to finish...";
    case "extracting": return "Extracting document layout and verifying text layers...";
    case "chunking": return "Preparing sections for search...";
    default: return "";
  }
}

const TITLES: Record<string, string> = {
  SCANNED_PDF: "Unreadable Document Detected",
  PASSWORD_PROTECTED: "Password-Protected PDF",
  CORRUPT_FILE: "This File Couldn't Be Opened",
  TOO_MANY_PAGES: "Document Is Too Long",
  EMPTY_DOCUMENT: "No Readable Text Found",
  UNSUPPORTED_TYPE: "Unsupported File Type",
  TOO_LARGE: "File Is Too Large",
  UPLOAD_INCOMPLETE: "Upload Interrupted",
  PROCESSING_TIMEOUT: "Processing Interrupted",
};
export const failureTitle = (code: string | null) => (code && TITLES[code]) || "Couldn't Process This Document";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/** [1,5,6,7] -> "1, 5–7" */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** The honest warning for pages whose content can't be searched. Empty string when there are none. */
export function emptyPagesNote(pages: number[]): string {
  if (pages.length === 0) return "";
  const one = pages.length === 1;
  return `${one ? "Page" : "Pages"} ${formatPageList(pages)} ${one ? "contains" : "contain"} no readable text (blank or scanned), so ${one ? "it" : "they"} won't be searched.`;
}

export function documentMeta(d: DocumentDTO, now = Date.now()): string {
  const parts = [d.fileType.toUpperCase(), formatBytes(d.sizeBytes)];
  if (d.pageCount) parts.push(`${d.pageCount} page${d.pageCount === 1 ? "" : "s"}`);
  parts.push(relativeTime(d.createdAt, now));
  return parts.join(" · ");
}
