import { ObjectId, type Db } from "mongodb";
import type { ChunkRecord, ChunkRepository } from "../types";
import { collections, type ChunkDoc } from "./collections";

const toRecord = ({ _id, ...rest }: ChunkDoc): ChunkRecord => ({ id: _id.toString(), ...rest });

export function createChunkRepository(db: Db): ChunkRepository {
  const c = collections(db);
  return {
    async insertMany(chunks) {
      if (chunks.length === 0) return; // the driver throws on an empty insert
      await c.chunks.insertMany(chunks.map((ch) => ({ _id: new ObjectId(), ...ch })));
    },
    async listByDocument(documentId) {
      const docs = await c.chunks.find({ documentId }).sort({ chunkIndex: 1 }).toArray();
      return docs.map(toRecord);
    },
    async deleteByDocument(documentId) {
      await c.chunks.deleteMany({ documentId });
    },
  };
}
