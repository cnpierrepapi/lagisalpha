import Nav from "@/components/Nav";
import ProofBoard from "@/components/ProofBoard";
import { getProof } from "@/lib/proof";

export const metadata = {
  title: "Proof: Agenthesis",
};

export default function ProofPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <ProofBoard proof={getProof()} />
    </main>
  );
}
