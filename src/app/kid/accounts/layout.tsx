import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself runs in the browser, so its title is set here (WCAG 2.4.2).
export const metadata: Metadata = { title: "Accounts" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
