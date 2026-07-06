import Nav from "@/components/Nav";
import LaunchDoc from "@/components/LaunchDoc";

export const metadata = {
  title: "Launch: Lagisalpha paper-trading terminal",
  description:
    "Paper-trade the lead-lag edge before you risk a dollar. Load your key, set a bankroll, pick live or replay, and watch each prediction-market divergence taken at the market and exited at TxLINE fair, Kelly-sized, with the PnL. Web terminal or CLI (runs in PowerShell).",
};

export default function LaunchPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <LaunchDoc />
    </main>
  );
}
