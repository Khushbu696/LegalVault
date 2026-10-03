import type { ErrorCode, FileType } from "../repositories/types";
import { MESSAGES } from "./messages";

export type UploadValidation =
  | { ok: true; filename: string; fileType: FileType; size: number }
  | { ok: false; status: number; code: ErrorCode; message: string };

const fail = (status: number, code: ErrorCode, message: string): UploadValidation => ({
  ok: false, status, code, message,
});

/** Strip any path the client sent and cap the length. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return base.trim().slice(0, 255);
}

export function validateUpload(
  input: { filename: unknown; size: unknown },
  limits: { maxBytes: number },
): UploadValidation {
  if (typeof input.filename !== "string" || !sanitizeFilename(input.filename)) {
    return fail(400, "INVALID_REQUEST", "A file name is required.");
  }
  const filename = sanitizeFilename(input.filename);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (ext !== "pdf" && ext !== "docx") {
    return fail(415, "UNSUPPORTED_TYPE", MESSAGES.unsupported(filename));
  }
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    return fail(400, "INVALID_REQUEST", "A valid file size is required.");
  }
  if (size === 0) return fail(400, "EMPTY_DOCUMENT", MESSAGES.emptyFile);
  if (size > limits.maxBytes) return fail(413, "TOO_LARGE", MESSAGES.tooLarge(size, limits.maxBytes));
  return { ok: true, filename, fileType: ext, size };
}

/** Looks at the bytes, never the client's MIME type or extension. */
export function sniffFileType(buf: Buffer): FileType | null {
  if (buf.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "docx";
  return null;
}
