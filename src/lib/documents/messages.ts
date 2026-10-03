export const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export const MESSAGES = {
  scannedPdf:
    "This document appears to be a scanned image without an extractable text layer. Please upload a text-based document or run OCR first.",
  passwordProtected: "This PDF is password-protected. Remove the password and upload it again.",
  emptyDocument: "No readable text was found in this document.",
  corrupt: (kind: "PDF" | "DOCX") =>
    `This ${kind} couldn't be opened. The file may be damaged or not a valid ${kind}.`,
  tooManyPages: (pages: number, max: number) =>
    `This PDF has ${pages} pages. The maximum is ${max} pages.`,
  tooLarge: (size: number, max: number) =>
    `This file is ${mb(size)} MB. The maximum size is ${mb(max)} MB.`,
  unsupported: (name: string) =>
    `“${name}” isn't a supported file type. Please upload a PDF or DOCX file.`,
  contentMismatch: (ext: string) =>
    `This file's contents don't match its .${ext} extension. Please upload a genuine PDF or DOCX file.`,
  emptyFile: "This file is empty.",
  uploadIncomplete: "The upload didn't finish. Please upload the document again.",
  processingTimeout: "Processing didn't finish. Please upload the document again.",
  generic: "We couldn't process this document. Please try uploading it again.",
} as const;
