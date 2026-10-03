import { MongoClient, type Db } from "mongodb";
import { getDbEnv } from "@/lib/config/env";

// One client per process: survives dev hot-reloads and warm serverless invocations.
const g = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
  if (!g._mongoClient) {
    const p = new MongoClient(getDbEnv().MONGODB_URI, {
      serverSelectionTimeoutMS: 8000, // fail with a readable error instead of hanging
    }).connect();
    // A failed connection must not be cached, or every later call would fail forever.
    p.catch(() => {
      if (g._mongoClient === p) g._mongoClient = undefined;
    });
    g._mongoClient = p;
  }
  return g._mongoClient;
}

export async function getDb(): Promise<Db> {
  return (await client()).db(getDbEnv().MONGODB_DB);
}
