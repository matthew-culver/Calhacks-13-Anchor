import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { BigButton, SiteHeader } from "@/components/ui";

// The front page for the grown kid: what Anchor does, how setup goes, why it can be trusted,
// and one big action. Plain words only (no "safe", no jargon), like every other screen.

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-action text-xl font-bold text-on-action">
        {n}
      </span>
      <h3 className="text-2xl font-bold">{title}</h3>
      <p className="text-lg text-muted">{children}</p>
    </li>
  );
}

function Feature({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-7 shadow-card">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-action-tint text-action">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <h3 className="text-2xl font-bold">{title}</h3>
      <p className="text-lg text-muted">{children}</p>
    </div>
  );
}

/** A picture of the product for the top of the page: a held email being checked, and Mom's accounts. */
function Preview() {
  const steps: [IconName, string][] = [
    ["search", "Looked up Chase's real email addresses"],
    ["globe", "Followed the link, without anyone clicking it"],
    ["flag", "The link goes to a 3-day-old copy of Chase's site"],
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="rounded-3xl border border-line bg-surface p-6 shadow-lift">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-fake-tint px-3 py-1 text-base font-semibold text-fake">Looks fake · Held</span>
          <span className="text-base text-muted">2 minutes ago</span>
        </div>
        <p className="mt-3 text-2xl font-bold">Says it&apos;s from Chase</p>
        <p className="text-lg text-muted">“Unusual sign-in: verify your account”</p>
        <ul className="mt-5 flex flex-col gap-3 rounded-2xl bg-page p-4">
          {steps.map(([icon, text]) => (
            <li key={text} className="flex items-start gap-3 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-action">
                <Icon name={icon} className="h-4 w-4" />
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative -mt-4 ml-6 rounded-3xl border border-line bg-surface p-5 shadow-lift sm:ml-12">
        <p className="text-base font-semibold text-muted">Mom&apos;s accounts</p>
        {[
          ["W", "Wells Fargo", "bg-[#0f6b4f]"],
          ["K", "Kaiser Permanente", "bg-[#0e6e8c]"],
        ].map(([letter, name, bg]) => (
          <div key={name} className="mt-3 flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white ${bg}`}>{letter}</span>
            <span className="flex-1 text-lg font-semibold">{name}</span>
            <span className="rounded-xl bg-action px-3 py-1.5 text-base font-semibold text-on-action">Open</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader wide>
        <Link href="/start" className="flex min-h-tap items-center rounded-xl px-4 text-lg font-semibold text-action hover:bg-action-tint">
          Sign in
        </Link>
      </SiteHeader>
      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-14 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-20">
          <div className="flex flex-col gap-6">
            <p className="inline-flex items-center gap-2 self-start rounded-full bg-action-tint px-4 py-1.5 text-base font-semibold text-action">
              <Icon name="heart" className="h-5 w-5" />
              For grown kids of aging parents
            </p>
            <h1 className="text-5xl leading-[1.05] font-bold tracking-tight text-ink sm:text-6xl">
              Keep scam emails away from Mom and Dad
            </h1>
            <p className="text-xl text-muted">
              Anchor checks every email your parent gets. Fakes are quietly set aside, you hear about the few that need a
              second look, and your parent gets one simple page with every account they really use.
            </p>
            <div className="flex flex-col items-start gap-3">
              <BigButton href="/start" fit>
                Protect someone you love
                <Icon name="chevronRight" className="h-6 w-6" />
              </BigButton>
              <p className="text-lg text-muted">About two minutes. Your parent taps one link.</p>
            </div>
          </div>
          <Preview />
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
            <ol className="mt-10 grid gap-10 md:grid-cols-3">
              <Step n={1} title="You set it up">
                Sign up and type in your parent&apos;s email. You get a personal link to send them.
              </Step>
              <Step n={2} title="They tap once">
                Your parent taps the link and says yes to Google. That&apos;s the only thing they ever do.
              </Step>
              <Step n={3} title="Anchor keeps watch">
                Every new email is checked within a minute. Scams quietly leave the inbox, and you get the full story.
              </Step>
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">What your family gets</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Feature icon="shieldCheck" title="Scams disappear quietly">
              Fakes move out of the inbox into a folder they can always get back. No scary warnings, no alert for every
              email.
            </Feature>
            <Feature icon="sparkle" title="An investigator you can watch">
              For anything suspicious, Claude checks who really sent it and where each link really goes, step by step,
              then tells you in plain words.
            </Feature>
            <Feature icon="anchor" title="A front door for every account">
              One page of big buttons for the bank, the doctor and the phone bill, found from their own email. Each goes
              straight to the real sign-in page.
            </Feature>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-3xl bg-brand px-6 py-10 text-white sm:px-10">
            <h2 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <Icon name="lock" className="h-8 w-8" />
              Built to be trusted with your parent&apos;s email
            </h2>
            <ul className="mt-8 grid gap-6 text-lg md:grid-cols-3">
              <li className="flex gap-3">
                <Icon name="check" className="mt-1 h-6 w-6" />
                We never store the text of your parent&apos;s emails.
              </li>
              <li className="flex gap-3">
                <Icon name="check" className="mt-1 h-6 w-6" />
                We never send email as your parent, and never delete anything.
              </li>
              <li className="flex gap-3">
                <Icon name="check" className="mt-1 h-6 w-6" />
                Your parent can turn it off with one tap, and everything we learned is deleted.
              </li>
            </ul>
          </div>
        </section>
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-8 text-base text-muted sm:px-6">
          <Icon name="anchor" className="h-5 w-5" />
          Anchor · Made at Cal Hacks 13.0
        </div>
      </footer>
    </>
  );
}
