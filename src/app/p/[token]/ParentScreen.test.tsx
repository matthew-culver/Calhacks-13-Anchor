// B4 parent page: big-text accounts by the private link, and the B2 done screen.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAccounts } from "@/shared/mock";
import { fakeBackend } from "@/test/fakeBackend";
import { ParentScreen } from "./ParentScreen";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

beforeEach(() => {
  fakeBackend.reset();
  fakeBackend.setQuery("accounts:parentAccounts", mockAccounts);
});

describe("parent page", () => {
  it("lists the parent's real websites and says to use them instead of email links", () => {
    render(<ParentScreen token="ptok" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your accounts");
    expect(screen.getByRole("main")).toHaveTextContent("tap a button here instead of a link in an email");
    expect(screen.getByRole("link", { name: "Open Kaiser Permanente" })).toHaveAttribute(
      "href",
      "https://healthy.kaiserpermanente.org/",
    );
  });

  it("fills in on its own while the history is still being read", () => {
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" />);
    expect(screen.getByRole("status")).toHaveTextContent("This page fills in on its own.");

    act(() => fakeBackend.setQuery("accounts:parentAccounts", mockAccounts));
    expect(screen.getByRole("link", { name: "Open Wells Fargo" })).toBeInTheDocument();
  });

  it("shows only the done screen right after connecting, with no names", () => {
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You're done");
    expect(screen.getByRole("main")).not.toHaveTextContent(/Lucas|Mom/);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
