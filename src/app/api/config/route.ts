import { getLimitsEnv } from "@/lib/config/env";
import { PART_SIZE } from "@/lib/documents/constants";
import { handle } from "@/lib/http";

export const GET = handle(async () => {
  const { MAX_UPLOAD_MB, MAX_PAGES } = getLimitsEnv();
  return Response.json({
    maxUploadBytes: Math.floor(MAX_UPLOAD_MB * 1024 * 1024),
    maxPages: MAX_PAGES,
    partSize: PART_SIZE,
    acceptedTypes: ["pdf", "docx"],
  });
});
