import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/lib/config/env";

// Reuse one client across hot reloads (dev) and warm serverless invocations (Vercel).
const g = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
  if (!g._mongoClient) {
    g._mongoClient = new MongoClient(getEnv().MONGODB_URI).connect();
  }
  return g._mongoClient;
}

export async function getDb(): Promise<Db> {
  return (await client()).db(getEnv().MONGODB_DB);
}
