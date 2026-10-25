// The mock answer has to behave like the real one will, so the screens are tested honestly.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_NOTE, resetMockFeed, useAnswerFeedItem, useFeed } from "./feedApi";
import { mockFeed } from "./mock";

const usps = mockFeed.find((f) => f._id === "mock_feed_usps")!._id;

beforeEach(() => resetMockFeed());

function setup() {
  const feed = renderHook(() => useFeed());
  const answer = renderHook(() => useAnswerFeedItem()).result.current;
  const kidAnswer = () => feed.result.current!.find((e) => e._id === usps)!.kidAnswer;
  return { answer, kidAnswer };
}

describe("answering a feed item (mock)", () => {
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
