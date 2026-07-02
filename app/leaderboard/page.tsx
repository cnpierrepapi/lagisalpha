import { redirect } from "next/navigation";

// /leaderboard is retired — the calibration ranking is folded into the Launch
// page (/desk), which ranks live/deployed forecasters by CLV inline.
export default function LeaderboardRedirect() {
  redirect("/desk");
}
