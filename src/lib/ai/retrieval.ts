import type { ChunkRecord } from "@/lib/repositories/types";

export interface RetrievalSelection {
  chunkIndexes: number[];
  totalChunks: number;
  coverage: "full" | "partial";
  selected: ChunkRecord[];
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildChunkContext(chunks: ChunkRecord[]): string {
  return chunks
    .map((chunk) => {
      const heading = chunk.sectionHeading ? `\n${chunk.sectionHeading}\n` : "";
      return `${heading}Section ${chunk.chunkIndex + 1}\n${chunk.text}`.trim();
    })
    .join("\n\n---\n\n");
}

export function retrieveRelevantChunks(question: string, chunks: ChunkRecord[]): RetrievalSelection {
  const total = chunks.length;
  if (total === 0) {
    return { chunkIndexes: [], totalChunks: 0, coverage: "full", selected: [] };
  }

  const query = normalizeForSearch(question);
  const tokens = query.split(/\s+/).filter(Boolean).filter((token) => token.length > 2);

  if (tokens.length === 0) {
    const selected = chunks.slice(0, Math.min(3, total));
    return {
      chunkIndexes: selected.map((chunk) => chunk.chunkIndex),
      totalChunks: total,
      coverage: selected.length >= total ? "full" : "partial",
      selected,
    };
  }

  const scored = chunks
    .map((chunk) => {
      const text = normalizeForSearch(chunk.text);
      let score = 0;
      for (const token of tokens) {
        const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
        score += (text.match(regex) ?? []).length;
      }
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  const selected = scored.filter((entry) => entry.score > 0).map((entry) => entry.chunk);
  const fallback = selected.length > 0 ? selected : chunks.slice(0, Math.min(3, total));
  const top = fallback.slice(0, Math.min(3, total)).sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    chunkIndexes: top.map((chunk) => chunk.chunkIndex),
    totalChunks: total,
    coverage: top.length >= total ? "full" : "partial",
    selected: top,
  };
}
