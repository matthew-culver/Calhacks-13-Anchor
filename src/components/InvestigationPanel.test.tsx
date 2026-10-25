// B9: the AI investigator's steps appearing live, then its conclusion, in plain words.

import { act, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_INVESTIGATIONS, useInvestigation, type InvestigationView } from "@/shared/investigationApi";
import { fakeBackend } from "@/test/fakeBackend";
import { InvestigationPanel } from "./InvestigationPanel";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

// From CLAUDE.md: plain words only, and never say "safe".
const BANNED = /\b(safe|phishing|domain|dkim|spf|dmarc)\b/i;

beforeEach(() => fakeBackend.reset());

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

const chase = SAMPLE_INVESTIGATIONS.mock_feed_chase;

describe("investigation panel", () => {
  it("shows nothing when there's no investigation", () => {
    const { container } = render(<InvestigationPanel investigation={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("while running: says it's still checking and lists the steps so far, quietly", () => {
    const running: InvestigationView = { status: "running", startedAt: 0, steps: chase.steps.slice(0, 3) };
    render(<InvestigationPanel investigation={running} />);
    expect(screen.getByRole("status")).toHaveTextContent("Still checking…");
    // A plain list, not a live log: screen readers hear "checking" and "done", not every step.
    expect(screen.queryByRole("log")).toBeNull();
    expect(within(screen.getByRole("list", { name: "What we did" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/What to do/)).toBeNull();
  });

  it("when done: says so, then the summary, who really sent it, each link and what to do", () => {
    render(<InvestigationPanel investigation={chase} />);
    expect(screen.getByRole("status")).toHaveTextContent("Finished checking. Here's what we found.");
    expect(screen.getByText(/A fake Chase email/)).toBeInTheDocument();
    expect(screen.getByText("Pretending to be someone else")).toBeInTheDocument();
    expect(screen.getByText("chase-secure-login.co")).toBeInTheDocument();
    expect(screen.getByText("Dangerous")).toBeInTheDocument();
    expect(screen.getByText(/It's already held/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chase: How to spot fake emails" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("calls a fine link \"Looks fine\", never \"safe\", and a real sender \"Really them\"", () => {
    const sue: InvestigationView = {
      status: "done",
      startedAt: 0,
      steps: [{ at: 0, kind: "finding", text: "Aunt Sue often sends YouTube videos" }],
      conclusion: {
        level: "real",
        summary: "This is really Aunt Sue sharing a video.",
        sender: { verdict: "genuine", reason: "Her usual address, and she often sends videos." },
        links: [{ site: "youtube.com", verdict: "safe", reason: "A well-known video site." }],
      },
    };
    const { container } = render(<InvestigationPanel investigation={sue} />);
    expect(screen.getByText("Looks fine")).toBeInTheDocument();
    expect(screen.getByText("Really them")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it("only links to sources that are https", () => {
    const sneaky: InvestigationView = {
      ...chase,
      sources: [
        { title: "Real page", url: "https://www.chase.com/" },
        { title: "Bad page", url: "javascript:alert(1)" },
      ],
    };
    render(<InvestigationPanel investigation={sneaky} />);
    expect(screen.getByRole("link", { name: "Real page" })).toBeInTheDocument();
    expect(screen.queryByText("Bad page")).toBeNull();
  });

  it("says plainly when the check couldn't finish", () => {
    render(<InvestigationPanel investigation={{ status: "failed", startedAt: 0, steps: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't finish checking this one.");
  });

  it.each(Object.entries(SAMPLE_INVESTIGATIONS))("sample %s uses only plain words", (_id, inv) => {
    const { container } = render(<InvestigationPanel investigation={inv} />);
    expect(container.textContent).not.toMatch(BANNED);
  });
});

describe("useInvestigation", () => {
  it("live: returns A7's investigation for an email the feed knows", () => {
    fakeBackend.setQuery("investigations:forFeedItem", chase);
    const { result } = renderHook(() => useInvestigation("mock_feed_chase"));
    expect(result.current).toBe(chase);
  });

  it("live: doesn't ask about an email the feed doesn't know", () => {
    fakeBackend.setQuery("investigations:forFeedItem", chase);
    const { result } = renderHook(() => useInvestigation("mock_feed_chase", false));
    expect(result.current).toBeNull();
  });

  it("in demo mode, replays the steps one by one, then the conclusion", () => {
    sessionStorage.setItem("anchor.demo", "1");
    vi.useFakeTimers();
    const { result } = renderHook(() => useInvestigation("mock_feed_chase"));
    expect(result.current).toMatchObject({ status: "running", steps: [] });

    act(() => vi.advanceTimersByTime(900 * 2));
    expect(result.current?.steps).toHaveLength(2);
    expect(result.current?.conclusion).toBeUndefined();

    act(() => vi.advanceTimersByTime(900 * (chase.steps.length + 2)));
    expect(result.current?.status).toBe("done");
    expect(result.current?.conclusion?.level).toBe("fake");
  });

  it("has nothing to show for an email without a sample", () => {
    sessionStorage.setItem("anchor.demo", "1");
    const { result } = renderHook(() => useInvestigation("mock_feed_medicare"));
    expect(result.current).toBeNull();
  });
});
