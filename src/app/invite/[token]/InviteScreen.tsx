import { BigButton, Screen } from "@/components/ui";

// Person A's Gmail connect route (A3) lives on the Convex site URL. Prefer the
// explicit variable; otherwise derive it from the deployment URL (".cloud" -> ".site").
const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(/\.cloud$/, ".site");

// B2 adds the video spot, the kid's name from getInvite and the "You're done" screen.
export function InviteScreen({ token }: { token: string }) {
  return (
    <Screen title="Protect your email">
      <p className="text-lg text-muted">
        One tap, and we&apos;ll watch for scam emails for you.
      </p>
      <BigButton
        href={`${convexSiteUrl}/gmail/start?invite=${encodeURIComponent(token)}`}
      >
        Protect my email
      </BigButton>
    </Screen>
  );
}
