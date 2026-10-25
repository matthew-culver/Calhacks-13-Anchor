// B4 shared pieces: how long a place has been in the inbox, and which login links we trust.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockAccounts } from "@/shared/mock";
import { howLong, ParentAccountList, trustedLoginUrl } from "./AccountList";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 25);

describe("howLong", () => {
  it.each([
    [2 * DAY, "a few days"],
    [20 * DAY, "a few weeks"],
    [35 * DAY, "1 month"],
    [9 * 31 * DAY, "9 months"],
    [400 * DAY, "1 year"],
    [2 * 366 * DAY, "2 years"],
    [720 * DAY, "2 years"], // the whole import window
    [-DAY, "a few days"], // a clock that's a little behind
  ])("%i ms ago reads %s", (ago, text) => {
    expect(howLong(now - ago, now)).toBe(text);
  });
});

describe("trustedLoginUrl", () => {
  const domains = ["kp.org", "kaiserpermanente.org"];
  it.each([
    ["https://healthy.kaiserpermanente.org/", "https://healthy.kaiserpermanente.org/"],
    ["https://kp.org/login", "https://kp.org/login"],
    ["http://kp.org/login", null], // not https
    ["javascript:alert(1)", null],
    ["https://kaiserpermanente.org.evil.co/", null], // lookalike suffix
    ["https://evilkp.org/", null], // not a subdomain
    ["not a url", null],
    [undefined, null],
  ])("%s → %s", (loginUrl, expected) => {
    expect(trustedLoginUrl({ loginUrl, officialDomains: domains })).toBe(expected);
  });
});

describe("parent account list", () => {
  it("gives each place one big button, and says so plainly when there's no sign-in page", () => {
    render(<ParentAccountList accounts={mockAccounts} now={now} />);
    for (const a of mockAccounts) {
      const row = screen.getByRole("heading", { name: a.orgName }).closest("li")!;
      const link = within(row).queryByRole("link");
      if (a.loginUrl) expect(link).toHaveTextContent(`Open ${a.orgName}`);
      else {
        expect(link).toBeNull();
        expect(row).toHaveTextContent("No sign-in page on file.");
      }
    }
  });

  it("says how long a place has been in the email, not that they're a customer", () => {
    render(<ParentAccountList accounts={mockAccounts.slice(0, 1)} now={now} />);
    expect(screen.getByText("In your email for 2 years")).toBeInTheDocument();
  });
});
