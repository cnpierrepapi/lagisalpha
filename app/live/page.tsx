import { redirect } from "next/navigation";

// /live is retired → the sandbox now lives at /sandbox (archive-only, no live feed). Keep
// this permanent redirect so any old link or bookmark still lands in the right place.
export default function LiveRedirect() {
  redirect("/sandbox");
}
