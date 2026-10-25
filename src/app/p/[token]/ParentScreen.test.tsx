// The parent's page: big-text accounts by the private link, the right words for every state,
// and the B2 done screen.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAccounts } from "@/shared/mock";
import { fakeBackend } from "@/test/fakeBackend";
import { seedParent } from "@/test/seed";
import { ParentScreen } from "./ParentScreen";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

beforeEach(() => {
  fakeBackend.reset();
  seedParent();
});

const title = () => screen.getByRole("heading", { level: 1 });

describe("parent page", () => {
  it("greets the parent and lists their real websites, to use instead of email links", () => {
    render(<ParentScreen token="ptok" />);
    expect(title()).toHaveTextContent("Your accounts");
    expect(screen.getByRole("main")).toHaveTextContent("Hi Mom.");
    expect(screen.getByRole("main")).toHaveTextContent("tap a button here instead of a link in an email");
    expect(screen.getByRole("main")).toHaveTextContent("Lucas sees only this list and the emails we set aside.");
    expect(screen.getByRole("link", { name: "Open Kaiser Permanente" })).toHaveAttribute(
      "href",
      "https://healthy.kaiserpermanente.org/",
    );
  });

  it("fills in on its own while the history is still being read, and announces each change", () => {
    seedParent("learning");
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" />);
    // Focus on the new title is what screen readers announce when the screen changes.
    expect(title()).toHaveTextContent("Getting your accounts ready");
    expect(title()).toHaveFocus();

    act(() => {
      seedParent("active");
      fakeBackend.setQuery("accounts:parentAccounts", mockAccounts);
    });
    expect(title()).toHaveTextContent("Your accounts");
    expect(title()).toHaveFocus();
    expect(screen.getByRole("link", { name: "Open Wells Fargo" })).toBeInTheDocument();
  });

  it("says a bad link doesn't work, instead of \"still learning\" forever", () => {
    fakeBackend.setQuery("families:getParentView", null);
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="nope" />);
    expect(title()).toHaveTextContent("This link doesn't work");
  });

  it("says protection is off when the parent turned it off", () => {
    seedParent("off");
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" />);
    expect(title()).toHaveTextContent("Protection is off");
  });

  it("asks for a new tap when Google access needs renewing", () => {
    seedParent("needs_reconnect");
    render(<ParentScreen token="ptok" />);
    expect(title()).toHaveTextContent("Anchor needs your OK");
    expect(screen.getByRole("main")).toHaveTextContent("Tap the link Lucas sends you.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows only the done screen right after connecting, with the real kid's name", () => {
    render(<ParentScreen token="ptok" justConnected />);
    expect(title()).toHaveTextContent("You're done");
    expect(screen.getByRole("main")).toHaveTextContent("Lucas hears about anything we're not sure of.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
