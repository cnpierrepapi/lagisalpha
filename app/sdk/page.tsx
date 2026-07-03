import Nav from "@/components/Nav";
import SdkDoc from "@/components/SdkDoc";

export const metadata = {
  title: "SDK: Agenthesis",
  description:
    "Embed the Agenthesis mispricing-detection engine and CLV decision core in your own stack. The exact pure, deterministic code the product runs.",
};

export default function SdkPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <SdkDoc />
    </main>
  );
}
