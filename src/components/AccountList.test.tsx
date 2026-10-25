// B4 shared pieces: how long a place has been in the inbox, and which login links we trust.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockAccounts, mockNow } from "@/shared/mock";
import { howLong, ParentAccountList, trustedLoginUrl } from "./AccountList";

const DAY = 24 * 60 * 60 * 1000;
const now = mockNow;

describe("howLong", () => {
  it.each([
    [2 * DAY, "a few days"],
    [20 * DAY, "a few weeks"],
    [35 * DAY, "1 month"],
    [9 * 31 * DAY, "9 months"],
    [13 * DAY, "a few days"],
    [14 * DAY, "a few weeks"],
    [31 * DAY, "1 month"],
    [364 * DAY, "11 months"],
    [365 * DAY, "1 year"],
    [400 * DAY, "1 year"],
    [547 * DAY, "1 year"],
    [548 * DAY, "2 years"], // rounds to the nearest year past 1.5
    [2 * 366 * DAY, "2 years"],
    [720 * DAY, "2 years"], // the whole import window
    [-DAY, "a few days"], // a clock that's a little behind
  ])("first seen %i ms before now reads %s", (ago, text) => {
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
    ["https://KP.ORG/login", "https://kp.org/login"], // hosts are case-insensitive
    ["https://kp.org@evil.com/", null], // really goes to evil.com
    ["https://evil.com\\@kp.org/", null], // backslash trick, also evil.com
    ["https://user:pw@kp.org/", null], // no username or password in a sign-in link
    ["https://kp.org:8443/", null], // no odd ports
    ["https://kp.org./", null], // trailing dot: not worth trusting
  ])("%s → %s", (loginUrl, expected) => {
    expect(trustedLoginUrl({ loginUrl, officialDomains: domains })).toBe(expected);
  });

  it("trusts nothing when the place has no domains on file", () => {
    expect(trustedLoginUrl({ loginUrl: "https://kp.org/", officialDomains: [] })).toBeNull();
    expect(trustedLoginUrl({ loginUrl: "https://kp.org/", officialDomains: ["", "."] })).toBeNull();
  });

  it("tolerates domains stored with capitals or dots at the ends", () => {
    expect(trustedLoginUrl({ loginUrl: "https://kp.org/", officialDomains: [".KP.org."] })).toBe("https://kp.org/");
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
        expect(row).toHaveTextContent("We don't have a sign-in page for this one yet.");
      }
    }
  });

  it("doesn't tell the other website which page the parent came from", () => {
    render(<ParentAccountList accounts={mockAccounts.slice(0, 1)} now={now} />);
    expect(screen.getByRole("link")).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("says how long a place has been in the email, not that they're a customer", () => {
    render(<ParentAccountList accounts={mockAccounts.slice(0, 1)} now={now} />);
    expect(screen.getByText("In your email for 2 years")).toBeInTheDocument();
  });
});
