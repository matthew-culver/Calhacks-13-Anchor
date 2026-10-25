# Build tasks

Work top to bottom. Each task is one branch and one pull request into `main`.
Check a box when its PR is merged. The plan and rules are in [CLAUDE.md](CLAUDE.md), and the data shapes are in [convex/contract.ts](convex/contract.ts).

**How to run a task with Claude:** open your own session in this repo and say:
> I'm Person A (or B). Read CLAUDE.md and TASKS.md, then do task A1 with /ecc:orch-add-feature. Branch: a/checks.

---

## Person A: the brain (`convex/`)

- [ ] **A0. Keys and Google setup (by hand, about 30 min).** This has the most waiting, so do it first.
  1. Make a Google Cloud project. Turn on the **Gmail API** and the **Safe Browsing API**.
  2. Set up the OAuth consent screen: External, **Testing** mode. Add the test users (your parents' Gmail plus a demo Gmail).
  3. Create an OAuth client (Web application). Use the redirect URI `<NEXT_PUBLIC_CONVEX_SITE_URL>/gmail/callback`, where the base URL is in `.env.local`.
  4. Get an Anthropic API key (check the Cal Hacks starter pack for credits) and a Safe Browsing API key.
  5. Store them all in Convex with `npx convex env set ANTHROPIC_API_KEY ...`. Do the same for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SAFE_BROWSING_API_KEY`.
- [ ] **A1. Checks as pure functions, with tests.** No Gmail needed yet. In `convex/checks/`, write `headerAuth`, `claimedIdentity`, `linkAudit` (display text vs. href, lookalikes, shorteners) and `pressure`. Each one takes a parsed email and returns a `CheckResult`. Turn the real test emails into fixtures in `convex/checks/fixtures/`.
- [ ] **A2. Kid sign-in and families.** Convex Auth with password sign-in (`convex/auth.ts`, `auth.config.ts`, `http.ts`). Add `createFamily` (makes the invite and parent tokens) and `getInvite`, which returns only `{ parentName, kidName, status }`.
- [ ] **A3. Gmail connect.** Add HTTP routes `/gmail/start?invite=` and `/gmail/callback`. The invite travels in `state`. Store tokens in `gmailTokens` (internal only), clear the invite, and set status to `learning`.
- [ ] **A4. History import → My Accounts.** Read 2 years of headers only. Build `relationships`, then `accounts` from a curated directory of about 40 common organizations (domains plus official login URL).
- [ ] **Checkpoint 1 (hour 6):** a real Gmail connects and My Accounts appears.
- [ ] **A5. New mail → verdict.** Add a cron that polls each `active` family through the Gmail history API. Run the checks plus the `relationship` and `injection` checks, then Claude for the explanation (floor rule, banned-word filter). Write the `verdicts` and `feedItems`.
- [ ] **A6. Gmail actions.** Create the labels, hold or label each email, and send the parent note once (`parentNoteSentAt`). Apply the kid's answers (release or hold, then send the note).
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## Person B: the experience (`src/`)

- [ ] **B0. App shell.** Add the Convex provider in `layout.tsx`. Create the routes: `/` (landing), `/start` (kid sign-up), `/kid` (feed), `/kid/accounts`, `/invite/[token]` (the parent's one tap), `/p/[token]` (the parent page). Add design tokens: big text, high contrast, one action per screen.
- [ ] **B1. Kid onboarding** using mock data: sign up, then "Who are we protecting?" (name and email), then a share-the-link screen with copy and text buttons.
- [ ] **B2. Parent one-tap page** `/invite/[token]`: a short video spot, one big "Protect my email" button, then "You're done. You don't need to do anything else."
- [ ] **B3. Kid feed** from `mockFeed`: needs-answer items first, held items below. A detail view shows the plain checks. Add "It's fine" and "It's a scam" buttons plus an optional note.
- [ ] **B4. My Accounts:** a kid version and a parent big-text version (`/p/[token]`). No link when `loginUrl` is empty.
- [ ] **B5. Weekly recap card** ("41 checked, 2 held, 0 need a call") and the parent's "Turn it off" button.
- [ ] **Checkpoint 1 (hour 6):** swap mocks for real Convex queries where A's functions exist.
- [ ] **B6. Accessibility pass** (ECC `accessibility` skill) on the parent screens.
- [ ] **B7. Story:** a 60-second setup video, the pitch deck and the Devpost write-up.
- [ ] **Checkpoint 2 (hour 11): feature freeze.**

## Together
- [ ] Decide who is Person A and who is Person B.
- [ ] Collect about 10 real test emails (scams and real ones) plus one prompt-injection email, and save them as `.eml` files for A1.
- [ ] Change `convex/contract.ts` only together.
- [ ] At hour 6, point both `.env.local` files at one Convex deployment for integration.
