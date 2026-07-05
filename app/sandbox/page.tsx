import { redirect } from "next/navigation";

// The old operator sandbox is retired. Replay the edge on real matches at /edge.
export default function SandboxPage() {
  redirect("/edge");
}
