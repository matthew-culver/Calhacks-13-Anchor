// B4 kid My Accounts: every family state, and the live list.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAccounts, mockNow } from "@/shared/mock";
import { fakeBackend } from "@/test/fakeBackend";
import KidAccounts from "./page";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

const family = (status: string) => ({
  _id: "fam1",
  parentName: "Mom",
  parentEmail: "mom@gmail.com",
  kidName: "Lucas",
  status,
});

beforeEach(() => {
  fakeBackend.reset();
  fakeBackend.set({ isAuthenticated: true });
  fakeBackend.setQuery("families:getMyFamily", family("active"));
  fakeBackend.setQuery("accounts:myAccounts", mockAccounts);
});

const title = () => screen.getByRole("heading", { level: 1 });

describe("kid My Accounts", () => {
  it("lists the parent's accounts with how long they've been in the email", () => {
    // The mock's "now"; Kaiser was first seen 24 months before it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(mockNow);
    try {
      render(<KidAccounts />);
      expect(title()).toHaveTextContent("Mom's accounts");
      expect(screen.getByText("Health care · In Mom's email for 2 years · 88 emails")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Learning while A4 reads the history, then the list on its own", () => {
    fakeBackend.setQuery("families:getMyFamily", family("learning"));
    fakeBackend.setQuery("accounts:myAccounts", []);
    render(<KidAccounts />);
    expect(screen.getByRole("status")).toHaveTextContent("Learning who Mom really deals with");

    act(() => {
      fakeBackend.setQuery("families:getMyFamily", family("active"));
      fakeBackend.setQuery("accounts:myAccounts", mockAccounts);
    });
    expect(screen.getByRole("heading", { name: "Kaiser Permanente" })).toBeInTheDocument();
  });

  it("explains an empty list instead of showing nothing", () => {
    fakeBackend.setQuery("accounts:myAccounts", []);
    render(<KidAccounts />);
    expect(screen.getByText(/A place shows up here after it has sent Mom several real emails/)).toBeInTheDocument();
  });

  it.each([
    ["invited", "Waiting for Mom", "/start"],
    ["needs_reconnect", "Waiting for Mom", "/start"],
  ])("sends the kid back to the link while the family is %s", (status, heading, href) => {
    fakeBackend.setQuery("families:getMyFamily", family(status));
    render(<KidAccounts />);
    expect(title()).toHaveTextContent(heading);
    expect(screen.getByRole("link", { name: "See Mom's link" })).toHaveAttribute("href", href);
  });

  it("says so when the parent turned protection off", () => {
    fakeBackend.setQuery("families:getMyFamily", family("off"));
    render(<KidAccounts />);
    expect(title()).toHaveTextContent("Mom turned protection off");
  });

  it("asks a signed-out kid to sign in, and a kid with no family to set up", () => {
    fakeBackend.set({ isAuthenticated: false });
    const { unmount } = render(<KidAccounts />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/start");
    unmount();

    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", null);
    render(<KidAccounts />);
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/start");
  });
});
