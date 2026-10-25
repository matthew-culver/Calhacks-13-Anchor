// B1 kid onboarding: sign up, say who we're protecting, then share the invite link.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFamily } from "@/shared/api";
import { StartFlow } from "./StartFlow";

vi.mock("@/shared/api", () => ({
  signUp: vi.fn(async () => {}),
  createFamily: vi.fn(async () => ({ inviteToken: "tok123" })),
}));

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function goToShare() {
  render(<StartFlow />);
  type(/your first name/i, "Lucas");
  type(/your email/i, "lucas@example.com");
  type(/password/i, "longenough");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByRole("heading", { name: "Who are we protecting?" });
  type(/what do you call them/i, " Mom ");
  type(/their gmail/i, "mom@gmail.com");
  fireEvent.click(screen.getByRole("button", { name: "Make their link" }));

  await screen.findByRole("heading", { name: "Send Mom their link" });
}

describe("kid onboarding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the family with the kid's and parent's details", async () => {
    await goToShare();
    expect(createFamily).toHaveBeenCalledWith({
      parentName: "Mom",
      parentEmail: "mom@gmail.com",
      kidName: "Lucas",
    });
  });

  it("shows the invite link with a text button and a copy button", async () => {
    await goToShare();
    const link = `${window.location.origin}/invite/tok123`;
    expect(screen.getByText(link)).toBeInTheDocument();

    const text = screen.getByRole("link", { name: "Text it to Mom" });
    expect(text.getAttribute("href")).toMatch(/^sms:/);
    expect(decodeURIComponent(text.getAttribute("href")!)).toContain(link);

    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy the link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("shows a plain error and lets the kid retry when making the link fails", async () => {
    vi.mocked(createFamily).mockRejectedValueOnce(new Error("boom"));
    render(<StartFlow />);
    type(/your first name/i, "Lucas");
    type(/your email/i, "lucas@example.com");
    type(/password/i, "longenough");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Who are we protecting?" });
    type(/what do you call them/i, "Mom");
    type(/their gmail/i, "mom@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Make their link" }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make their link" })).toBeEnabled();
  });
});
