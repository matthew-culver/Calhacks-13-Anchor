import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/ui";
import { ConnectProblemScreen } from "./ConnectProblemScreen";

export const metadata: Metadata = { title: "Let's try that again" };

type SearchParams = PageProps<"/connect-problem">["searchParams"];

export default function ConnectProblemPage({ searchParams }: PageProps<"/connect-problem">) {
  // The reason is only known at request time, so it streams in behind Suspense.
  return (
    <>
      <SiteHeader home={null} />
      <Suspense>
        <ConnectProblem searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ConnectProblem({ searchParams }: { searchParams: SearchParams }) {
  const { reason } = await searchParams;
  return <ConnectProblemScreen reason={typeof reason === "string" ? reason : undefined} />;
}
