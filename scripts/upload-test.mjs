#!/usr/bin/env node
// Usage: node scripts/upload-test.mjs <file> [baseUrl]
// Exercises the real upload protocol end to end (create -> parts -> complete -> poll -> read text).
import { readFile } from "node:fs/promises";
import path from "node:path";

const [, , file, base = "http://localhost:3000"] = process.argv;
if (!file) {
  console.error("Usage: node scripts/upload-test.mjs <file> [baseUrl]");
  process.exit(1);
}

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, { method, body, headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const data = await readFile(file);
const filename = path.basename(file);
console.log(`Uploading ${filename} (${(data.length / 1048576).toFixed(2)} MB)`);

const created = await call("POST", "/api/documents", JSON.stringify({ filename, size: data.length }), {
  "Content-Type": "application/json",
});
if (created.status !== 201) {
  console.error(`Rejected (${created.status}):`, created.json?.error?.message ?? created.text);
  process.exit(1);
}
const { id, partSize, totalParts } = created.json;
console.log(`Created ${id}: ${totalParts} part(s) of up to ${partSize} bytes`);

for (let i = 0; i < totalParts; i++) {
  const part = data.subarray(i * partSize, Math.min((i + 1) * partSize, data.length));
  const r = await call("PUT", `/api/documents/${id}/parts/${i}`, part, { "Content-Type": "application/octet-stream" });
  if (r.status !== 200) {
    console.error(`Part ${i} failed (${r.status}):`, r.json?.error?.message ?? r.text);
    process.exit(1);
  }
  console.log(`  part ${i + 1}/${totalParts} ok`);
}

const done = await call("POST", `/api/documents/${id}/complete`);
if (done.status !== 202) {
  console.error(`Complete failed (${done.status}):`, done.json?.error?.message ?? done.text);
  process.exit(1);
}

let doc;
for (let i = 0; i < 120; i++) {
  doc = (await call("GET", `/api/documents/${id}`)).json?.document;
  process.stdout.write(`\r  status: ${doc?.status}      `);
  if (doc && (doc.status === "ready" || doc.status === "failed")) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("\n");

if (doc.status === "failed") {
  console.log(`FAILED [${doc.errorCode}]: ${doc.errorMessage}`);
  process.exit(2);
}
console.log(`READY: ${doc.charCount} chars, ${doc.pageCount ?? "n/a"} page(s), empty pages: [${doc.emptyPages.join(", ")}]`);
const t = (await call("GET", `/api/documents/${id}/text`)).json;
console.log("--- first 400 chars of extracted text ---\n" + t.text.slice(0, 400));
console.log(`\nDocument id: ${id}  (delete with: curl.exe -X DELETE ${base}/api/documents/${id})`);
