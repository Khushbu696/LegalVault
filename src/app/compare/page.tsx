import { CompareWorkspace } from "@/components/CompareWorkspace";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ docA?: string; docB?: string }> }) {
  const { docA = "", docB = "" } = await searchParams;
  return <CompareWorkspace docAId={docA} docBId={docB} />;
}
