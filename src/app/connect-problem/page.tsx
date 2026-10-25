import { Suspense } from "react";
import { ConnectProblemScreen } from "./ConnectProblemScreen";

type SearchParams = PageProps<"/connect-problem">["searchParams"];

export default function ConnectProblemPage({ searchParams }: PageProps<"/connect-problem">) {
  // The reason is only known at request time, so it streams in behind Suspense.
  return (
    <Suspense>
      <ConnectProblem searchParams={searchParams} />
    </Suspense>
  );
}

async function ConnectProblem({ searchParams }: { searchParams: SearchParams }) {
  const { reason } = await searchParams;
  return <ConnectProblemScreen reason={typeof reason === "string" ? reason : undefined} />;
}
