import { Screen } from "@/components/ui";
import { mockFamily } from "@/shared/mock";

// B4 adds the big-text My Accounts list here, and B5 the "Turn it off" button.
// Mock data until Checkpoint 1, when the token looks up the real family.
export function ParentScreen({ token, justConnected }: { token: string; justConnected?: boolean }) {
  const family = token ? mockFamily : null;

  // Person A's /gmail/callback lands here with ?connected=1 after Google says yes.
  if (justConnected) {
    return (
      <Screen title="You're done">
        <p className="text-xl">You don&apos;t need to do anything else.</p>
        <p className="text-lg text-muted">
          {`We'll quietly set aside scam emails, and ${family?.kidName ?? "your family"} hears about anything we're not sure of.`}
        </p>
      </Screen>
    );
  }

  return (
    <Screen title={`Hi ${family?.parentName ?? "there"}`}>
      <p className="text-lg text-muted">
        {`${family?.kidName ?? "Your family"} sees only the emails we set aside, and your list of accounts.`}
      </p>
    </Screen>
  );
}
