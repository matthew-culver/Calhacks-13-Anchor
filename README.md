# Anchor (working name)

A personal trust layer that protects older adults from email scams and keeps their adult kids in the loop. Built at Cal Hacks 13.0.

The full plan, design rules and two-person split are in [CLAUDE.md](CLAUDE.md). The data contract both halves build against is in [convex/contract.ts](convex/contract.ts).

## Stack
Next.js + TypeScript, Convex (database, server functions, crons, auth), the Gmail API, Claude (Anthropic SDK), Google Safe Browsing, RDAP.

## First-time setup (each twin)
1. Install packages:
   ```bash
   npm install
   ```
2. Start Convex. The first run asks you to log in and choose or create a project. **Pick the same project both times**, so you share one database:
   ```bash
   npx convex dev
   ```
   It writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local` and keeps running, syncing the `convex/` folder.
3. In a second terminal, start the web app:
   ```bash
   npm run dev
   ```
   Then open http://localhost:3000.
4. Server secrets live in Convex, not in the repo. One of you sets them once (see `.env.example` for the list):
   ```bash
   npx convex env set ANTHROPIC_API_KEY sk-ant-...
   ```

## Who works where
| | Person A: the brain | Person B: the experience |
|---|---|---|
| Folders | `convex/` (pipeline, Gmail, Claude), `convex/checks/` | `src/app/`, `src/components/` |
| Data | Writes `verdicts`, `accounts`, `relationships`, `feedItems` | Reads them; uses `src/shared/mock.ts` until real data flows |
| Branch | `a/<feature>` | `b/<feature>` |

**The contract rule:** change `convex/contract.ts` only together, and tell each other when you do.

## Building with Claude Code and ECC
- Plan each feature with `/ecc:plan`, then build it with `/ecc:orch-add-feature` (tests first, review, gated commit).
- Person A: turn the real test emails into tests for each check.
- Before each checkpoint (hours 6 and 11): run `/ecc:code-review`, plus the `security-reviewer` agent on anything touching Gmail.
- Before the demo: run the `accessibility` skill on the parent screens.

## Never commit
`.env.local`, Google `credentials.json` or `token.json`, or any API key. `.gitignore` already covers these.
