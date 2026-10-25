import type { Metadata } from "next";
import { Suspense } from "react";
import { ParentScreen } from "./ParentScreen";

export const metadata: Metadata = { title: "Your page" };

type Props = PageProps<"/p/[token]">;

export default function ParentPage({ params, searchParams }: Props) {
  // The token is only known at request time, so it streams in behind Suspense.
  return (
    <Suspense>
      <Parent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Parent({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { token } = await params;
  const { connected } = await searchParams;
  return <ParentScreen token={token} justConnected={connected === "1"} />;
}
