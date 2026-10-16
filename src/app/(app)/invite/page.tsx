import type { Metadata } from "next";
import { InviteView } from "@/components/invite/invite-view";

export const metadata: Metadata = { title: "Invite friends" };
export const dynamic = "force-dynamic";

export default function InvitePage() {
  return <InviteView />;
}
