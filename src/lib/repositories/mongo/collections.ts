import type { Binary, Db, ObjectId } from "mongodb";
import type { ChatRecord, ChunkRecord, DocumentRecord, MessageRecord } from "../types";

// Stored shapes: same as the domain records but with a Mongo _id instead of `id`.
// Foreign keys (documentId, chatId) are stored as hex strings.
export type DocumentDoc = Omit<DocumentRecord, "id"> & { _id: ObjectId };
export type ChunkDoc = Omit<ChunkRecord, "id"> & { _id: ObjectId };
export type ChatDoc = Omit<ChatRecord, "id"> & { _id: ObjectId };
export type MessageDoc = Omit<MessageRecord, "id"> & { _id: ObjectId };
export interface UploadPartDoc {
  _id: ObjectId;
  documentId: string;
  index: number;
  data: Binary;
  createdAt: Date;
}

export function collections(db: Db) {
  return {
    documents: db.collection<DocumentDoc>("documents"),
    chunks: db.collection<ChunkDoc>("document_chunks"),
    chats: db.collection<ChatDoc>("chats"),
    messages: db.collection<MessageDoc>("messages"),
    uploadParts: db.collection<UploadPartDoc>("upload_parts"),
  };
}

const indexed = new WeakMap<Db, Promise<void>>();

/** Idempotent. Runs once per Db handle; a failure is not cached so the next call retries. */
export function ensureIndexes(db: Db): Promise<void> {
  let p = indexed.get(db);
  if (!p) {
    const c = collections(db);
    p = Promise.all([
      c.documents.createIndex({ createdAt: -1 }),
      c.chunks.createIndex({ documentId: 1, chunkIndex: 1 }, { unique: true }),
      c.chats.createIndex({ documentId: 1 }, { unique: true }),
      c.messages.createIndex({ chatId: 1, createdAt: 1 }),
      c.messages.createIndex({ documentId: 1 }),
      c.uploadParts.createIndex({ documentId: 1, index: 1 }, { unique: true }),
      // Abandoned uploads clean themselves up after 24h.
      c.uploadParts.createIndex({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 }),
    ]).then(() => undefined);
    p.catch(() => indexed.delete(db));
    indexed.set(db, p);
  }
  return p;
}
