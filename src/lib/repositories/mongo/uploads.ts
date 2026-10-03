import { Binary, ObjectId, type Db } from "mongodb";
import type { UploadPartRepository } from "../types";
import { collections } from "./collections";

const toBuffer = (b: Binary) => Buffer.from(b.buffer.subarray(0, b.position));

export function createUploadPartRepository(db: Db): UploadPartRepository {
  const c = collections(db);
  return {
    async putPart(documentId, index, data) {
      await c.uploadParts.updateOne(
        { documentId, index },
        { $set: { data: new Binary(data), createdAt: new Date() }, $setOnInsert: { _id: new ObjectId() } },
        { upsert: true },
      );
    },
    async getPart(documentId, index) {
      const doc = await c.uploadParts.findOne({ documentId, index });
      return doc ? toBuffer(doc.data) : null;
    },
    async getParts(documentId) {
      const docs = await c.uploadParts.find({ documentId }).sort({ index: 1 }).toArray();
      return docs.map((d) => ({ index: d.index, data: toBuffer(d.data) }));
    },
    async listIndexes(documentId) {
      const docs = await c.uploadParts
        .find({ documentId }, { projection: { index: 1 } })
        .sort({ index: 1 })
        .toArray();
      return docs.map((d) => d.index);
    },
    async deleteByDocument(documentId) {
      await c.uploadParts.deleteMany({ documentId });
    },
  };
}
