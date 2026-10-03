import { getDb } from "@/lib/db/mongo";
import { ensureIndexes } from "./mongo/collections";
import { createMongoRepositories } from "./mongo";
import type { Repositories } from "./types";

export type * from "./types";

let cached: Promise<Repositories> | undefined;

/** The only entry point route handlers use. Swap the database by changing this file. */
export function getRepositories(): Promise<Repositories> {
  if (!cached) {
    const p = (async () => {
      const db = await getDb();
      await ensureIndexes(db);
      return createMongoRepositories(db);
    })();
    p.catch(() => { if (cached === p) cached = undefined; }); // don't cache failures
    cached = p;
  }
  return cached;
}