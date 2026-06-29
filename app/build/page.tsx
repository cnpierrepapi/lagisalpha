import Nav from "@/components/Nav";
import AgentBuilder from "@/components/AgentBuilder";

export const metadata = {
  title: "Build an Agent — Agenthesis",
};

export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ paper?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen">
      <Nav />
      <AgentBuilder initialPaper={sp.paper ?? null} />
    </main>
  );
}
