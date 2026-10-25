import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself runs in the browser, so its title is set here (WCAG 2.4.2).
// Pages under /kid name themselves too, so this passes the " · Anchor" ending down.
export const metadata: Metadata = { title: { default: "This week", template: "%s · Anchor" } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
