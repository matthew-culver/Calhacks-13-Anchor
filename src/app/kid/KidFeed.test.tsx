// B3 kid feed: needs-answer items first, held items below, answered ones last.

import { act, render, renderHook, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMockFeed, useAnswerFeedItem } from "@/shared/feedApi";
import { mockFeed } from "@/shared/mock";
import KidFeed from "./page";

beforeEach(() => resetMockFeed());

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
});
