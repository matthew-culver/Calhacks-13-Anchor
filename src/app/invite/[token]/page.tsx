import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteScreen } from "./InviteScreen";

export const metadata: Metadata = { title: "Protect your email" };

type Params = PageProps<"/invite/[token]">["params"];

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  // The token is only known at request time, so it streams in behind Suspense.
  return (
    <Suspense>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: Params }) {
  const { token } = await params;
  return <InviteScreen token={token} />;
}
