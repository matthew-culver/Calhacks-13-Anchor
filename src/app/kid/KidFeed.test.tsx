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
/** The number under a label in this week's tiles ("Checked" → "41"). */
const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const usps = mockFeed.find((f) => f._id === "mock_feed_usps")!._id;

describe("kid feed", () => {
  it("puts emails that need an answer first, then held ones, newest first", () => {
    render(<KidFeed />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Needs your answer", "We held these", "You answered"]);

    // Mom asked about the Kaiser email 6 minutes ago; USPS came in 20 minutes ago.
    expect(cards("Needs your answer")).toEqual([
      expect.stringContaining("Says it's from Kaiser Permanente"),
      expect.stringContaining("Says it's from USPS"),
    ]);
    // Wells Fargo arrived 30 minutes ago, Chase 2 hours ago.
    expect(cards("We held these")).toEqual([
      expect.stringContaining("Says it's from Wells Fargo"),
      expect.stringContaining("Says it's from Chase"),
    ]);
    expect(cards("You answered")).toEqual([expect.stringContaining("You said it's a scam. Mom was told.")]);
  });

  it("says in words whether each email looks fake or is a maybe, not just with color", () => {
    render(<KidFeed />);
    expect(cards("Needs your answer")[0]).toMatch(/^Mom asked/);
    expect(cards("Needs your answer")[1]).toMatch(/^Not sure/);
    expect(cards("We held these")[0]).toMatch(/^Looks fake/);
  });

  it("shows real times, measured from now", () => {
    render(<KidFeed />);
    expect(cards("Needs your answer")[1]).toContain("20 minutes ago");
    expect(cards("We held these")[1]).toContain("2 hours ago");
  });

  it("opens each email's detail view, without reading out the visual hint", () => {
    render(<KidFeed />);
    const link = within(section("Needs your answer")).getAllByRole("link")[1];
    expect(link).toHaveAttribute("href", "/kid/item/mock_feed_usps");
    // The arrow is only a visual hint: the card's short name is what screen readers say.
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveAccessibleName("Says it's from USPS. Not sure.");
  });

  it("moves an email to \"You answered\" once the kid answers, and updates the count", async () => {
    render(<KidFeed />);
    expect(stat("Need an answer")).toBe("2");
    const { result } = renderHook(() => useAnswerFeedItem());
    await act(() => result.current({ feedItemId: usps, answer: "fine" }));

    expect(stat("Needs an answer")).toBe("1");
    expect(cards("Needs your answer")).toEqual([expect.stringContaining("Says it's from Kaiser Permanente")]);
    expect(cards("You answered")).toContainEqual(expect.stringContaining("You said it's fine."));
  });

  it("shows this week's live numbers from the recap, and the good catches", () => {
    render(<KidFeed />);
    expect(stat("Checked")).toBe("41");
    expect(stat("Held")).toBe("3");
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
    expect(cards("Needs your answer")).toEqual([
      expect.stringContaining("Says it's from Kaiser Permanente"),
      expect.stringContaining("Says it's from USPS"),
    ]);
  });

  it("shows an email Mom asked about as needing an answer, and says she asked", () => {
    render(<KidFeed />);
    const card = within(section("Needs your answer")).getAllByRole("link")[0];
    expect(card).toHaveTextContent("Mom asked");
    expect(card).toHaveAccessibleName("Says it's from Kaiser Permanente. Mom asked.");
    expect(card).toHaveAttribute("href", "/kid/item/mock_feed_asked");
  });

  it("says \"Being held…\" until Gmail confirms the email really moved", () => {
    const feed = fakeBackend.state.queries["feed:myFeed"] as typeof import("@/shared/feedApi").SAMPLE_FEED;
    const chase = feed.find((e) => e._id === "mock_feed_chase")!;
    const pending = { ...chase, verdict: { ...chase.verdict, actionAppliedAt: undefined } };
    fakeBackend.setQuery("feed:myFeed", feed.map((e) => (e === chase ? pending : e)));
    render(<KidFeed />);
    expect(cards("We held these")).toContainEqual(expect.stringMatching(/^Looks fake · Being held….*Says it's from Chase/));
    expect(cards("We held these")).toContainEqual(expect.stringMatching(/^Looks fake\d.*Says it's from Wells Fargo/));
  });

  it("gives each card a short name for screen readers instead of one long run-on", () => {
    render(<KidFeed />);
    expect(screen.getByRole("link", { name: "Says it's from Chase. Looks fake." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Says it's from USPS. Not sure." })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Says it's from Medicare. Not sure. You said it's a scam." }),
    ).toBeInTheDocument();
  });
});
