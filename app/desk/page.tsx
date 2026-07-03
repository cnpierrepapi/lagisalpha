import Nav from "@/components/Nav";
import Desk from "@/components/Desk";

export const metadata = {
  title: "Archive: Agenthesis",
};

export default function DeskPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Desk />
    </main>
  );
}
