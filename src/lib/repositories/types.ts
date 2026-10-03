// Domain types + repository contracts. Nothing outside src/lib/repositories/mongo
// may import "mongodb"; swapping the database means implementing these interfaces.

export type FileType = "pdf" | "docx";
export type DocumentStatus =
  | "uploading" | "extracting" | "chunking" | "ready" | "failed";
export type ErrorCode =
  | "SCANNED_PDF" | "UNSUPPORTED_TYPE" | "TOO_LARGE" | "TOO_MANY_PAGES"
  | "CORRUPT_FILE" | "EXTRACTION_FAILED" | "PASSWORD_PROTECTED" | "EMPTY_DOCUMENT"
  | "INVALID_REQUEST" | "UPLOAD_INCOMPLETE" | "PROCESSING_TIMEOUT";

export interface PageRange { page: number; start: number; end: number } // offsets into extractedText

export interface DocumentRecord {
  id: string;
  originalFilename: string;
  fileType: FileType;
  storageRef: string | null;       // GridFS file id (behind FileStorage)
  extractedText: string | null;    // canonical text; all quote offsets refer to this
  pageRanges: PageRange[];         // empty for DOCX
  status: DocumentStatus;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  charCount: number;
  chunkCount: number;
  sizeBytes: number;
  /** 1-based PDF pages with no extractable text (blank or scanned). Content on them is NOT searchable. */
  emptyPages: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionHeading: string | null;
}

export interface ChatRecord { id: string; documentId: string; createdAt: Date }

export type QuoteStatus = "verified" | "unverified";
export interface QuoteRecord {
  ordinal: number;
  quoteText: string;
  normalizedQuote: string;
  status: QuoteStatus;
  matchType: "exact" | "whitespace" | "punctuation" | null;
  startOffset: number | null;
  endOffset: number | null;
  matchedText: string | null;
  occurrenceCount: number;
  occurrenceIndex: number | null;
  chunkId: string | null;
  pageStart: number | null;     // derived by our code, never from the AI
  reason: string | null;
}

export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "stopped" | "error";
export interface MessageRecord {
  id: string;
  chatId: string;
  documentId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  quotes: QuoteRecord[];          // embedded: always read/written with the message
  retrievalScope: { chunkIndexes: number[]; totalChunks: number; coverage: "full" | "partial" } | null;
  createdAt: Date;
}

export interface DocumentRepository {
  create(input: Pick<DocumentRecord, "originalFilename" | "fileType"> & { sizeBytes?: number }): Promise<DocumentRecord>;
  get(id: string): Promise<DocumentRecord | null>;
  list(): Promise<Omit<DocumentRecord, "extractedText">[]>; // list never ships full text
  update(id: string, patch: Partial<Omit<DocumentRecord, "id" | "createdAt">>): Promise<void>;
  /** Atomic compare-and-set on status. Returns true only for the caller that made the change. */
  transitionStatus(
    id: string,
    from: DocumentStatus,
    patch: Partial<Omit<DocumentRecord, "id" | "createdAt">>,
  ): Promise<boolean>;
  delete(id: string): Promise<void>; // repository is responsible for cascading to chunks/chats/messages/upload parts
}

export interface ChunkRepository {
  insertMany(chunks: Omit<ChunkRecord, "id">[]): Promise<void>;
  listByDocument(documentId: string): Promise<ChunkRecord[]>; // BM25 runs in-app over these
  deleteByDocument(documentId: string): Promise<void>;
}

export interface ChatRepository {
  getOrCreateForDocument(documentId: string): Promise<ChatRecord>;
  addMessage(m: Omit<MessageRecord, "id" | "createdAt">): Promise<MessageRecord>;
  updateMessage(id: string, patch: Partial<Pick<MessageRecord, "content" | "status" | "quotes" | "retrievalScope">>): Promise<void>;
  listMessages(chatId: string): Promise<MessageRecord[]>;
}

export interface FileStorage {
  save(name: string, data: Buffer): Promise<string>;
  read(ref: string): Promise<Buffer>;
  remove(ref: string): Promise<void>;
}

/** Temporary storage for the parts of an in-progress chunked upload. */
export interface UploadPartRepository {
  putPart(documentId: string, index: number, data: Buffer): Promise<void>; // idempotent per (documentId, index)
  getPart(documentId: string, index: number): Promise<Buffer | null>;
  getParts(documentId: string): Promise<{ index: number; data: Buffer }[]>; // sorted by index
  listIndexes(documentId: string): Promise<number[]>;
  deleteByDocument(documentId: string): Promise<void>;
}

export interface Repositories {
  documents: DocumentRepository;
  uploads: UploadPartRepository;
  chunks: ChunkRepository;
  chats: ChatRepository;
  storage: FileStorage;
}
