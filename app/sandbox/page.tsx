import Nav from "@/components/Nav";
import LiveBoundary from "@/components/LiveBoundary";

export const metadata = {
  title: "Sandbox: Linescout",
};

// The line-integrity sandbox: replay a recorded match through the classifier against your
// own uploaded book + markdown policy. Archive-only (no live feed to leak). The component is
// still named LiveBoundary for history; the route is /sandbox.
export default function SandboxPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <LiveBoundary />
    </main>
  );
}
