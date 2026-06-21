// Command Center route — thin server component. The detection queue and the live
// operative war room render side by side in <CommandCenter />, a client component.
import type { Metadata } from "next";
import { CommandCenter } from "@/components/command/command-center";

export const metadata: Metadata = { title: "Command Center" };

export default function CommandPage() {
  return <CommandCenter />;
}
