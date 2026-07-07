import Nav from "@/components/Nav";
import LaunchDoc from "@/components/LaunchDoc";

export const metadata = {
  title: "Launch: Lagisalpha paper-trading terminal",
  description:
    "Paper-trade the lead-lag edge before you risk a dollar. Run npx lagisalpha in any terminal, set a bankroll, pick live or replay, and watch each team's cheap side converge to TxLINE fair, Kelly-sized, with the PnL. Also on Telegram (@lagisalphabot). Signal only, no real orders.",
};

export default function LaunchPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <LaunchDoc />
    </main>
  );
}
