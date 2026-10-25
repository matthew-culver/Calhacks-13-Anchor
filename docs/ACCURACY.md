# How accurate is Anchor?

A labeled set of 50 emails, run through Anchor's whole pipeline: the scams are built from the
patterns the FTC and AARP warn older adults about; the real mail is what a parent actually
gets, including the family emails other filters flag (bills, Venmo, links from family). It runs
with no AI and no network, so this is Anchor's floor: the AI investigator can only make a
verdict stricter, and in real use it also clears a first email from a company's real address.

Reproduce: `WRITE_ACCURACY=1 npx vitest run convex/accuracy` (the test itself fails if a real
email is ever held, or a scam is missed).

| | |
|---|---|
| Scams caught | **24 of 24** (100%) |
| Scams held automatically (Mom never sees them) | 22 of 24 |
| Scams sent to the kid to decide | 2 |
| Real emails held by mistake | **0 of 26** |
| Real emails that asked the kid | 4 of 26 |

## Scams

| Email | What Anchor did | Why (Anchor's own words) |
|---|---|---|
| Bank impostor, look-alike link | Held as fake | This email says it is from Chase, but it was not sent by Chase. A link goes to a fake copy of the Chase website. |
| Bank address forged (fails authentication) | Held as fake | This email was not really sent from the address it shows. A link goes to a fake copy of the Wells Fargo website. |
| Payment app, look-alike address | Held as fake | This email says it is from PayPal, but it was not sent by PayPal. A link goes to a fake copy of the PayPal website. |
| Store refund from a free email account | Held as fake | This email says it is from Amazon, but it was not sent by Amazon. It tries to rush you. |
| Apple ID locked | Held as fake | This email says it is from Apple, but it was not sent by Apple. A link goes to a fake copy of the Apple website. |
| Tax refund | Held as fake | This email says it is from IRS, but it was not sent by IRS. A link goes to a fake copy of the IRS website. |
| Package redelivery fee | Held as fake | This email says it is from USPS, but it was not sent by USPS. A link goes to a fake copy of the USPS website. |
| New Medicare card | Held as fake | This email says it is from Medicare, but it was not sent by Medicare. A link goes to a fake copy of the Medicare website. |
| Tech support, phone number only | Held as fake | This email says it is from Microsoft, but it was not sent by Microsoft. It tries to rush you. |
| Streaming payment failed | Held as fake | This email says it is from Netflix, but it was not sent by Netflix. A link goes to a fake copy of the Netflix website. |
| Bank transfer app | Held as fake | This email says it is from Zelle, but it was not sent by Zelle. A link goes to a fake copy of the Zelle website. |
| Gift cards for the pastor | Held as fake | It asks you to pay with gift cards and keep it a secret. It's the first email you've ever gotten from this sender, and it asks for an unusual payment or secrecy. |
| Lottery prize, pay by wire | Held as fake | It pushes you to pay with a wire transfer, which real companies don't ask for. It's the first email you've ever gotten from this sender, and it asks for an unusual payment or secrecy. |
| Romance, cryptocurrency | Held as fake | It asks you to pay with cryptocurrency and keep it a secret. It's the first email you've ever gotten from this sender, and it asks for an unusual payment or secrecy. |
| Son's account hacked, gift cards | Held as fake | It asks you to pay with gift cards and keep it a secret. This came from someone you know, but it asks for gift cards, a wire transfer, cryptocurrency or secrecy. Their account may have been hacked. |
| Son's name, new address, money | Asked the kid | It mentions paying with a payment app. It uses the name Matt Culver, someone you know, but from an address they've never used with you. |
| Friend's address faked with a typo | Held as fake | The address is made to look like Sue Miller's, but it isn't theirs. Someone may be pretending to be Sue Miller. |
| Geek Squad renewal, call to cancel | Held as fake | This email says it is from Geek Squad, but it was not sent by Geek Squad. It tries to rush you. |
| Antivirus renewal | Held as fake | This email says it is from Norton, but it was not sent by Norton. It says it's Norton, but you've never gotten email from Norton. |
| Social media security alert, look-alike site | Held as fake | This email says it is from Facebook, but it was not sent by Facebook. A link goes to a fake copy of the Facebook website. |
| Bank email that replies to someone else | Held as fake | This email says it is from Bank of America, but it was not sent by Bank of America. You do get email from Bank of America, but this one didn't come from Bank of America's real address. |
| Chase look-alike (test file) | Held as fake | This email says it is from Chase, but it was not sent by Chase. A link goes to a fake copy of the Chase website. |
| Hidden instructions to the AI (test file) | Held as fake | We couldn't confirm who really sent this email. This email says it is from Wells Fargo, but it was not sent by Wells Fargo. |
| Package notice from an unknown site (test file) | Asked the kid | This email talks about USPS, but it was not sent by USPS. A link hides where it really goes. |

## Real mail

| Email | What Anchor did | Why |
|---|---|---|
| Bank statement | Left alone | Nothing odd. |
| Pharmacy pickup | Left alone | Nothing odd. |
| Electric bill | Left alone | Nothing odd. |
| Bank security alert | Left alone | Nothing odd. |
| Medicare summary | Left alone | Nothing odd. |
| Son asks Mom to pay a bill | Left alone | Nothing odd. |
| Son sends a recipe from a site Mom never visited | Left alone | Nothing odd. |
| Friend shares a video | Left alone | Nothing odd. |
| Friend asks for rent money by Venmo | Left alone | Nothing odd. |
| New dentist's reminder | Left alone | Nothing odd. |
| Fraud-awareness newsletter | Left alone | Nothing odd. |
| Church bulletin | Left alone | Nothing odd. |
| Grandchild's school | Left alone | Nothing odd. |
| Google security alert (she has Google mail) | Left alone | Nothing odd. |
| First-ever email from the real Netflix | Asked the kid | This is the first email you've ever gotten from Netflix. |
| First-ever email from the real UPS | Asked the kid | This is the first email you've ever gotten from UPS. |
| First-ever letter from Social Security | Asked the kid | This is the first email you've ever gotten from Social Security. |
| Store receipt | Left alone | Nothing odd. |
| Calendar invite from family | Left alone | Nothing odd. |
| Neighborhood digest | Left alone | Nothing odd. |
| Facebook notification (she uses Facebook) | Left alone | Nothing odd. |
| First-ever Venmo receipt | Asked the kid | This is the first email you've ever gotten from Venmo. |
| Friend's newsletter about a gift card raffle | Left alone | Nothing odd. |
| City water bill | Left alone | Nothing odd. |
| Kaiser appointment (test file) | Left alone | Nothing odd. |
| Newsletter (test file) | Left alone | Nothing odd. |
