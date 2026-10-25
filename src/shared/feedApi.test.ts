// Live answers go to A6's api.feed.answer; demo mode keeps them in the browser and must behave
// the same way, so the demo is honest.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "@/test/fakeBackend";
import { seedSignedInKid } from "@/test/seed";
import { MAX_NOTE, resetMockFeed, useAnswerFeedItem, useFeed } from "./feedApi";
import { mockFeed } from "./mock";

const usps = mockFeed.find((f) => f._id === "mock_feed_usps")!._id;

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

beforeEach(() => {
  fakeBackend.reset();
  seedSignedInKid();
  resetMockFeed();
});

afterEach(() => sessionStorage.clear());

function setup() {
  const feed = renderHook(() => useFeed());
  const answer = renderHook(() => useAnswerFeedItem()).result.current;
  const kidAnswer = () => feed.result.current!.find((e) => e._id === usps)!.kidAnswer;
  return { answer, kidAnswer };
}

describe("answering live", () => {
  it("sends the answer and note to api.feed.answer", async () => {
    const { answer, kidAnswer } = setup();
    await act(() => answer({ feedItemId: usps, answer: "scam", note: "Good catch, Mom." }));
    expect(fakeBackend.mutations["feed:answer"]).toHaveBeenCalledWith({
      feedItemId: usps,
      answer: "scam",
      note: "Good catch, Mom.",
    });
    expect(kidAnswer()).toMatchObject({ answer: "scam", note: "Good catch, Mom." });
  });
});

describe("answering in demo mode", () => {
  beforeEach(() => sessionStorage.setItem("anchor.demo", "1"));

  it("never calls the backend", async () => {
    const { answer } = setup();
    await act(() => answer({ feedItemId: usps, answer: "scam" }));
    expect(fakeBackend.mutations["feed:answer"]).not.toHaveBeenCalled();
  });

  it("keeps the answer for the tab, so the parent's sample page shows it after a page load", async () => {
    const asked = mockFeed.find((f) => f.kind === "asked")!._id;
    const { answer } = setup();
    await act(() => answer({ feedItemId: asked, answer: "fine", note: "That one's real, Mom." }));
    vi.resetModules(); // a page load: memory is gone, the tab's storage isn't
    const { useSampleFeed } = await import("./feedApi");
    const parentSees = renderHook(() => useSampleFeed()).result.current.find((e) => e._id === asked);
    expect(parentSees?.kidAnswer).toMatchObject({ answer: "fine", note: "That one's real, Mom." });
  });

  it("leaves the note out when it's empty or only spaces", async () => {
    const { answer, kidAnswer } = setup();
    await act(() => answer({ feedItemId: usps, answer: "scam", note: "   " }));
    expect(kidAnswer()).toEqual({ answer: "scam", answeredAt: expect.any(Number) });
  });

  it("trims the note and caps it at the limit", async () => {
    const { answer, kidAnswer } = setup();
    await act(() => answer({ feedItemId: usps, answer: "scam", note: `  ${"x".repeat(MAX_NOTE + 50)}  ` }));
    expect(kidAnswer()!.note).toHaveLength(MAX_NOTE);
  });

  it("keeps the first answer if the kid somehow answers twice", async () => {
    const { answer, kidAnswer } = setup();
    await act(() => answer({ feedItemId: usps, answer: "scam", note: "First" }));
    await act(() => answer({ feedItemId: usps, answer: "fine", note: "Second" }));
    expect(kidAnswer()).toMatchObject({ answer: "scam", note: "First" });
  });
});
