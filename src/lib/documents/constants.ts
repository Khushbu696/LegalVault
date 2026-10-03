/** Each upload request carries one part. 3 MiB stays safely under Vercel's 4.5 MB request-body limit. */
export const PART_SIZE = 3 * 1024 * 1024;
export const STALE_UPLOAD_MS = 15 * 60_000;
export const STALE_PROCESSING_MS = 10 * 60_000;
