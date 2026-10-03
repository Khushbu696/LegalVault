import { ObjectId, type Db } from "mongodb";
import type { ChatRecord, ChatRepository, MessageRecord } from "../types";
import { collections, type ChatDoc, type MessageDoc } from "./collections";
import { toObjectId } from "./ids";

const toChat = ({ _id, ...rest }: ChatDoc): ChatRecord => ({ id: _id.toString(), ...rest });
const toMessage = ({ _id, ...rest }: MessageDoc): MessageRecord => ({ id: _id.toString(), ...rest });

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

export function createChatRepository(db: Db): ChatRepository {
  const c = collections(db);

  async function upsertChat(documentId: string): Promise<ChatDoc> {
    const doc = await c.chats.findOneAndUpdate(
      { documentId },
      { $setOnInsert: { _id: new ObjectId(), documentId, createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    if (!doc) throw new Error("Failed to create chat");
    return doc;
  }

  return {
    async getOrCreateForDocument(documentId) {
      try {
        return toChat(await upsertChat(documentId));
      } catch (e) {
        // Two concurrent upserts can both try to insert; the unique index rejects one. Retry reads the winner.
        if (isDuplicateKey(e)) return toChat(await upsertChat(documentId));
        throw e;
      }
    },

    async addMessage(m) {
      const doc: MessageDoc = { _id: new ObjectId(), ...m, createdAt: new Date() };
      await c.messages.insertOne(doc);
      return toMessage(doc);
    },

    async updateMessage(id, patch) {
      const oid = toObjectId(id);
      if (!oid) return;
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<MessageDoc>;
      if (Object.keys(defined).length === 0) return;
      await c.messages.updateOne({ _id: oid }, { $set: defined });
    },

    async listMessages(chatId) {
      const docs = await c.messages.find({ chatId }).sort({ createdAt: 1, _id: 1 }).toArray();
      return docs.map(toMessage);
    },
  };
}
