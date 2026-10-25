import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeAgo, timeAgo } from "./TimeAgo";

const MIN = 60 * 1000;
const now = Date.UTC(2026, 9, 24, 12, 0);

afterEach(() => vi.useRealTimers());

describe("timeAgo", () => {
  it.each([
    [0, "just now"],
    [MIN - 1, "just now"],
    [MIN, "1 minute ago"],
    [20 * MIN, "20 minutes ago"],
    [60 * MIN - 1, "59 minutes ago"],
    [60 * MIN, "1 hour ago"],
    [24 * 60 * MIN - 1, "23 hours ago"],
    [24 * 60 * MIN, "1 day ago"],
    [3 * 24 * 60 * MIN, "3 days ago"],
    [-5 * MIN, "just now"], // a clock that's a little behind
  ])("%i ms ago reads %s", (ago, text) => {
    expect(timeAgo(now - ago, now)).toBe(text);
  });
});

describe("<TimeAgo>", () => {
  it("moves on as time passes instead of freezing", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(now);
    render(
      <p>
        <TimeAgo at={now - 20 * MIN} />
      </p>,
    );
    expect(screen.getByText("20 minutes ago")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(MIN));
    expect(screen.getByText("21 minutes ago")).toBeInTheDocument();
  });
});
