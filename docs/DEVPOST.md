# Anchor: Devpost draft

A starting point for the submission. Everything here is true of the build as of Sunday morning;
lines marked **[you]** need your own words or a fact to check before you paste.

**Tagline:** Keep scam emails away from Mom and Dad, and keep their kids in the loop without
the worry calls.

**For:** adult children of parents in their 70s who manage their own email.

## Inspiration

We're twin brothers, and our parents are 73. **[you: one real moment, like the email your mom
almost answered, or the call that started with "is this real?"]** Scam emails now look exactly
like the real thing, and the advice we give our parents ("check the address", "don't click
links") asks them to be security experts. Spam filters guess from the message alone. We wanted
something that knows who our parents actually deal with, quietly handles the obvious fakes,
and brings us in for the rest.

## What it does

Anchor connects to a parent's Gmail with one tap from a link their kid texts them. After that
the parent does nothing new:

- **Scams leave the inbox quietly.** Every new email is checked within a minute: who really
  sent it, where each link really goes (without anyone clicking), and whether it makes sense
  for *this* person. A perfect "Chase" email to someone who has never banked at Chase is a
  scam. Fakes move to an "Anchor: Held" folder they can always open. Nothing is deleted.
- **An AI investigator you can watch.** For anything suspicious, Claude researches like a
  careful person would: it looks up the company's real email addresses, follows the links,
  and the kid watches each step live, then reads a plain verdict on the sender and each link,
  with sources.
- **It knows your family.** Anchor learns the names of the people the parent writes to. A
  stranger using a family member's name from a new address, or an address that looks almost
  like theirs ("sue.miiler"), is flagged for the kid, and held if it also asks for money. A
  son's email asking Mom to pay the PG&E bill by Venmo is left alone, but the same son's
  hacked account asking for gift cards is caught.
- **Mom's front door.** One page of big buttons for every account she really uses (bank,
  doctor, phone bill), found from her own email, ranked by real use, each going straight to
  the real sign-in page. She never has to sign in through an email link again.
- **The loop goes both ways.** The kid gets an alert only when Anchor catches something or the
  parent asks, answers with one tap, and adds a note that reaches the parent in their own words;
  the parent can just hit Reply to write back. And the parent can ask: move any email to the "⚠ Check with
  Lucas" folder in Gmail, and the kid gets it with the AI investigation, while the parent's
  page shows "Lucas is looking at it", then the answer. Once a week the parent gets one calm
  note (the kid can read it word for word first), with one plain lesson from what was caught
  ("No real person or company asks to be paid in gift cards").

## How we built it

- **Convex** for everything on the server: the database, a cron that checks each family's
  new mail every minute, scheduled jobs that carry out Gmail actions with retries, actions
  for Gmail and Claude, Convex Auth for the kid, and **live queries** that make the kid's feed,
  the investigation steps and Mom's accounts update the instant something changes.
- **Gmail API** (gmail.modify only: labels and moving mail; never sending as the parent or
  deleting). History import reads two years of headers (never bodies) to learn real accounts
  and relationships; the first accounts appear in about 10 seconds.
- **A deterministic pipeline first:** SPF/DKIM/DMARC, claimed identity vs. real domains,
  look-alike and homoglyph domains, link unwrapping, domain age (RDAP), Google Safe Browsing,
  pressure signals (gift cards, wires, crypto, secrecy), and the relationship check against
  the parent's own history.
- **Claude (claude-opus-5-5)** with web search and web fetch as the investigator, and for the
  plain-language explanation. Its rules are enforced in code, not just asked for in a prompt:
  it can make a verdict stricter but never lower a deterministic red flag; email text is
  marked untrusted; after it reads an email's text it can only raise; sources must come from
  its own tool results; clearing an email requires our own curated data (the company's real,
  authenticated address), never the model's opinion; the parent never sees model text.
- **Next.js + Tailwind** for the kid's app and the parent's big-text pages, built for
  accessibility (20px minimum text, 4rem tap targets, AAA contrast).

## Measured, not promised

`convex/accuracy.test.ts` runs a labeled set of 58 emails through the whole pipeline with no AI
and no network (the floor): **25 of 25 scams caught (18 held automatically), 0 of 33 real
emails held, 6 asked the kid** (first-ever emails from a real company, which the AI then
clears, and one store's gift card promotion). Its first run caught only 18 of 21: tech-support,
streaming and Zelle impostors got through. We added those brands and it now fails the build if
a real email is ever held. 690 automated tests in all. Full table: `docs/ACCURACY.md`.

## Where it could go wrong (and what we did)

- **A scam email tries to talk the AI into letting it through.** Email is evidence, never
  instructions; the rules decide first and the AI can't overrule them. Our test
  set includes a hidden-instructions email; it's held.
- **A real email is held.** Nothing is deleted; one tap from the kid puts it back. We measure
  false holds and keep them at zero.
- **A family member is hacked, or impersonated.** Family mail gets ordinary leeway (bills,
  Venmo, "ASAP"), but gift cards, secrecy, a dangerous link, "your account is locked", or a
  family name on a new address are still caught. Held scam emails never count as "someone Mom
  knows", so a scammer can't earn trust by persistence.
- **Privacy.** We never store email bodies. The kid sees only flagged emails, or ones the
  parent chose to ask about. Turning Anchor off revokes Google access and deletes everything.
- **What we chose not to build:** password storage, reading or relaying login codes, sending
  email as the parent. Those are exactly what scammers want an AI to do.

The full list, each risk with its guard in code and the test that proves it, is in
`docs/SECURITY.md`.

## Challenges

- Not flagging family. One of us emails our dad all the time asking him to pay a bill, and an
  early version would have flagged exactly that: money, a link and a deadline look like a scam. Telling family talk from a hacked
  account took relationship history, "hard evidence only" rules for familiar senders, and
  checks that the link, messenger and message fit together.
- Speed: a two-year import of a real inbox took minutes, so accounts now arrive in two passes
  and fill in live.
- Keeping an AI agent with web access safe on hostile input, and making sure its words never
  contradict what our checks found.

## What's next

Google's verification and security review to leave testing mode (today only test users can
connect, and connections expire every 7 days), Outlook, Yahoo and AOL (many parents don't use
Gmail), real-time push instead of a one-minute check, and siblings sharing the watch (we're
twins: both of us should see what Mom gets, and whoever answers first is the one she hears from).

## Prize tracks

- **Meta, Bringing People Closer:** the family loop is the product: worry calls become a
  one-tap answer in the kid's own words, and the parent can ask from inside Gmail.
- **Anthropic:** a named community, a problem we live, it works on a real inbox, and Claude's
  limits are enforced in code.
- **Microsoft, Built for the Real World:** measured accuracy, a clear path to production
  (Google verification), responsible design.
- **Convex:** crons, scheduled jobs, actions, auth and live queries are the whole backend.
- **People-First, Security (Armadin).**

**Built with:** Convex, Next.js, TypeScript, Tailwind CSS, Gmail API, Google OAuth, Claude
(Anthropic API with web search and web fetch), RDAP, Google Safe Browsing, Vitest.
