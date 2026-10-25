# Build tasks

Work top to bottom. Each task is one branch and one pull request into `main`.
Check a box when its PR is merged. The plan and rules are in [CLAUDE.md](CLAUDE.md), and the data shapes are in [convex/contract.ts](convex/contract.ts).

**How to run a task with Claude:** open your own session in this repo and say:
> I'm Person A (or B). Read CLAUDE.md and TASKS.md, then do task A1 with /ecc:orch-add-feature. Branch: a/checks.

---

## Person A: the brain (`convex/`)

- [x] **A0. Keys and Google setup (by hand, about 30 min).** This has the most waiting, so do it first.
  1. Make a Google Cloud project. Turn on the **Gmail API** and the **Safe Browsing API**.
  2. Set up the OAuth consent screen: External, **Testing** mode. Add the test users (your parents' Gmail plus a demo Gmail).
  3. Create an OAuth client (Web application). Use the redirect URI `<NEXT_PUBLIC_CONVEX_SITE_URL>/gmail/callback`, where the base URL is in `.env.local`.
  4. Get an Anthropic API key (check the Cal Hacks starter pack for credits) and a Safe Browsing API key.
  5. Store them all in Convex with `npx convex env set ANTHROPIC_API_KEY ...`. Do the same for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SAFE_BROWSING_API_KEY`.
  6. Set `SITE_URL` to the website's origin: `http://localhost:3000` in dev (already set), and the real URL once deployed. Sign-in and Gmail connect both depend on it.
- [x] **A1. Checks as pure functions, with tests.** No Gmail needed yet. In `convex/checks/`, write `headerAuth`, `claimedIdentity`, `linkAudit` (display text vs. href, lookalikes, shorteners) and `pressure`. Each one takes a parsed email and returns a `CheckResult`. Turn the real test emails into fixtures in `convex/checks/fixtures/`.
- [x] **A2. Kid sign-in and families.** Convex Auth with password sign-in (`convex/auth.ts`, `auth.config.ts`, `http.ts`). Add `createFamily` (makes the invite and parent tokens) and `getInvite`, which returns only `{ parentName, kidName, status }`.
- [x] **A3. Gmail connect.** Add HTTP routes `/gmail/start` and `/gmail/callback`. Store tokens in `gmailTokens` (internal only), clear the invite, and set status to `learning`. Security rules from the A2 review, all required:
  1. **Never send the raw invite token to Google.** At `/gmail/start`, check the invite (status `invited` or `needs_reconnect`, `inviteExpiresAt > Date.now()`) in an internal mutation. Then store a fresh single-use `state` nonce (`randomToken()`, the familyId, 10-minute expiry), set it in an `HttpOnly; Secure; SameSite=Lax` cookie, and send only the nonce as `state`, with PKCE. Prefer POST from the invite page.
  2. **Exchange first, then consume.** On the callback: check the nonce matches the cookie, exchange the code, verify the ID token (`email_verified`), and require the Google email to equal `family.parentEmail` (lowercase, treat `googlemail.com` as `gmail.com`). Require scope `gmail.modify` only. Use `access_type=offline` and `prompt=consent`.
  3. **Connect in one internal mutation:** re-check status and expiry, insert `gmailTokens`, set `learning` and `connectedAt`, clear `inviteToken`, `inviteExpiresAt` and the nonce. If anything fails before this, the invite must still work.
  4. **Redirect** the parent to a page keyed by `parentToken` (the done screen), not back to `/invite/[token]`, which shows nothing once the invite is used.
- [x] **A4. History import → My Accounts.** Read 2 years of headers only. Build `relationships`, then `accounts` from a curated directory of about 40 common organizations (domains plus official login URL).
  - Runs on its own after the parent connects. Status goes `learning` → `active`.
  - **Demo mode** builds My Accounts from a sample inbox (no Gmail needed): `npx convex run gmailImport:importSample '{"familyId":"<id>"}'`. Find the family id in the Convex dashboard under Data → families.
  - An org only counts as an account after 3 or more authenticated emails over at least 2 weeks (or after the parent wrote to it), so a scam, or one triggered email, can't plant one.
- [ ] **Checkpoint 1 (hour 6):** a real Gmail connects and My Accounts appears.
- [x] **A5. New mail → verdict.** Notes from the A3 review:
  - Live: a cron checks every active family each minute (`convex/mailWatch.ts`). Six checks (A1's five plus `relationship`); Claude (`convex/lib/explain.ts`) writes only the kid's explanation and can raise the level, never lower it. The parent always gets a fixed calm message.
  - Fails closed: an email over 5 MB, or one that fails 3 times, becomes "unsure, we couldn't check it". One poll per family at a time; after a week offline it re-checks the last 2 days.
  - **Refresh tokens expire after 7 days in Google's testing mode.** When Google's token endpoint answers `invalid_grant`, set the family to `needs_reconnect`, and the kid's screen offers a new link. **Reconnect the demo accounts right before presenting.**
  - Add a shared `refreshAccessToken` (in `convex/lib/oauth.ts`) used by both A4 and A5: refresh when `expiresAt - 60s < now`, then save the new `accessToken` and `expiresAt`.
  - A stale `historyId` makes Gmail's `history.list` return 404. Fall back to a fresh sync.
   Add a cron that polls each `active` family through the Gmail history API. Run the checks plus the `relationship` and `injection` checks, then Claude for the explanation (floor rule, banned-word filter). Write the `verdicts` and `feedItems`.
- [ ] **A6. Gmail actions.** Also: skip Anchor's own parent notes in `newMessageIds` (label them, or add an `X-Anchor` header), or each note gets its own verdict. Add the `turnOff({ parentToken })` mutation for B5: delete the family's rows, revoke the Google grant, set status `off`. Create the labels, hold or label each email, and send the parent note once (`parentNoteSentAt`). Apply the kid's answers (release or hold, then send the note).
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## Person B: the experience (`src/`)

- [ ] **B0. App shell.** Add the Convex provider in `layout.tsx`. Create the routes: `/` (landing), `/start` (kid sign-up), `/kid` (feed), `/kid/accounts`, `/invite/[token]` (the parent's one tap), `/p/[token]` (the parent page). Add design tokens: big text, high contrast, one action per screen.
- [ ] **B1. Kid onboarding:** sign up, then "Who are we protecting?" (name and email), then a share-the-link screen with copy and text buttons. A2's functions are live:
  - **Sign up and sign in:** `useAuthActions().signIn("password", formData)`, with a `flow` field of `"signUp"` or `"signIn"` plus `email` and `password` (8 or more characters).
  - **Setup:** `api.families.createFamily({ parentName, parentEmail, kidName })` returns `{ familyId, inviteToken }`. The invite link is `/invite/<inviteToken>`.
  - **Status:** `api.families.getMyFamily` returns `null` before setup. It includes `inviteToken` and `inviteExpiresAt` only while waiting for the parent. `api.families.renewInvite` makes a new link.
  - **Errors** are `ConvexError`s. Show `err instanceof ConvexError ? err.data : "Something went wrong"`.
- [ ] **B2. Parent one-tap page** `/invite/[token]`: a short video spot, one big "Protect my email" button, then "You're done. You don't need to do anything else."
  - `api.families.getInvite({ token })` returns `{ parentName, kidName, kidEmail, status, inviteExpiresAt }`.
  - **Show who is asking:** "Lucas (lucas@…) wants to help keep scam emails away from you. Only continue if Lucas asked you." Anyone can sign up and claim to be a kid, so this line matters.
  - **Expired** means `inviteExpiresAt < Date.now()`. Compare in the page, don't pass time to the query.
  - **`null`** means "This link was already used or has expired. Ask [kid] for a new one." It's not an error.
  - **"Protect my email" must be a plain form POST** (A3 is live), so the invite never appears in a URL. It can't be a `fetch` call, because the browser has to follow Google's redirect. /gmail/start only accepts posts from our own site, so keep the site's `referrer` setting at `strict-origin-when-cross-origin`. With `no-referrer`, browsers send `Origin: null` and the request is refused.
    ```tsx
    <form method="POST" action={`${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/gmail/start`}>
      <input type="hidden" name="invite" value={token} />
      <button type="submit">Protect my email</button>
    </form>
    ```
  - **After Google, the parent lands on one of two pages:**
    - Success: `/p/<parentToken>?connected=1`. Show "You're done. You don't need to do anything else."
    - Failure: `/connect-problem?reason=<reason>`. Build this page with one plain sentence and one next step per reason:
      | reason | Say |
      |---|---|
      | `invite_invalid` | "This link was already used. Ask [kid] for a new one." |
      | `invite_expired` | "This link expired. Ask [kid] to send a new one." |
      | `cancelled` | "No problem, nothing was changed. Tap the link again when you're ready." |
      | `session` | "That took a little too long. Please tap the link again." |
      | `wrong_account` | "That was a different Google account. Tap the link again and pick [parent email]." |
      | `missing_permission` | "Anchor needs permission to sort your email. Tap the link again and leave the box checked." |
      | `already_protected` | "This Gmail is already protected by Anchor." |
      | `google_error` | "Google had a hiccup. Please try again in a minute." |
      Use the reason only for the wording. Don't put tokens or emails in this URL.
- [ ] **B3. Kid feed** from `mockFeed`: needs-answer items first, held items below. A detail view shows the plain checks. Add "It's fine" and "It's a scam" buttons plus an optional note.
- [ ] **B4. My Accounts:** a kid version and a parent big-text version (`/p/[token]`). No link when `loginUrl` is empty. A4 is live:
  - Kid: `useQuery(api.accounts.myAccounts)`. Parent: `useQuery(api.accounts.parentAccounts, { parentToken })`. Both return `{ _id, orgName, category, officialDomains, loginUrl?, firstSeen, messageCount }[]`, sorted by name.
  - While `getMyFamily().status === "learning"`, show "Learning who [parent] really deals with…". It takes under a minute.
  - Say "in your email for 2 years" rather than "customer since". It's mail seen, not proof of an account.
  - On the parent page, call `api.families.getParentView({ parentToken })` alongside it. It returns `{ parentName, kidName, status }`, or `null` for a bad link, so the page can tell `learning` ("Getting to know your email…") from `off` ("Protection is off") and from an empty list.
- [ ] **B5. Weekly recap card** ("41 checked, 2 held, 0 need a call") and the parent's "Turn it off" button. Data for the recap: `api.feed.myWeeklyRecap({ now })` and `api.feed.parentWeeklyRecap({ parentToken, now })`. Round `now` to the minute so the query isn't re-run every render. The feed is `api.feed.myFeed` / `api.feed.parentFeed`. The turn-off mutation comes in A6. Make "Turn it off" a button that triggers a mutation, never a plain link. Email scanners open links automatically and would switch it off. The parent page is view-only otherwise.
- [ ] **Checkpoint 1 (hour 6):** swap mocks for real Convex queries where A's functions exist.
- [ ] **B6. Accessibility pass** (ECC `accessibility` skill) on the parent screens.
- [ ] **B7. Story:** a 60-second setup video, the pitch deck and the Devpost write-up.
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## Together
- [ ] Decide who is Person A and who is Person B.
- [ ] Collect about 10 real test emails (scams and real ones) plus one prompt-injection email, and save them as `.eml` files for A1.
- [ ] Change `convex/contract.ts` only together.
- [ ] At hour 6, point both `.env.local` files at one Convex deployment for integration.
