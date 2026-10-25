import { Suspense } from "react";
import { ItemScreen } from "./ItemScreen";

type Params = PageProps<"/kid/item/[id]">["params"];

export default function ItemPage({ params }: PageProps<"/kid/item/[id]">) {
  // The id is only known at request time, so it streams in behind Suspense.
  return (
    <Suspense>
      <Item params={params} />
    </Suspense>
  );
}

async function Item({ params }: { params: Params }) {
  const { id } = await params;
  return <ItemScreen id={id} />;
}
