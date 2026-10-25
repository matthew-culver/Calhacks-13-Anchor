import { Screen } from "@/components/ui";
import { mockFamily } from "@/shared/mock";

// B4 adds the big-text My Accounts list here, and B5 the "Turn it off" button.
// Mock data until Checkpoint 1, when the token looks up the real family.
export function ParentScreen({ token }: { token: string }) {
  const family = token ? mockFamily : null;
  return (
    <Screen title={`Hi ${family?.parentName ?? "there"}`}>
      <p className="text-lg text-muted">
        {`${family?.kidName ?? "Your family"} sees only the emails we set aside, and your list of accounts.`}
      </p>
    </Screen>
  );
}
