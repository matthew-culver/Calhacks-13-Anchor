# Anchor demo runbook

About 3 minutes live, then questions. Judging is a 2-minute pitch at the table, so use the
tighter script in [PITCH.md](PITCH.md) and pick scenes from here. The expected result is next to
each test email; the backend tests cover each one (`convex/mailWatch.test.ts`), and a full
rehearsal on the real inbox is the last check before presenting.

## The cast

| Role | Who | Notes |
|---|---|---|
| **Mom's inbox** | the Gmail connected to the family | must be a Google test user (OAuth testing mode) |
| **The kid** | the presenter, on the laptop at `/kid` | signed in as the family's kid account |
| **Family member ("Matt")** | a Gmail Mom has written to before | familiar = Mom wrote to them, or 2+ emails from them in her history |
| **Scammer** | a separate Gmail, display name **Chase Bank** | must NOT be someone Mom has emailed |

To change a Gmail display name: Gmail → Settings → Accounts → "Send mail as" → edit info.

## 30 minutes before

1. Backend running: `npx convex dev` (watch the terminal for errors during the demo).
   Env on the deployment (names only): `ANTHROPIC_API_KEY`, `SAFE_BROWSING_API_KEY`,
   `ANCHOR_GMAIL_ACTIONS=on`. Check with `npx convex env list` (don't show it on screen).
2. **Reconnect Mom's Gmail if it was connected more than ~5 days ago.** Google's testing mode
   expires refresh tokens after 7 days; the kid's screen offers a reconnect link.
3. Frontend: `npm run dev`, open http://localhost:3000.
4. Lay out the screen:
   - **Laptop, big:** the kid's feed, `http://localhost:3000/kid`.
   - **Second tab:** Mom's Gmail inbox.
   - **Phone (or a narrow window):** Mom's front door page, `/p/<parent link>` (the link the kid
     got when setting up; it's also `parentToken` on the family in the Convex dashboard).
     Never show the full link on the projector: it's Mom's key.
   - **Terminal:** ready with the two commands below, family id filled in.
5. **Turn on alerts:** on the kid's "This week" page, tap "Get an alert when something needs
   you" once and allow notifications. New flagged or asked emails then pop up as a notification
   on the laptop, even while you're showing Mom's Gmail (click it to open the email).
6. **Start at zero:** clear old test emails from Anchor's screens (the emails stay in Gmail;
   accounts and history are kept): `npx convex run demo:clearChecked '{"familyId":"<familyId>"}'`.
7. Have the test emails below drafted (not sent) in the right accounts.
8. Phone hotspot ready in case the venue Wi-Fi dies.

## Commands

```bash
# Check Mom's new mail now instead of waiting for the once-a-minute check
npx convex run mailWatch:pollFamily '{"familyId":"<familyId>"}'

# Send Mom this week's calm note now (normally Sundays)
npx convex run gmailActions:sendWeeklyNote '{"familyId":"<familyId>"}'

# Before presenting: clear old test emails from the screens (nothing in Gmail changes)
npx convex run demo:clearChecked '{"familyId":"<familyId>"}'
```

Gmail usually delivers in 2-5 seconds; run the poll right after hitting send. (Without it the
email still shows up within a minute.)

## The story

**1. The problem (20 s).** "Our parents get scam emails every day, and every email system's
answer is a spam folder and a warning banner they don't understand. So they call us. Anchor
is her safe front door to the internet, and it keeps me in the loop without nagging either of us."

**2. Mom's front door (30 s).** On the phone: her real accounts, found from her own email,
grouped (Money, Health, Insurance, Bills, Government...) and most-used first (an old doctor she
stopped using sinks to the bottom), each a big button straight to that company's real sign-in
page. Tap one: it opens the real sign-in page, not a link from an email. "She never has to click a link in an email again."

