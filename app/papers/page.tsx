import Nav from "@/components/Nav";
import PaperLibrary from "@/components/PaperLibrary";

export const metadata = {
  title: "Research Library: Linethesis",
};

export default function PapersPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <PaperLibrary />
    </main>
  );
}
