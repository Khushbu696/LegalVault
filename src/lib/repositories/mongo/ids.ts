import { ObjectId } from "mongodb";

/** Strict 24-hex check. ObjectId.isValid() also accepts any 12-char string, which we don't want. */
export function toObjectId(id: string): ObjectId | null {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
}

/** undefined would be stored as null by the driver; dropping it makes "not provided" mean "unchanged". */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}
