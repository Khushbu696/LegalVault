import { ObjectId, type Db } from "mongodb";
import type { DocumentRecord, DocumentRepository, FileStorage } from "../types";
import { collections, type DocumentDoc } from "./collections";
import { definedOnly, toObjectId } from "./ids";

type ListItem = Omit<DocumentRecord, "extractedText">;

const toRecord = ({ _id, ...rest }: DocumentDoc): DocumentRecord => ({ id: _id.toString(), ...rest });

export function createDocumentRepository(db: Db, storage: FileStorage): DocumentRepository {
  const c = collections(db);

  return {
    async create({ originalFilename, fileType, sizeBytes }) {
      const now = new Date();
      const doc: DocumentDoc = {
        _id: new ObjectId(),
        originalFilename,
        fileType,
        storageRef: null,
        extractedText: null,
        pageRanges: [],
        status: "uploading",
        errorCode: null,
        errorMessage: null,
        charCount: 0,
        chunkCount: 0,
        sizeBytes: sizeBytes ?? 0,
        emptyPages: [],
        createdAt: now,
        updatedAt: now,
      };
      await c.documents.insertOne(doc);
      return toRecord(doc);
    },

    async get(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      const doc = await c.documents.findOne({ _id: oid });
      return doc ? toRecord(doc) : null;
    },

    async list() {
      // Never ship the full extracted text (can be MBs) in a list response.
      const docs = await c.documents
        .find({}, { projection: { extractedText: 0 } })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();
      return docs.map((d): ListItem => {
        const { extractedText, ...rest } = toRecord(d as DocumentDoc);
        void extractedText;
        return rest;
      });
    },

    async update(id, patch) {
      const oid = toObjectId(id);
      if (!oid) return;
      await c.documents.updateOne({ _id: oid }, { $set: { ...definedOnly(patch), updatedAt: new Date() } });
    },

    async transitionStatus(id, from, patch) {
      const oid = toObjectId(id);
      if (!oid) return false;
      const r = await c.documents.updateOne(
        { _id: oid, status: from },
        { $set: { ...definedOnly(patch), updatedAt: new Date() } },
      );
      return r.modifiedCount === 1;
    },

    /**
     * Cascade: dependents first, the document row last. If anything fails midway the
     * document still exists, so the user can retry; every step is idempotent.
     */
    async delete(id) {
      const oid = toObjectId(id);
      if (!oid) return;
      const doc = await c.documents.findOne({ _id: oid }, { projection: { storageRef: 1 } });
      await c.messages.deleteMany({ documentId: id });
      await c.chats.deleteMany({ documentId: id });
      await c.chunks.deleteMany({ documentId: id });
      await c.uploadParts.deleteMany({ documentId: id });
      if (doc?.storageRef) await storage.remove(doc.storageRef);
      await c.documents.deleteOne({ _id: oid });
    },
  };
}
