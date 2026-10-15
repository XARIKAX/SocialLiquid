import type { Metadata } from "next";
import { KeysStudio } from "@/components/keys/studio-view";

export const metadata: Metadata = { title: "Creator studio" };

export default function KeysStudioPage() {
  return <KeysStudio />;
}
