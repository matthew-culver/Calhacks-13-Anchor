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

const form = () => screen.getByRole("button", { name: /protect my email|opening google/i }).closest("form")!;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://x.convex.site/");
  fakeBackend.reset();
  fakeBackend.setQuery("families:getInvite", invite);
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("parent invite page", () => {
  it("says exactly who is asking, with their email, in two short lines", () => {
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi Mom");
    expect(screen.getByText(/wants to help keep scam emails away from you\.$/)).toHaveTextContent(
      "Lucas (lucas@example.com) wants to help keep scam emails away from you.",
    );
    expect(screen.getByText("Only tap the button if Lucas asked you.")).toBeInTheDocument();
  });

  it("tells the parent the real name of Google's button", () => {
    render(<InviteScreen token="tok123" />);
    expect(screen.getByText(/Tap Continue\./)).toBeInTheDocument();
  });

  it("posts the invite in a form body to the Convex site, never in the URL", () => {
    render(<InviteScreen token="tok123" />);
    expect(form()).toHaveAttribute("method", "POST");
    expect(form()).toHaveAttribute("action", "https://x.convex.site/gmail/start");
    expect(form().querySelector('input[type="hidden"][name="invite"]')).toHaveValue("tok123");
    expect(screen.getByRole("button", { name: "Protect my email" })).toHaveAttribute("type", "submit");
  });

  it("shows it's working after the tap, and ignores a second tap", () => {
    render(<InviteScreen token="tok123" />);
    // jsdom doesn't navigate on submit; the handler still runs.
    fireEvent.submit(form());
    expect(screen.getByRole("button", { name: "Opening Google..." })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Taking you to Google");

    const second = fireEvent.submit(form());
    expect(second).toBe(false); // default prevented
  });

  it("turns the button back on when the parent comes back with Back", () => {
    render(<InviteScreen token="tok123" />);
    fireEvent.submit(form());
    const back = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(back, "persisted", { value: true });
    fireEvent(window, back);
    expect(screen.getByRole("button", { name: "Protect my email" })).not.toHaveAttribute("aria-disabled");
  });

  it("remembers the kid's name for the problem page when the parent taps", () => {
    render(<InviteScreen token="tok123" />);
    fireEvent.submit(form());
    expect(sessionStorage.getItem("anchor.kidName")).toBe("Lucas");
  });

  it("still works when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<InviteScreen token="tok123" />);
    expect(() => fireEvent.submit(form())).not.toThrow();
    expect(screen.getByRole("button", { name: "Opening Google..." })).toBeInTheDocument();
  });

  it("leaves out the email when the kid has none on file", () => {
    fakeBackend.setQuery("families:getInvite", { ...invite, kidEmail: null });
    render(<InviteScreen token="tok123" />);
    expect(screen.getByText(/wants to help/)).toHaveTextContent(/^Lucas wants to help/);
  });

  it("leaves expiry to the server, so a phone with a fast clock can't turn away a good link", () => {
    fakeBackend.setQuery("families:getInvite", { ...invite, inviteExpiresAt: Date.now() - DAY });
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("button", { name: "Protect my email" })).toBeInTheDocument();
  });

  it("explains a used or unknown link calmly, with nothing to tap", () => {
    fakeBackend.setQuery("families:getInvite", null);
    render(<InviteScreen token="tok123" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link was already used");
    expect(screen.getByRole("main")).toHaveTextContent("Ask the person who sent it to you for a new one.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
