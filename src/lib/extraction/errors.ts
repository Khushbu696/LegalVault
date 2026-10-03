import type { ErrorCode } from "../repositories/types";

/** A failure whose message is safe and useful to show to the user. */
export class ExtractionError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
