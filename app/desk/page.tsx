import { redirect } from "next/navigation";

// The old operator "control room" is retired. The product is the trader-facing edge on /edge.
export default function DeskPage() {
  redirect("/edge");
}
