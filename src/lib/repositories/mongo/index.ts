import type { Db } from "mongodb";
import type { Repositories } from "../types";
import { createChatRepository } from "./chats";
import { createChunkRepository } from "./chunks";
import { createDocumentRepository } from "./documents";
import { createGridFsStorage } from "./storage-gridfs";
import { createUploadPartRepository } from "./uploads";

/** Takes a Db so tests can inject an isolated one. */
export function createMongoRepositories(db: Db): Repositories {
  const storage = createGridFsStorage(db);
  return {
    documents: createDocumentRepository(db, storage),
    uploads: createUploadPartRepository(db),
    chunks: createChunkRepository(db),
    chats: createChatRepository(db),
    storage,
  };
}
