import { BigButton, Screen } from "@/components/ui";

export default function Home() {
  return (
    <Screen title="Keep scam emails away from Mom and Dad">
      <p className="text-lg text-muted">
        Anchor checks every email your parent gets. Fakes are set aside, and you
        hear about the ones that need a second look.
      </p>
      <BigButton href="/start">Protect someone you love</BigButton>
    </Screen>
  );
}
