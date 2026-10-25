// B2 parent one-tap page: who is asking, the form post to Gmail connect, and dead links.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "@/test/fakeBackend";
import { InviteScreen } from "./InviteScreen";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

const DAY = 24 * 60 * 60 * 1000;
const invite = {
  parentName: "Mom",
  kidName: "Lucas",
  kidEmail: "lucas@example.com",
  status: "invited",
  inviteExpiresAt: Date.now() + DAY,
};

beforeEach(() => {
  fakeBackend.reset();
  fakeBackend.setQuery("families:getInvite", invite);
});

afterEach(() => sessionStorage.clear());

describe("parent invite page", () => {
  it("says exactly who is asking, with their email", () => {
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi Mom");
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("Lucas (lucas@example.com) wants to help keep scam emails away from you.");
    expect(main).toHaveTextContent("Only continue if Lucas asked you.");
  });

  it("posts the invite in a form body, never in the URL", () => {
    render(<InviteScreen token="tok123" />);
    const button = screen.getByRole("button", { name: "Protect my email" });
    const form = button.closest("form")!;
    expect(form).toHaveAttribute("method", "POST");
    expect(form.getAttribute("action")).toMatch(/\/gmail\/start$/);
    expect(form.getAttribute("action")).not.toContain("tok123");
    expect(form.querySelector('input[type="hidden"][name="invite"]')).toHaveValue("tok123");
    expect(button).toHaveAttribute("type", "submit");
  });

  it("remembers the kid's name for the problem page when the parent taps", () => {
    render(<InviteScreen token="tok123" />);
    // jsdom doesn't navigate on submit; the handler still runs.
    fireEvent.submit(screen.getByRole("button", { name: "Protect my email" }).closest("form")!);
    expect(sessionStorage.getItem("anchor.kidName")).toBe("Lucas");
  });

  it("leaves out the email when the kid has none on file", () => {
    fakeBackend.setQuery("families:getInvite", { ...invite, kidEmail: null });
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("main")).toHaveTextContent(/^Hi MomLucas wants to help/);
  });

  it("explains a used or unknown link calmly, with nothing to tap", () => {
    fakeBackend.setQuery("families:getInvite", null);
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link was already used");
    expect(screen.getByRole("main")).toHaveTextContent("Ask the person who sent it to you for a new one.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells the parent to ask the kid for a new link when it's too old", () => {
    fakeBackend.setQuery("families:getInvite", { ...invite, inviteExpiresAt: Date.now() - DAY });
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link is too old");
    expect(screen.getByRole("main")).toHaveTextContent("Ask Lucas to send you a new one.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
