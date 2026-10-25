// B3 kid feed: needs-answer items first, held items below, answered ones last.

import { act, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "@/test/fakeBackend";
import { seedSignedInKid } from "@/test/seed";
import { resetMockFeed, useAnswerFeedItem } from "@/shared/feedApi";
import { mockFeed } from "@/shared/mock";
import KidFeed from "./page";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

beforeEach(() => {
  fakeBackend.reset();
  seedSignedInKid();
  resetMockFeed();
});

afterEach(() => sessionStorage.clear());

const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const cards = (name: string) => within(section(name)).queryAllByRole("link").map((a) => a.textContent ?? "");
const usps = mockFeed.find((f) => f._id === "mock_feed_usps")!._id;

describe("kid feed", () => {
  it("puts emails that need an answer first, then held ones, newest first", () => {
    render(<KidFeed />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Needs your answer", "We held these", "You answered"]);

    expect(cards("Needs your answer")).toEqual([expect.stringContaining("Says it's from USPS")]);
    // Wells Fargo arrived 30 minutes ago, Chase 2 hours ago.
    expect(cards("We held these")).toEqual([
      expect.stringContaining("Says it's from Wells Fargo"),
      expect.stringContaining("Says it's from Chase"),
    ]);
    expect(cards("You answered")).toEqual([expect.stringContaining("You said it's a scam. Mom was told.")]);
  });

  it("says in words whether each email looks fake or is a maybe, not just with color", () => {
    render(<KidFeed />);
    expect(cards("Needs your answer")[0]).toMatch(/^Not sure/);
    expect(cards("We held these")[0]).toMatch(/^Looks fake/);
  });

  it("shows real times, measured from now", () => {
    render(<KidFeed />);
    expect(cards("Needs your answer")[0]).toContain("20 minutes ago");
    expect(cards("We held these")[1]).toContain("2 hours ago");
  });

  it("opens each email's detail view, without reading out the visual hint", () => {
    render(<KidFeed />);
    const link = within(section("Needs your answer")).getByRole("link");
    expect(link).toHaveAttribute("href", "/kid/item/mock_feed_usps");
    expect(within(link).getByText("Look closer")).toHaveAttribute("aria-hidden", "true");
  });

  it("moves an email to \"You answered\" once the kid answers, and updates the count", async () => {
    render(<KidFeed />);
    expect(screen.getByText("1 needs an answer")).toBeInTheDocument();
    const { result } = renderHook(() => useAnswerFeedItem());
    await act(() => result.current({ feedItemId: usps, answer: "fine" }));

    expect(screen.getByText("0 need an answer")).toBeInTheDocument();
    expect(within(section("Needs your answer")).getByText(/Nothing to answer/)).toBeInTheDocument();
    expect(cards("You answered")).toContainEqual(expect.stringContaining("You said it's fine."));
  });

  it("shows this week's live numbers from the recap, and the good catches", () => {
    render(<KidFeed />);
    expect(screen.getByText("41 checked")).toBeInTheDocument();
    expect(screen.getByText("3 held")).toBeInTheDocument();
    expect(screen.getByText("1 good catch with Mom this week.")).toBeInTheDocument();
  });

  it("leaves out the good-catch line on a week without one", () => {
    fakeBackend.setQuery("feed:myWeeklyRecap", { weekStart: 0, checked: 9, held: 0, needAnswer: 0, goodCatches: 0 });
    render(<KidFeed />);
    expect(screen.queryByText(/good catch/)).toBeNull();
  });

  it("names a sender plainly when the email gave no brand or name", () => {
    const [first, ...rest] = fakeBackend.state.queries["feed:myFeed"] as typeof import("@/shared/feedApi").SAMPLE_FEED;
    const verdict = { ...first.verdict, claimedOrg: undefined, fromName: undefined };
    fakeBackend.setQuery("feed:myFeed", [{ ...first, verdict }, ...rest]);
    render(<KidFeed />);
    expect(screen.getByText("Says it's from an unknown sender")).toBeInTheDocument();
  });

  it("asks a signed-out kid to sign in instead of showing anything", () => {
    fakeBackend.set({ isAuthenticated: false });
    render(<KidFeed />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/start");
    expect(screen.queryByText(/Says it's from/)).toBeNull();
  });

  it("shows the sample family in demo mode, signed in or not, and says it's sample data", () => {
    sessionStorage.setItem("anchor.demo", "1");
    fakeBackend.set({ isAuthenticated: false });
    fakeBackend.setQuery("feed:myFeed", []);
    render(<KidFeed />);
    expect(screen.getByText("Sample data for the demo")).toBeInTheDocument();
    expect(cards("Needs your answer")).toEqual([expect.stringContaining("Says it's from USPS")]);
  });

  it("says \"Being held…\" until Gmail confirms the email really moved", () => {
    const feed = fakeBackend.state.queries["feed:myFeed"] as typeof import("@/shared/feedApi").SAMPLE_FEED;
    const chase = feed.find((e) => e._id === "mock_feed_chase")!;
    const pending = { ...chase, verdict: { ...chase.verdict, actionAppliedAt: undefined } };
    fakeBackend.setQuery("feed:myFeed", feed.map((e) => (e === chase ? pending : e)));
    render(<KidFeed />);
    expect(cards("We held these")).toContainEqual(expect.stringMatching(/^Looks fake · Being held…Says it's from Chase/));
    expect(cards("We held these")).toContainEqual(expect.stringMatching(/^Looks fakeSays it's from Wells Fargo/));
  });
});
