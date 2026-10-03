import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createMongoRepositories } from "@/lib/repositories/mongo";
import { ensureIndexes } from "@/lib/repositories/mongo/collections";
import { FileNotFoundError } from "@/lib/repositories/mongo/storage-gridfs";
import type { Repositories } from "@/lib/repositories/types";

// Uses MONGODB_URI_TEST if set (e.g. a throwaway Atlas cluster), otherwise an in-memory mongod.
let server: MongoMemoryServer | undefined;
let client: MongoClient;
let db: Db;
let repos: Repositories;

beforeAll(async () => {
  let uri = process.env.MONGODB_URI_TEST;
  if (!uri) {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }
  client = await new MongoClient(uri).connect();
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  db = client.db(`test_${Math.random().toString(36).slice(2, 10)}`); // isolated per test
  await ensureIndexes(db);
  repos = createMongoRepositories(db);
});

afterEach(async () => {
  await db.dropDatabase();
});

const chunk = (documentId: string, chunkIndex: number) => ({
  documentId, chunkIndex, text: `chunk ${chunkIndex}`,
  startOffset: chunkIndex * 10, endOffset: chunkIndex * 10 + 9,
  pageStart: 1, pageEnd: 1, sectionHeading: null,
});

describe("documents", () => {
  it("creates with safe defaults", async () => {
    const d = await repos.documents.create({ originalFilename: "a.pdf", fileType: "pdf" });
    expect(d.status).toBe("uploading");
    expect(d.extractedText).toBeNull();
    expect(d.errorCode).toBeNull();
    expect(d.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it("gets by id, and returns null for unknown or malformed ids", async () => {
    const d = await repos.documents.create({ originalFilename: "a.pdf", fileType: "pdf" });
    expect((await repos.documents.get(d.id))?.originalFilename).toBe("a.pdf");
    expect(await repos.documents.get("0".repeat(24))).toBeNull();
    expect(await repos.documents.get("not-an-id")).toBeNull();
  });

  it("list is newest-first and never includes extractedText", async () => {
    const a = await repos.documents.create({ originalFilename: "a.pdf", fileType: "pdf" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repos.documents.create({ originalFilename: "b.docx", fileType: "docx" });
    await repos.documents.update(a.id, { extractedText: "SECRET BODY", status: "ready" });
    const list = await repos.documents.list();
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list.every((x) => !("extractedText" in x))).toBe(true);
  });

  it("update patches fields, bumps updatedAt, and ignores undefined", async () => {
    const d = await repos.documents.create({ originalFilename: "a.pdf", fileType: "pdf" });
    await new Promise((r) => setTimeout(r, 5));
    await repos.documents.update(d.id, { status: "failed", errorCode: "SCANNED_PDF", errorMessage: undefined });
    const after = (await repos.documents.get(d.id))!;
    expect(after.status).toBe("failed");
    expect(after.errorCode).toBe("SCANNED_PDF");
    expect(after.originalFilename).toBe("a.pdf");
    expect(after.updatedAt.getTime()).toBeGreaterThan(d.updatedAt.getTime());
  });
});

describe("chunks", () => {
  it("returns chunks in chunkIndex order", async () => {
    await repos.chunks.insertMany([chunk("d1", 2), chunk("d1", 0), chunk("d1", 1)]);
    expect((await repos.chunks.listByDocument("d1")).map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("empty insert is a no-op", async () => {
    await expect(repos.chunks.insertMany([])).resolves.toBeUndefined();
  });

  it("rejects a duplicate (documentId, chunkIndex)", async () => {
    await repos.chunks.insertMany([chunk("d1", 0)]);
    await expect(repos.chunks.insertMany([chunk("d1", 0)])).rejects.toThrow();
  });

  it("deleteByDocument only removes that document's chunks", async () => {
    await repos.chunks.insertMany([chunk("d1", 0), chunk("d2", 0)]);
    await repos.chunks.deleteByDocument("d1");
    expect(await repos.chunks.listByDocument("d1")).toHaveLength(0);
    expect(await repos.chunks.listByDocument("d2")).toHaveLength(1);
  });
});

describe("chats and messages", () => {
  it("getOrCreateForDocument is idempotent, even when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repos.chats.getOrCreateForDocument("d1")),
    );
    expect(new Set(results.map((c) => c.id)).size).toBe(1);
    expect(await db.collection("chats").countDocuments({ documentId: "d1" })).toBe(1);
  });

  it("stores messages in order and persists quotes + scope on update", async () => {
    const chat = await repos.chats.getOrCreateForDocument("d1");
    await repos.chats.addMessage({
      chatId: chat.id, documentId: "d1", role: "user", content: "Q?",
      status: "complete", quotes: [], retrievalScope: null,
    });
    const a = await repos.chats.addMessage({
      chatId: chat.id, documentId: "d1", role: "assistant", content: "",
      status: "streaming", quotes: [], retrievalScope: null,
    });
    await repos.chats.updateMessage(a.id, {
      content: "Answer", status: "complete",
      retrievalScope: { chunkIndexes: [1, 2], totalChunks: 48, coverage: "partial" },
      quotes: [{
        ordinal: 0, quoteText: "q", normalizedQuote: "q", status: "verified", matchType: "exact",
        startOffset: 5, endOffset: 6, matchedText: "q", occurrenceCount: 1, occurrenceIndex: 0,
        chunkId: null, pageStart: 2, reason: null,
      }],
    });
    const msgs = await repos.chats.listMessages(chat.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].status).toBe("complete");
    expect(msgs[1].quotes[0].startOffset).toBe(5);
    expect(msgs[1].retrievalScope?.totalChunks).toBe(48);
  });

  it("updateMessage on an unknown id does nothing", async () => {
    await expect(repos.chats.updateMessage("0".repeat(24), { content: "x" })).resolves.toBeUndefined();
  });
});

describe("storage (GridFS)", () => {
  it("round-trips bytes exactly", async () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
    const ref = await repos.storage.save("x.pdf", bytes);
    expect((await repos.storage.read(ref)).equals(bytes)).toBe(true);
  });

  it("read of a missing file throws FileNotFoundError; remove is idempotent", async () => {
    await expect(repos.storage.read("0".repeat(24))).rejects.toBeInstanceOf(FileNotFoundError);
    const ref = await repos.storage.save("x.pdf", Buffer.from("hi"));
    await repos.storage.remove(ref);
    await expect(repos.storage.remove(ref)).resolves.toBeUndefined();
    await expect(repos.storage.read(ref)).rejects.toBeInstanceOf(FileNotFoundError);
  });
});

describe("cascading delete", () => {
  async function seed(name: string) {
    const doc = await repos.documents.create({ originalFilename: name, fileType: "pdf" });
    const ref = await repos.storage.save(name, Buffer.from("file-" + name));
    await repos.documents.update(doc.id, { storageRef: ref });
    await repos.chunks.insertMany([chunk(doc.id, 0), chunk(doc.id, 1)]);
    const chat = await repos.chats.getOrCreateForDocument(doc.id);
    await repos.chats.addMessage({
      chatId: chat.id, documentId: doc.id, role: "user", content: "hi",
      status: "complete", quotes: [], retrievalScope: null,
    });
    return { doc, ref, chat };
  }

  it("removes chunks, chat, messages and the stored file, and leaves other documents alone", async () => {
    const a = await seed("a.pdf");
    const b = await seed("b.pdf");
    await repos.documents.delete(a.doc.id);

    expect(await repos.documents.get(a.doc.id)).toBeNull();
    expect(await repos.chunks.listByDocument(a.doc.id)).toHaveLength(0);
    expect(await repos.chats.listMessages(a.chat.id)).toHaveLength(0);
    expect(await db.collection("chats").countDocuments({ documentId: a.doc.id })).toBe(0);
    await expect(repos.storage.read(a.ref)).rejects.toBeInstanceOf(FileNotFoundError);

    expect(await repos.documents.get(b.doc.id)).not.toBeNull();
    expect(await repos.chunks.listByDocument(b.doc.id)).toHaveLength(2);
    expect(await repos.chats.listMessages(b.chat.id)).toHaveLength(1);
    expect((await repos.storage.read(b.ref)).toString()).toBe("file-b.pdf");
  });

  it("deleting a non-existent or malformed id does not throw", async () => {
    await expect(repos.documents.delete("0".repeat(24))).resolves.toBeUndefined();
    await expect(repos.documents.delete("nope")).resolves.toBeUndefined();
  });
});
