"use client";

// ConvexAuthProvider behaves like a plain ConvexProvider until Person A's
// Convex Auth (A2) is deployed, so B1 can add sign-in without swapping providers.

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is empty. Run `npx convex dev` to fill in .env.local.");
}
const convex = new ConvexReactClient(url);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
