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
  let summary = comparison.summary;
  let summarySource: "ai" | "local" = "local";
  try {
    const aiEnv = getAiEnv();
    const client = new OpenAI({ apiKey: aiEnv.AI_API_KEY, baseURL: aiEnv.AI_BASE_URL });
    const completion = await client.chat.completions.create({
      model: aiEnv.AI_MODEL,
      messages: [{
        role: "user",
        content: [
          "Summarize the material contract changes in the supplied clause-level comparison.",
          "Use only the provided differences. Do not infer missing terms or legal outcomes. Return 1-3 concise sentences.",
          JSON.stringify(comparison.changes),
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
    documents: {
      docA: { id: docA.id, filename: docA.originalFilename },
      docB: { id: docB.id, filename: docB.originalFilename },
    },
  });
});
