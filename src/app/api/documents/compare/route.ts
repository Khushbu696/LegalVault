import OpenAI from "openai";
import { getAiEnv } from "@/lib/config/env";
import { apiError, handle } from "@/lib/http";
import { compareContracts } from "@/lib/documents/comparison";
import { getRepositories } from "@/lib/repositories";

export const POST = handle(async (request) => {
  const body = await request.json().catch(() => ({}));
  const docAId = typeof body?.docA === "string" ? body.docA : "";
  const docBId = typeof body?.docB === "string" ? body.docB : "";
  if (!docAId || !docBId || docAId === docBId) return apiError(400, "INVALID_REQUEST", "Select two different contracts to compare.");

  const repos = await getRepositories();
  const [docA, docB] = await Promise.all([repos.documents.get(docAId), repos.documents.get(docBId)]);
  if (!docA || !docB) return apiError(404, "NOT_FOUND", "One or both contracts could not be found.");
  if (docA.status !== "ready" || docB.status !== "ready" || !docA.extractedText || !docB.extractedText) {
    return apiError(409, "NOT_READY", "Both contracts must be processed before comparing them.");
  }

  const comparison = compareContracts(docA.extractedText, docB.extractedText);
  for (const alignment of comparison.alignments) {
    console.info("[comparison:clause-alignment]", {
      sectionNumber: alignment.sectionNumber,
      versionA: alignment.oldHeading || (alignment.sectionNumber ? `Section ${alignment.sectionNumber}` : "Unnumbered paragraph"),
      versionB: alignment.newHeading || (alignment.sectionNumber ? `Section ${alignment.sectionNumber}` : "Unnumbered paragraph"),
      matchType: alignment.matchType,
      status: alignment.status,
    });
  }
  let summary = comparison.summary;
  let summarySource: "ai" | "local" = "local";
  try {
    if (comparison.changes.length === 0) throw new Error("No changed clauses require an AI summary.");
    const aiEnv = getAiEnv();
    const client = new OpenAI({ apiKey: aiEnv.AI_API_KEY, baseURL: aiEnv.AI_BASE_URL });
    const completion = await client.chat.completions.create({
      model: aiEnv.AI_MODEL,
      messages: [{
        role: "user",
        content: [
          "Explain only the verified differences between the supplied Version A and Version B clause texts.",
          "Do not add, infer, or mention any change not directly supported by those exact source texts. Do not rewrite or alter the quoted clause text.",
          "Return a concise factual summary of the differences only. The deterministic change list is authoritative; do not add clauses to it.",
          JSON.stringify(comparison.changes.map(({ sectionNumber, label, status, oldText, newText }) => ({ sectionNumber, label, status, versionAText: oldText, versionBText: newText }))),
        ].join("\n\n"),
      }],
    });
    const generated = completion.choices?.[0]?.message?.content?.trim();
    if (generated) {
      summary = generated;
      summarySource = "ai";
    }
  } catch {
    summarySource = "local";
  }

  return Response.json({
    summary,
    summarySource,
    changes: comparison.changes,
    alignments: comparison.alignments,
    documents: {
      docA: { id: docA.id, filename: docA.originalFilename },
      docB: { id: docB.id, filename: docB.originalFilename },
    },
  });
});
