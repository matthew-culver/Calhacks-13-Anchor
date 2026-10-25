// B3 kid feed: needs-answer items first, held items below, answered ones last.

import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMockFeed, useAnswerFeedItem } from "@/shared/feedApi";
import { renderHook } from "@testing-library/react";
import KidFeed from "./page";

beforeEach(() => resetMockFeed());

const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const cards = (name: string) => within(section(name)).queryAllByRole("link").map((a) => a.textContent ?? "");

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

  it("opens each email's detail view", () => {
    render(<KidFeed />);
    const usps = within(section("Needs your answer")).getByRole("link");
    expect(usps).toHaveAttribute("href", "/kid/item/mock_feed_usps");
  });

  it("moves an email to \"You answered\" once the kid answers, and says when nothing is left", async () => {
    render(<KidFeed />);
    const { result } = renderHook(() => useAnswerFeedItem());
    await act(() => result.current({ feedItemId: "mock_feed_usps" as never, answer: "fine" }));

    expect(within(section("Needs your answer")).getByText(/Nothing to answer/)).toBeInTheDocument();
    expect(cards("You answered")).toContainEqual(expect.stringContaining("You said it's fine."));
  });
});
