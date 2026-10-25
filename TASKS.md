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
- [x] **A6. Gmail actions.** Also: skip Anchor's own parent notes in `newMessageIds` (label them, or add an `X-Anchor` header), or each note gets its own verdict. Add the `turnOff({ parentToken })` mutation for B5: delete the family's rows, revoke the Google grant, set status `off`. Create the labels, hold or label each email, and send the parent note once (`parentNoteSentAt`). Apply the kid's answers (release or hold, then send the note).
  - **Safety switch: OFF by default.** Nothing changes in anyone's Gmail until you run `npx convex env set ANCHOR_GMAIL_ACTIONS on`. Turn it off again with `npx convex env remove ANCHOR_GMAIL_ACTIONS`. With it off, verdicts and kid answers are still recorded, and a repair cron applies anything pending within about 5 minutes of turning it on.
  - What it does: fake mail moves to the "Anchor: Held" label (out of the inbox); unsure mail gets "⚠ Check with [kid]"; each one sends the parent a short plain-text note from "Anchor". Kid answers release or hold the email and send the parent the kid's words (links, addresses and numbers removed). The note never quotes the scammer's text.
  - `api.turnOff.turnOff({ parentToken })`: off at once, Google access revoked (retried until it works), all email-derived data deleted. The kid can set up again once cleanup finishes (usually under a minute).
  - Sign-in emails are now lowercased on the server. An account created with capital letters by some other route (the app already lowercased) would need re-creating.
  - Before relying on it in the demo, check once with the switch on: a held email lands in "Anchor: Held", and exactly one note arrives per email.
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## Person B: the experience (`src/`)

