import { GridFSBucket, type Db } from "mongodb";
import type { FileStorage } from "../types";
import { toObjectId } from "./ids";

export class FileNotFoundError extends Error {
  constructor(ref: string) {
    super(`Stored file not found: ${ref}`);
    this.name = "FileNotFoundError";
  }
}

export function createGridFsStorage(db: Db): FileStorage {
  const bucket = new GridFSBucket(db, { bucketName: "contracts" });

  async function exists(ref: string) {
    const oid = toObjectId(ref);
    if (!oid) return null;
    const found = await bucket.find({ _id: oid }).limit(1).toArray();
    return found.length ? oid : null;
  }

  return {
    async save(name, data) {
      const stream = bucket.openUploadStream(name);
      await new Promise<void>((resolve, reject) => {
        stream.once("finish", () => resolve());
        stream.once("error", reject);
        stream.end(data);
      });
      return stream.id.toString();
    },

    async read(ref) {
      const oid = await exists(ref);
      if (!oid) throw new FileNotFoundError(ref);
      const parts: Buffer[] = [];
      for await (const part of bucket.openDownloadStream(oid)) parts.push(part as Buffer);
      return Buffer.concat(parts);
    },

    async remove(ref) {
      const oid = await exists(ref);
      if (oid) await bucket.delete(oid); // missing file = already removed; idempotent
    },
  };
}
