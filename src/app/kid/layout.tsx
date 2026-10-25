import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { KidNav } from "@/components/KidNav";
import { SiteHeader } from "@/components/ui";

// The page itself runs in the browser, so its title is set here (WCAG 2.4.2).
// Pages under /kid name themselves too, so this passes the " · Anchor" ending down.
export const metadata: Metadata = { title: { default: "This week", template: "%s · Anchor" } };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader home="/kid">
        {/* The nav reads the address to mark where you are, which only exists in the browser. */}
        <Suspense fallback={<KidNav path="" />}>
          <KidNav />
        </Suspense>
      </SiteHeader>
      {children}
    </>
  );
}
