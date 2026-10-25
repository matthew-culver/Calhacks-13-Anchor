// B1 kid onboarding: sign up, say who we're protecting, then share the invite link.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "@/test/fakeBackend";
import { StartFlow } from "./StartFlow";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);
vi.mock("@convex-dev/auth/react", async () => (await import("@/test/fakeBackend")).authReact);

const DAY = 24 * 60 * 60 * 1000;
const waitingFamily = {
  _id: "fam1",
  parentName: "Mom",
  parentEmail: "mom@gmail.com",
  kidName: "Lucas",
  status: "invited",
  inviteToken: "tok123",
  inviteExpiresAt: Date.now() + 7 * DAY,
};

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Puts a fake clipboard on navigator; afterEach takes it off again. */
const stubClipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

beforeEach(() => {
  fakeBackend.reset();
  fakeBackend.signIn.mockImplementation(async () => {
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", null);
    return { signingIn: false };
  });
  fakeBackend.mutations["families:createFamily"] = vi.fn(async () => {
    fakeBackend.setQuery("families:getMyFamily", waitingFamily);
    return { familyId: "fam1", inviteToken: "tok123" };
  });
});

async function signUpAndCreateFamily() {
  render(<StartFlow />);
  type(/your first name/i, "Lucas");
  // A phone capitalizes the first letter; it must still be the same account later.
  type(/your email/i, " Lucas@Example.com ");
  type(/password/i, "longenough");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  const next = await screen.findByRole("heading", { name: "Who are we protecting?" });
  expect(next).toHaveFocus();
  type(/what do you call them/i, " Mom ");
  type(/their gmail/i, "mom@gmail.com");
  fireEvent.click(screen.getByRole("button", { name: "Make their link" }));

  await screen.findByRole("heading", { name: "Send Mom their link" });
}

describe("kid onboarding", () => {
  it("signs up, then creates the family with the kid's and parent's details", async () => {
    await signUpAndCreateFamily();
    expect(fakeBackend.signIn).toHaveBeenCalledWith("password", {
      flow: "signUp",
      email: "lucas@example.com",
      password: "longenough",
    });
    expect(fakeBackend.mutations["families:createFamily"]).toHaveBeenCalledWith({
      parentName: "Mom",
      parentEmail: "mom@gmail.com",
      kidName: "Lucas",
    });
  });

  it("shows the invite link with a text button and a copy button", async () => {
    await signUpAndCreateFamily();
    const link = `${window.location.origin}/invite/tok123`;
    expect(screen.getByText(link)).toBeInTheDocument();

    const text = screen.getByRole("link", { name: "Text it to Mom" });
    expect(text.getAttribute("href")).toMatch(/^sms:/);
    expect(decodeURIComponent(text.getAttribute("href")!)).toContain(link);

    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    fireEvent.click(screen.getByRole("button", { name: "Copy the link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
    // Goes back after a moment.
    expect(await screen.findByRole("button", { name: "Copy the link" }, { timeout: 3000 })).toBeInTheDocument();
  });

  it("tells the kid how to copy by hand when the clipboard is blocked", async () => {
    await signUpAndCreateFamily();
    stubClipboard(async () => {
      throw new Error("blocked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy the link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/press and hold the link/i);
  });

  it("shows a plain message when sign-up fails, and clears it when switching to sign in", async () => {
    fakeBackend.signIn.mockRejectedValueOnce(new Error("Account already exists"));
    render(<StartFlow />);
    type(/your first name/i, "Lucas");
    type(/your email/i, "lucas@example.com");
    type(/password/i, "longenough");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in instead/i);
    fireEvent.click(screen.getByRole("button", { name: "I already have an account" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never shows a raw object from the server", async () => {
    fakeBackend.mutations["families:createFamily"].mockRejectedValueOnce(new ConvexError({ code: "x" }));
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", null);
    render(<StartFlow />);
    type(/your first name/i, "Lucas");
    type(/what do you call them/i, "Mom");
    type(/their gmail/i, "mom@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Make their link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("shows the server's plain message when making the family fails", async () => {
    fakeBackend.mutations["families:createFamily"].mockRejectedValueOnce(
      new ConvexError("That doesn't look like an email address."),
    );
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", null);
    render(<StartFlow />);
    // Signed in but no name remembered (a reload), so this screen asks for it.
    type(/your first name/i, "Lucas");
    type(/what do you call them/i, "Mom");
    type(/their gmail/i, "mom@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Make their link" }));

    expect(await screen.findByText("That doesn't look like an email address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make their link" })).toBeEnabled();
  });

  it("lets a returning kid sign in instead", async () => {
    render(<StartFlow />);
    fireEvent.click(screen.getByRole("button", { name: "I already have an account" }));
    expect(screen.queryByLabelText(/your first name/i)).toBeNull();
    type(/your email/i, "LUCAS@example.com");
    type(/password/i, "longenough");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(fakeBackend.signIn).toHaveBeenCalledWith("password", {
        flow: "signIn",
        email: "lucas@example.com",
        password: "longenough",
      }),
    );
  });

  it("goes straight to the link for a kid who already set up", () => {
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", waitingFamily);
    render(<StartFlow />);
    expect(screen.getByRole("heading", { name: "Send Mom their link" })).toBeInTheDocument();
  });

  it("offers a new link when the old one ran out", async () => {
    const renew = vi.fn(async () => {
      fakeBackend.setQuery("families:getMyFamily", { ...waitingFamily, inviteToken: "tok456" });
      return { inviteToken: "tok456" };
    });
    fakeBackend.mutations["families:renewInvite"] = renew;
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", { ...waitingFamily, inviteExpiresAt: Date.now() - DAY });
    render(<StartFlow />);

    fireEvent.click(screen.getByRole("button", { name: "Make a new link" }));
    expect(await screen.findByText(`${window.location.origin}/invite/tok456`)).toBeInTheDocument();
    expect(renew).toHaveBeenCalled();
  });

  it("sends a kid whose parent is connected to their feed", () => {
    // Once connected, getMyFamily leaves the invite fields out entirely.
    const { _id, parentName, parentEmail, kidName } = waitingFamily;
    fakeBackend.set({ isAuthenticated: true });
    fakeBackend.setQuery("families:getMyFamily", { _id, parentName, parentEmail, kidName, status: "active" });
    render(<StartFlow />);
    expect(screen.getByRole("link", { name: /see what's happening with mom/i })).toHaveAttribute("href", "/kid");
  });
});
