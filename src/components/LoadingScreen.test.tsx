import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoadingScreen } from "./LoadingScreen";

afterEach(() => vi.useRealTimers());

it("says it's still connecting only when loading takes a while", () => {
  vi.useFakeTimers();
  render(<LoadingScreen />);
  expect(screen.getByRole("heading", { name: "One moment..." })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("");
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("status")).toHaveTextContent("Still connecting");
});
