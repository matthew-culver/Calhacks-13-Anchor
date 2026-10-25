import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Watching } from "./Watching";

const MIN = 60 * 1000;

describe("watching heartbeat", () => {
  it("says Anchor is watching, and when it last checked", () => {
    render(<Watching whose="Mom's" lastCheckedAt={Date.now() - 2 * MIN} />);
    expect(screen.getByText("Watching Mom's inbox")).toBeInTheDocument();
    expect(screen.getByText("· checked 2 minutes ago")).toBeInTheDocument();
  });

  it("says so plainly when the checks have stopped, instead of looking fine", () => {
    render(<Watching whose="your" lastCheckedAt={Date.now() - 45 * MIN} />);
    expect(screen.getByRole("status")).toHaveTextContent("We haven't been able to check your inbox for a while.");
    expect(screen.queryByText(/^Watching/)).toBeNull();
  });

  it("still says it's watching before the first check is recorded", () => {
    render(<Watching whose="Mom's" />);
    expect(screen.getByText("Watching Mom's inbox")).toBeInTheDocument();
    expect(screen.queryByText(/checked/)).toBeNull();
  });
});
