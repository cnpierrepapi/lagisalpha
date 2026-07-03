import Nav from "@/components/Nav";
import Litepaper from "@/components/Litepaper";

export const metadata = {
  title: "Litepaper: Agenthesis",
  description:
    "The Agenthesis thesis: strategies from research, run by autonomous forecasters that flag mispricings and are graded on closing-line value over a verifiable feed.",
};

export default function LitepaperPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Litepaper />
    </main>
  );
}
