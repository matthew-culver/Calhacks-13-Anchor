"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { BigButton, Screen } from "@/components/ui";
import { leaveDemo, useDemoMode } from "@/shared/demoMode";
import { mockFamily } from "@/shared/mock";
import { api } from "../../convex/_generated/api";

export type KidFamily = NonNullable<FunctionReturnType<typeof api.families.getMyFamily>>;

const SAMPLE_FAMILY: KidFamily = {
  _id: mockFamily._id,
  parentName: mockFamily.parentName,
  parentEmail: mockFamily.parentEmail,
  kidName: mockFamily.kidName,
  status: "active",
};

/**
 * The kid's pages only make sense once they're signed in and their parent is connected.
 * This shows the right screen for every other state, and renders the page for "learning"
 * and "active". Demo mode skips straight to the sample family.
 */
export function KidGate({ children }: { children: (family: KidFamily, demo: boolean) => ReactNode }) {
  const demo = useDemoMode();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const family = useQuery(api.families.getMyFamily, !demo && isAuthenticated ? {} : "skip");

  if (demo) return children(SAMPLE_FAMILY, true);
  if (!isLoading && !isAuthenticated) {
    return (
      <Screen focusTitle title="Please sign in">
        <BigButton href="/start">Sign in</BigButton>
      </Screen>
    );
  }
  if (family === undefined) {
    return <LoadingScreen />;
  }
  if (family === null) {
    return (
      <Screen focusTitle title="Let's set up protection first">
        <BigButton href="/start">Get started</BigButton>
      </Screen>
    );
  }
  const { parentName, status } = family;
  if (status === "invited" || status === "needs_reconnect") {
    return (
      <Screen focusTitle title={`Waiting for ${parentName}`}>
        <p className="text-lg text-muted">
          {status === "invited"
            ? `Everything starts a minute after ${parentName} taps the link you sent.`
            : `Anchor lost access to ${parentName}'s email. Send a new link to turn it back on.`}
        </p>
        <BigButton href="/start">{`See ${parentName}'s link`}</BigButton>
      </Screen>
    );
  }
  if (status === "off") {
    return (
      <Screen focusTitle title={`${parentName} turned protection off`}>
        <p className="text-lg text-muted">We deleted everything we had learned.</p>
      </Screen>
    );
  }
  return children(family, false);
}

/** A small, honest note on screens showing the sample family. */
export function SampleDataNote({ other, leaveHref = "?demo=0" }: { other?: { href: string; label: string }; leaveHref?: string }) {
  // Demo mode sticks for the whole tab, so the way out is always right here, and the other
  // side of the family (the kid's or the parent's) is one tap away.
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-2 border-transparent bg-unsure-tint px-4 py-2 text-lg text-unsure">
      <span>Sample data for the demo</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {other && (
          <a href={other.href} className="inline-block py-1 font-semibold underline">
            {other.label}
          </a>
        )}
        <a href={leaveHref} onClick={leaveDemo} className="inline-block py-1 font-semibold underline">
          Leave the demo
        </a>
      </span>
    </p>
  );
}
