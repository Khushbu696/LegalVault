import { MultiChatWorkspace } from "@/components/MultiChatWorkspace";

export default async function MultiChatPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const params = await searchParams;
  const rawIds = Array.isArray(params.ids) ? params.ids.join(",") : params.ids ?? "";
  const initialIds = [...new Set(rawIds.split(",").map((id) => id.trim()).filter(Boolean))];
  return <MultiChatWorkspace initialIds={initialIds} />;
}
