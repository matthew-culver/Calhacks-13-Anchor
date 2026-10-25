import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/ui";
import { InviteScreen } from "./InviteScreen";

export const metadata: Metadata = { title: "Protect your email" };

type Params = PageProps<"/invite/[token]">["params"];

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  // The token is only known at request time, so it streams in behind Suspense.
  return (
    <>
      <SiteHeader home={null} />
      <Suspense>
        <Invite params={params} />
      </Suspense>
    </>
  );
}

async function Invite({ params }: { params: Params }) {
  const { token } = await params;
  return <InviteScreen token={token} />;
}
