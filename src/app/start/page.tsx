import type { Metadata } from "next";
import { SiteHeader } from "@/components/ui";
import { StartFlow } from "./StartFlow";

export const metadata: Metadata = { title: "Get set up" };

export default function Start() {
  return (
    <>
      <SiteHeader />
      <StartFlow />
    </>
  );
}
