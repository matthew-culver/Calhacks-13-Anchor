# The 2-minute pitch

Judging is a 2-minute pitch with a live demo at the table (10:30 to 12:30), so this is built
around the demo. Timings are targets; rehearse twice with a timer. Setup and test emails are in
[DEMO.md](DEMO.md). **[you]** marks lines that should be in your own words.

## Before a judge arrives

- Laptop: kid's "This week" page, alerts turned on, old test emails cleared.
- Second tab: Mom's Gmail inbox. Phone (or a narrow window): Mom's page.
- Matt holds the phone with the scam Gmail ready to send email A, and his own Gmail ready.

## The script (about 2 minutes)

**0:00 Hook (15 s).** "We're twins, and our parents are 73. **[you: the real moment, one
sentence]** Scam emails look exactly like the real thing now, and every filter's answer is a
warning banner our parents don't understand. So they call us. Anchor is their safe front door
to email."

**0:15 Mom's side (15 s).** Hold up Mom's page. "Mom set this up with one tap from a link I
texted her. Anchor read two years of her email headers, never the contents, and found the
accounts she really uses, most-used first, each one a button to the real sign-in page. She
never signs in from an email link again."

**0:30 A scam arrives (35 s).** Matt sends **email A** (fake Chase). Run the poll; the alert
pops up on the laptop. "That just landed in Mom's inbox, and it's already gone: held, not
deleted. Here's why." Open it: the investigation runs live. "Claude is investigating it like a
careful person would: who really sent it, where the link really goes (it follows it so nobody
has to click), what Chase's real addresses are. And it can only make a verdict stricter. Our
rules decide first, so a scam can't talk the AI into letting it through."

**1:05 Family (25 s).** Matt sends **email B** (the bill). "My brother asking Mom to pay a
bill by Venmo: money, a link, a deadline. Every filter flags that. Anchor knows he's family, so
nothing happens." Then **email D** (gift cards): held. "Same address asking for gift cards and
secrecy: his account's been hacked, so it's held."

**1:30 The loop (20 s).** "And Mom can ask me. She moves any email to 'Check with Lucas' in
her Gmail, it lands here with the investigation, I tap 'It's fine', and she gets my answer in
my words. One calm email a week, no alerts."

**1:50 Close (10 s).** "On our test set it caught 25 of 25 scams and held zero real emails.
It's running on my real inbox right now. Anchor: our parents get a safer inbox, and we get our
weekends back."

## If you only have 30 seconds

"Anchor protects our parents' Gmail. It knows who they really deal with, so a perfect fake
Chase email to someone who doesn't bank at Chase is held before they see it, and an AI
investigator shows us why, step by step. Family emails about bills are left alone, but a
hacked family account asking for gift cards is caught. And Mom can ask us about any email from
inside Gmail. 25 of 25 scams caught on our test set, zero real emails held."

## Track-specific closers (pick the one that matches the judge)

- **Meta:** "The product is the family loop: worry calls become a one-tap answer in the kid's
  own words, and the parent can start the conversation from inside Gmail."
- **Anthropic:** "A named community, a problem we live, it works on a real inbox, and we know
  where it can go wrong: the AI can only make things stricter, email text is never
  instructions, and clearing an email needs our own data, never the model's opinion."
- **Microsoft:** "Measured, not promised: an accuracy eval in our test suite that fails the
  build if a real email is ever held. The path to production is Google's verification for
  Gmail access."
- **Convex:** "Convex is the whole backend: a cron checks every family's mail each minute,
  scheduled jobs retry Gmail actions, and live queries push each investigation step to the
  kid's screen as it happens."

## Likely questions

The full list is in [DEMO.md](DEMO.md). The three most likely:
- **"What if it's wrong?"** It never deletes; one tap puts an email back. The AI can only raise
  a verdict. We measure false holds and keep them at zero.
- **"Privacy?"** No email bodies stored; the kid only sees flagged emails or ones the parent
  asked about; turning it off deletes everything and revokes Google access.
- **"Why would anyone pay?"** **[you]** The adult kid pays to stop worrying, the way people
  pay for a home alarm. Price it like one family plan a month.
