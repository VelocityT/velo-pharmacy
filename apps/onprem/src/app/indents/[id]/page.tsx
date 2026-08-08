import IndentDetail from "@velocare/ui/screens/IndentDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IndentDetail id={id} />;
}
