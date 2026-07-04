import Nav from "@/components/Nav";
import SdkDoc from "@/components/SdkDoc";

export const metadata = {
  title: "SDK: Linethesis",
  description:
    "Embed the Linethesis line-integrity engine next to your own book: the exact pure, deterministic detector, classifier, and grader the product runs.",
};

export default function SdkPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <SdkDoc />
    </main>
  );
}
