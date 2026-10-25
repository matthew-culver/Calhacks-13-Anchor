import { Suspense } from "react";
import { ParentScreen } from "./ParentScreen";

type Params = PageProps<"/p/[token]">["params"];

export default function ParentPage({ params }: PageProps<"/p/[token]">) {
  // The token is only known at request time, so it streams in behind Suspense.
  return (
    <Suspense>
      <Parent params={params} />
    </Suspense>
  );
}

async function Parent({ params }: { params: Params }) {
  const { token } = await params;
  return <ParentScreen token={token} />;
}