- [x] **B0. App shell.** Add the Convex provider in `layout.tsx`. Create the routes: `/` (landing), `/start` (kid sign-up), `/kid` (feed), `/kid/accounts`, `/invite/[token]` (the parent's one tap), `/p/[token]` (the parent page). Add design tokens: big text, high contrast, one action per screen.
- [x] **B1. Kid onboarding:** sign up, then "Who are we protecting?" (name and email), then a share-the-link screen with copy and text buttons. A2's functions are live:
  - **Sign up and sign in:** `useAuthActions().signIn("password", formData)`, with a `flow` field of `"signUp"` or `"signIn"` plus `email` and `password` (8 or more characters).
  - **Setup:** `api.families.createFamily({ parentName, parentEmail, kidName })` returns `{ familyId, inviteToken }`. The invite link is `/invite/<inviteToken>`.
  - **Status:** `api.families.getMyFamily` returns `null` before setup. It includes `inviteToken` and `inviteExpiresAt` only while waiting for the parent. `api.families.renewInvite` makes a new link.
  - **Errors** are `ConvexError`s. Show `err instanceof ConvexError ? err.data : "Something went wrong"`.
- [x] **B2. Parent one-tap page** `/invite/[token]`: a short video spot, one big "Protect my email" button, then "You're done. You don't need to do anything else."
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
- [x] **B3. Kid feed** from `mockFeed` (backend live: in `src/shared/feedApi.ts`, swap `useFeed` to `useQuery(api.feed.myFeed)` and `useAnswerFeedItem` to `useMutation(api.feed.answer)`; both match `FeedEntry` and `Answer` exactly. `myFeed` is `[]` before the parent connects and after "off". `answer` errors are ConvexErrors: "You already answered this one.", "We couldn't find that message.", "Protection isn't on for your family right now."): needs-answer items first, held items below. A detail view shows the plain checks. Add "It's fine" and "It's a scam" buttons plus an optional note.
- [x] **B4. My Accounts:** (Showing an email as "held": `verdict.action` is the decision, `verdict.actionAppliedAt` means it really happened in Gmail. Before that, say "being held…".) a kid version and a parent big-text version (`/p/[token]`). No link when `loginUrl` is empty. A4 is live:
  - Kid: `useQuery(api.accounts.myAccounts)`. Parent: `useQuery(api.accounts.parentAccounts, { parentToken })`. Both return `{ _id, orgName, category, officialDomains, loginUrl?, firstSeen, messageCount }[]`, sorted by name.
  - While `getMyFamily().status === "learning"`, show "Learning who [parent] really deals with…". It takes under a minute.
  - Say "in your email for 2 years" rather than "customer since". It's mail seen, not proof of an account.
  - On the parent page, call `api.families.getParentView({ parentToken })` alongside it. It returns `{ parentName, kidName, status }`, or `null` for a bad link, so the page can tell `learning` ("Getting to know your email…") from `off` ("Protection is off") and from an empty list.
- [x] **B5. Weekly recap card** ("41 checked, 2 held, 0 need a call") and the parent's "Turn it off" button. Data for the recap: `api.feed.myWeeklyRecap({ now })` and `api.feed.parentWeeklyRecap({ parentToken, now })`. Round `now` to the minute so the query isn't re-run every render. The feed is `api.feed.myFeed` / `api.feed.parentFeed`. Turn-off is live: `useMutation(api.turnOff.turnOff)({ parentToken })`. Call it only from an explicit button click with a "Yes, turn it off" confirm step, never on page load or from a link, since email scanners open links. After it runs, `getParentView` shows `status: "off"`. Email scanners open links automatically and would switch it off. The parent page is view-only otherwise.
- [ ] **Checkpoint 1 (hour 6):** swap mocks for real Convex queries where A's functions exist.
- [x] **B6. Accessibility pass** (ECC `accessibility` skill) on the parent screens.
- [ ] **B7. Story:** a 60-second setup video, the pitch deck and the Devpost write-up.
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## v2: the final 9 hours (see "v2 direction" in CLAUDE.md)

### Person A
- [x] **A7. Investigator agent.** Live. Family rules: the kid's sign-in address is trusted automatically; `api.feed.answer({ ..., answer: "fine", trustSender: true })` marks any sender "always trust" (B9: add an "Always trust this sender" checkbox next to "It's fine"). Trusted and familiar senders are flagged only for hard red flags (a link our checks found dangerous, gift cards/wire/crypto/secrecy, replies redirected), never for bills, Venmo or "ASAP". `investigations.forFeedItemParent` returns only `{ status, level, sender, links: [{ site, verdict }] }` (no model text for the parent). Original spec: Claude (`claude-opus-5-5`) with web search/fetch + RDAP + Safe Browsing + history, run for every unsure email and for familiar senders acting unlike themselves (new link site that isn't an established site, document/sign-in lures, money or urgency, reply-to mismatch, known name on a new address). Writes `investigations` rows live (steps appended as it works). Safety rules from CLAUDE.md enforced in code. Queries: `api.investigations.forFeedItem({ feedItemId })` (kid) and the parent equivalent.
- [x] **A8. Accounts v2.** Score accounts by real-use signals + recency (fills `rank`, `signals`, `lastActivity`); show many (not just 4), most important first; direct sign-in URLs for the curated list; agent-found official sign-in pages for others (`orgDirectory` table, only if the login host is the org's own domain). Fast first pass (~20 s, account-signal Gmail search), saving in batches so the screen fills in live; deeper pass after. `accounts.myAccounts` / `parentAccounts` return sorted by `rank` desc.
  - Built on `a/accounts-v2`. Queries: sorted by `rank` desc, then name (rows from before A8 last). New fields `rank`, `signals` (strongest first), `lastActivity`, `loginUrlSource`. Rows keep their `_id` while the import fills in, so animate by `_id`.
  - Companies outside our list show up as `category: "other"` with no link at first, and only after half a year of account mail from their own automated mailbox (a scammer's domain can pass email authentication too). Claude's lookup (`convex/signInPages.ts`) fills in `loginUrl` (`loginUrlSource: "discovered"`), the company's own name and category, usually within a minute; the rank doesn't change. Not in demo mode. Fails closed: no link unless the domain is a year old by RDAP and Safe Browsing answered (needs `SAFE_BROWSING_API_KEY` and `ANTHROPIC_API_KEY` on the deployment).
  - **B8:** show discovered links a little differently from our checked list (e.g. "Found by Anchor"), and update the "Only the verified login page from our directory" comment in `AccountList.tsx`.
  - **Before the demo, smoke-test one real lookup** (never run against the real API yet): `npx convex run signInPages:lookUp '{"domain":"<a real local company's domain>","familyId":"<id>","nameHint":"<its name>"}'`, then check Data → orgDirectory.
  - Schema: added optional `orgDirectory.lookupStartedAt`.
  - Ranking: an account's score halves for every two months without account mail, so an account Mom stopped using sinks below the ones she uses now (and a saved order stays right as time passes). `att-mail.com` is AT&T (AT&T says all its email comes from there).
  - Mail Anchor flagged (unless the kid called it fine) never counts as history, so a scammer can't become "someone Mom knows" on a re-import.
  - Timing (simulated at real Gmail pacing): accounts on screen ~2 s after connecting, first pass ~10 s, then re-sorts every ~10 s during the deeper pass. Subjects are read in memory only, never stored.
- [x] **A9. Quiet mode.** No note per held or unsure email (they just leave the inbox or get the "Check with" label). One calm weekly note to Mom on Sundays, only if anything happened. A short note with the kid's own words when they answer with a note; no note when they answer without one. For the demo, send the weekly note on demand: `npx convex run gmailActions:sendWeeklyNote '{"familyId":"<id>"}'` (needs `ANCHOR_GMAIL_ACTIONS` on).
- [ ] **Demo:** pre-connected demo account, scripted test emails (fake Chase, hacked-Aunt-Sue with a bad link, Aunt Sue with a YouTube link that stays real), runbook and backup plan.
  - Runbook, test emails, commands and backup plan: [docs/DEMO.md](docs/DEMO.md). Left: one full rehearsal on the real inbox.

### Overnight (Sunday 2:40-5:30 AM, while Lucas slept)
- [x] **Look and feel:** one design across every screen (header with the Anchor mark, cards, letter badges, tags, icons), a real front page (how it works, what the family gets, where it could go wrong, measured accuracy, a no-sign-in demo link), a shorter investigation page, phone-width fixes.
- [x] **Family impostors:** names of people the parent corresponds with are learned (import + as mail arrives, only from her sent mail and authenticated mail). A stranger using one from a new address, or a look-alike address, is flagged for the kid (held if it also asks for money). `contactNames` table.
- [x] **Mom asks:** moving any email to "⚠ Check with [kid]" in Gmail sends it to the kid's feed as "asked", with the investigation; the answer comes back in the kid's words. Feed kind `asked`, verdict `askedAt`.
- [x] **Heartbeat:** "Watching Mom's inbox · checked 2 minutes ago" on both sides (`gmailTokens.checkedAt`), with a plain warning if checks stop.
- [x] **Weekly lesson:** one fixed "One thing to remember" from what was caught, plus how to ask the kid.
- [x] **Accuracy eval:** `convex/accuracy.test.ts`, 44 labeled emails, report in `docs/ACCURACY.md`. Found and fixed missing impostor brands (Microsoft, Netflix, Zelle and more). A stranger's gift card/wire/crypto ask is now held.
- [x] **Docs:** product README, `docs/DEVPOST.md` draft, demo scenes 5a/5b and judge Q&A in `docs/DEMO.md`.
- [ ] **Morning:** rehearse every scene in `docs/DEMO.md` on the real inbox (especially 5a "Mom asks" and 5b "family impostor", which are new), then submit on Devpost by 9:00.

### Person B
- [x] **B8. Parent "front door" page.** Mom's accounts as big sign-in buttons, grouped (Money, Health, Bills, Shopping, Other), most important first (`rank` desc), animated as they appear and re-sort live during the import. No link when `loginUrl` is missing.
- [x] **B9. Live investigation view.** On the kid's item page: the agent's steps appearing live (`investigations.steps`), then the conclusion: sender finding, each link (safe / unknown / dangerous with reason), suggestion ("Maybe text Aunt Sue?"), sources.
- [x] **B10. Connect screen live.** After the parent connects, show accounts appearing and sorting in real time.
- [ ] **B7. Story** (after the hour-6 freeze): 60-second video, pitch deck, Devpost.

**Data shapes for B8–B10 are in `convex/contract.ts`** (`account` v2 fields, `investigation`). Build on sample data until A7/A8 land; the fields are optional so nothing breaks meanwhile.

**Hour-6 checkpoint: feature freeze.** Full demo end to end on a real inbox, then only fixes, demo and story.

## Together
- [ ] Decide who is Person A and who is Person B.
- [ ] Collect about 10 real test emails (scams and real ones) plus one prompt-injection email, and save them as `.eml` files for A1.
- [ ] Change `convex/contract.ts` only together.
- [ ] At hour 6, point both `.env.local` files at one Convex deployment for integration.