**3. A scam arrives (60 s).** The scammer sends **email A**. Run the poll. On the kid's feed it
appears under "We held these"; open it and the investigation runs live: who really sent it,
following the link without anyone clicking it, searching the web for Chase's real addresses,
then the conclusion (impostor, dangerous link, what to do). In Mom's Gmail it's gone from her
inbox (it's in "Anchor: Held"). "Mom didn't see it, didn't get a scary warning, didn't have to
decide anything."

**4. Family stays family (30 s).** Matt sends **email B** (a bill, a payment link, "Venmo me").
Run the poll. Nothing happens: it's just there in Mom's inbox. "Every other filter flags money
plus a link plus a deadline. Anchor knows this is her son." Optional: **email C**, a link to a
site Mom has never visited, also stays: Anchor judges the site, not whether she's seen it.

**5. When family gets hacked (40 s).** Matt sends **email D** (gift cards, keep it secret).
Run the poll. It's held: "This came from someone you know, but it asks for gift cards... Their
account may have been hacked." The kid taps **It's a scam** and writes a note: *Mom, that wasn't
Matt, his email got hacked. Never buy gift cards for anyone. Love you!* Mom gets one short email
with those words. "That's the only email she gets from us, and it's in my words."

**5a. Mom asks (30 s).** The loop goes both ways. In Mom's Gmail, move any email (say a real
Kaiser or bank email) to the **"⚠ Check with Lucas"** folder. Run the poll. On the kid's feed:
"Mom asked", with the AI investigation. Tap "It's fine" with a note ("That one's real, Mom.
Thanks for asking!"). Mom's label comes off and she gets one short email with your words; her
Anchor page shows the question under "Your questions for Lucas" with your answer, and if she hits
Reply, it comes straight to you. "She doesn't have to call me and read it out loud anymore. One
move in Gmail and I've got it."

**5b. Someone pretending to be family (30 s, optional).** Matt first sends Mom any normal
email (Anchor learns the name he goes by). Then the scammer Gmail changes its display name to
Matt's exact name and sends **email E**. Run the poll. It's flagged: "It uses the name Matthew
Culver, someone you know, but from an address they've never used with you." "Spam filters
don't know who your family is. Anchor does."

**6. Quiet by design (20 s).** Run the weekly note command. Mom gets one calm email a week,
only if something happened. "No alert per email. She just has a safer inbox."

## Test emails

Paste the link as plain text so Gmail makes it a link. Don't add a signature with other links.

**A. Fake Chase** (from the scammer Gmail, display name "Chase Bank")
- Subject: `Unusual sign-in: verify your account within 24 hours`
- Body:
  ```
  Dear customer,

  We noticed an unusual sign-in to your Chase account from a new device. For your security,
  your account will be locked unless you verify your identity within 24 hours.

  Verify now: https://chase-account-verify.top/login

  Chase Fraud Prevention
  ```
- Expect: **held**. Name claims Chase from a Gmail address, look-alike link, first email ever
  from "Chase". Investigation finishes in ~15 s.

**B. Family bill** (from Matt)
- Subject: `Can you pay the PG&E bill?`
- Body:
  ```
  Hi Mom! The PG&E bill came in, it's $84.20 and due Friday. You can pay it at
  https://www.pge.com/ or just Venmo me and I'll pay it. Thank you!! Love, Matt
  ```
- Expect: **nothing happens** (real). Not in the kid's feed, untouched in Mom's inbox.

**C. A safe site Mom has never visited** (from Matt, optional)
- Subject: `you'll love this`
- Body:
  ```
  Mom, look at this cookie recipe, we should make it this weekend!
  https://www.kingarthurbaking.com/recipes/classic-chocolate-chip-cookies-recipe
  ```
- Expect: **nothing happens** (real). Anchor follows the link itself, sees an old, ordinary
  recipe page with no sign-in form, and leaves it alone.

**D. Hacked family account** (from Matt)
- Subject: `need a favor`
- Body:
  ```
  Mom, I'm in a bind and can't talk right now. Can you buy four $100 Google Play gift cards
  and send me pictures of the numbers on the back? Please don't tell anyone, I'll explain later.
  ```
- Expect: **held**, "Their account may have been hacked"; the investigation reads the message
  (Matt is family) and explains why it doesn't sound like him.

**E. Someone using Matt's name** (from the scammer Gmail, display name set to Matt's exact
name as it shows in his own emails)
- Subject: `new email address`
- Body:
  ```
  Hi Mom, I lost my phone so this is my new email. Can you reply here when you get this?
  I need to ask you something important.
  ```
- Expect: **Check with Lucas** (unsure): "It uses the name ..., someone you know, but from an
  address they've never used with you." Matt must have sent Mom one normal email first.

## If something goes wrong

| Problem | Do this |
|---|---|
| Email doesn't show up | Run the poll again. Check it arrived in Mom's Gmail (not in Spam). Watch the `npx convex dev` terminal. |
| The investigation is slow | The email is already held before the AI starts (the rules decide first, the AI can only make it stricter). Keep talking; it concludes from the checks alone after 3 minutes at most. |
| The kid's screen says reconnect | Google token expired: click the reconnect link and sign in as Mom (takes 20 s). |
| Google or Gmail is down | Open `localhost:3000/kid?demo=1`: the whole kid side runs on sample data, no sign-in or Gmail needed (feed, a replayed live investigation, "Mom asked", accounts). Mom's side: `localhost:3000/p/sample?demo=1`. "Leave the demo" on the yellow banner turns it off. Or fill My Accounts from a sample inbox: `npx convex run gmailImport:importSample '{"familyId":"<familyId>"}'`. |
| Wi-Fi is down | Phone hotspot. |

## Questions judges may ask

- **"What if Claude gets it wrong?"** Deterministic checks set a floor; Claude can make a verdict
  stricter, never more lenient. The only thing that can clear an email is our own data (the
  company's real, authenticated address on our checked list), never the model's opinion. Mom
  only ever sees fixed, plain sentences, never model text.
- **"What do you store?"** Never email bodies. For a flagged email (or one Mom asks about) we
  keep the sender and subject so the kid can see what was caught; for everything else, only the
  sender's domain and the verdict. Turning Anchor off revokes Google access and deletes the
  family's data.
- **"Why not just a spam filter?"** Filters guess from the message alone. Anchor knows who Mom
  really deals with (her family, her bank, her doctor), so it can leave her son's bill reminder
  alone and still catch the same son's hacked account asking for gift cards.
- **"How accurate is it?"** On our labeled test set of 58 emails (`docs/ACCURACY.md`, re-run by
  `convex/accuracy.test.ts`): 25 of 25 scams caught, 18 held automatically, 0 of 33 real emails
  held. Its first run missed tech-support and streaming impostors; we added those brands, and the
  test now fails the build if a real email is ever held.
- **"What if someone pretends to be family?"** Anchor learns the names of the people Mom writes
  to. A stranger using one of those names from a new address, or an address that looks almost like
  theirs, is flagged for the kid (and held if it also asks for gift cards or money).
- **"Does Mom ever start the conversation?"** Yes: she moves any email to "⚠ Check with Lucas" in
  Gmail, and it lands in the kid's feed with the AI investigation. The answer comes back to her in
  the kid's words.
- **"Can a scammer game the history?"** Mail Anchor flagged never counts toward "someone Mom
  knows", and a familiar sender is still flagged for a dangerous link, gift cards, wires,
  crypto, secrecy, or talking like a company ("your account is locked").
