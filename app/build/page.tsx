import { redirect } from "next/navigation";

// /build is retired — building a forecaster now happens inline on the Launch
// page (/desk), against the live match. Preserve a pre-attached ?paper so the
// "attach to a forecaster" links from /papers still land on the right builder.
export default async function BuildRedirect({
  searchParams,
}: {
  searchParams: Promise<{ paper?: string }>;
}) {
  const sp = await searchParams;
  redirect(sp.paper ? `/desk?paper=${encodeURIComponent(sp.paper)}` : "/desk");
}
