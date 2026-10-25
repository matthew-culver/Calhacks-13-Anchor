import type { Metadata } from "next";
import { StartFlow } from "./StartFlow";

export const metadata: Metadata = { title: "Get set up" };

export default function Start() {
  return <StartFlow />;
}
