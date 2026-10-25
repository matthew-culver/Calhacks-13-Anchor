# Anchor

**Keep scam emails away from Mom and Dad, and keep their kids in the loop without the worry
calls.** Built at Cal Hacks 13.0 by twin brothers whose parents are in their 70s.

Anchor watches a parent's Gmail. Fakes quietly leave the inbox, an AI investigator explains the
suspicious ones to the adult kid step by step, and the parent gets one simple page of big buttons
for every account they really use. The parent installs nothing and learns nothing: they tap one
link from their kid and say yes to Google.

## What it does

| | |
|---|---|
| **Scams leave the inbox quietly** | Every new email is checked within a minute against who the parent really deals with. Fakes move to an "Anchor: Held" folder (never deleted); unsure ones get a "⚠ Check with [kid]" label and go to the kid. |
| **An AI investigator you can watch** | For suspicious mail, Claude (with web search and fetch) looks up the company's real addresses and follows each link without clicking it. The kid watches the steps live and gets a plain verdict with sources. |
| **It knows the family** | Family emails about bills and Venmo are left alone; a hacked family account asking for gift cards is caught; a stranger using a family member's name from a new address is flagged, and a look-alike address is held. |
| **The parent's front door** | Their real accounts, found from their own email and ranked by real use, each a big button to the company's real sign-in page. |
| **A loop that goes both ways** | The kid gets an alert only when something needs them, answers with one tap, and adds a note that reaches the parent in their own words (the parent can reply straight back). The parent can ask about any email by moving it to "⚠ Check with [kid]" in Gmail and see the answer on their page. One calm note a week, with one plain lesson. |

Try it without signing in: run the app and open `/kid?demo=1` (sample data).

## How it decides

```
new email ─► parse (in memory, never stored)
          ─► deterministic checks: SPF/DKIM/DMARC · claimed identity vs. real domains ·
             look-alike and homoglyph domains · link unwrapping, domain age (RDAP),
             Safe Browsing · pressure (gift cards, wires, crypto, secrecy) · hidden text
          ─► relationship check against the parent's own history (accounts, family,
             known contacts' names)
          ─► rule level (real / unsure / fake)  ◄── the floor
          ─► Claude explains and investigates: can only make it STRICTER
          ─► Gmail: hold or label · kid's feed (live) · parent's note in the kid's words
```

Safety rules are enforced in code, not just asked for in a prompt: the AI can never lower a
deterministic red flag; email text is marked untrusted; once it has read an email's text it can
only raise; its sources must come from its own tool results; clearing an email needs our own
data (the company's real, authenticated address on our curated list); the parent never sees
model text. Held scam emails never count toward "someone the parent knows".

**Privacy:** email bodies are never stored. For a flagged email (or one the parent asks about)
the sender and subject are kept so the kid can see what was caught; for everything else, only
the sender's domain and the verdict. The kid sees only those emails, never the inbox. Gmail scope is
`gmail.modify` only: labels and moving mail, never sending as the parent or deleting. Turning
Anchor off revokes Google access and deletes the family's data.

## Measured

`convex/accuracy.test.ts` runs 50 labeled emails (scams built from FTC and AARP warning patterns,
and everyday mail including family bills and links) through the whole pipeline with no AI and no
network: **24 of 24 scams caught, 22 held automatically, 0 of 26 real emails held.** The test
fails if a real email is ever held or a scam is missed. Details: [docs/ACCURACY.md](docs/ACCURACY.md).
About 660 automated tests in all (`npx vitest run`).

## Built with

Next.js + TypeScript + Tailwind on the front; **Convex** for the whole backend (database,
functions, a cron that checks each family's mail every minute, scheduled jobs for Gmail actions
with retries, Convex Auth, and live queries that update the kid's feed, the investigation steps
and the parent's accounts instantly); the Gmail API; **Claude** (`claude-opus-5-5`, Anthropic
SDK, web search and web fetch); RDAP; Google Safe Browsing.

| Where | What |
|---|---|
| `convex/mailWatch.ts` | the per-minute check of new mail, and the parent asking |
| `convex/checks/` | the deterministic checks and the relationship check |
| `convex/investigations.ts`, `convex/lib/investigator.ts` | the AI investigator and its rules |
| `convex/gmailImport.ts`, `convex/lib/history.ts` | learning accounts, relationships and names from two years of headers |
| `convex/gmailActions.ts` | holding, labeling, the kid's notes and the weekly note |
| `src/app/` | the kid's app, the parent's pages, the invite and the front page |

## Running it

1. `npm install`
2. `npx convex dev` (log in and pick the project; it writes `CONVEX_DEPLOYMENT` and
   `NEXT_PUBLIC_CONVEX_URL` to `.env.local` and keeps syncing `convex/`).
3. `npm run dev`, then open http://localhost:3000.
4. Server secrets live on the Convex deployment, never in the repo (`.env.example` lists them):
   `npx convex env set ANTHROPIC_API_KEY ...`, plus the Google OAuth client, Safe Browsing key,
   Convex Auth keys (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`), and `ANCHOR_GMAIL_ACTIONS=on` to let
   Anchor change Gmail.
5. Google OAuth runs in **testing mode**: only listed test users can connect, and connections
   expire after 7 days. Production needs Google's verification and security review.

The demo script, test emails and backup plan are in [docs/DEMO.md](docs/DEMO.md). The original
plan and design rules are in [CLAUDE.md](CLAUDE.md); the shared data shapes in
[convex/contract.ts](convex/contract.ts).

Never commit `.env.local`, Google credentials or any API key (`.gitignore` covers them).
