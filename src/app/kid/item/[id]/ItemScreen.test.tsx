// B3 detail view: plain checks, and the kid's one-tap answer with an optional note.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockFeed } from "@/shared/feedApi";
import { fakeBackend } from "@/test/fakeBackend";
import { seedSignedInKid } from "@/test/seed";
import { ItemScreen } from "./ItemScreen";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);

// Lets one test make the answer fail, the way a dropped connection would.
const network = vi.hoisted(() => ({ down: false }));
vi.mock("@/shared/feedApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/feedApi")>();
  return {
    ...real,
    useAnswerFeedItem: () => {
      const answer = real.useAnswerFeedItem();
      return (args: Parameters<typeof answer>[0]) =>
        network.down ? Promise.reject(new Error("offline")) : answer(args);
    },
  };
});

beforeEach(() => {
  fakeBackend.reset();
  seedSignedInKid();
  resetMockFeed();
  network.down = false;
});

describe("feed item detail", () => {
  it("moves focus to the result after answering, so a screen reader says what happened", async () => {
    render(<ItemScreen id="mock_feed_usps" />);
    fireEvent.click(screen.getByRole("button", { name: "It's a scam" }));
    // Sending is async: focus moves once the answer is saved.
    await waitFor(() => expect(screen.getByRole("heading", { name: "You said it's a scam." })).toHaveFocus());
  });

  it("doesn't grab focus when opening an email that was answered before", () => {
    render(<ItemScreen id="mock_feed_medicare" />);
    expect(screen.getByRole("heading", { name: "You said it's a scam." })).not.toHaveFocus();
  });

  it("shows no note line when the kid didn't write one", () => {
    render(<ItemScreen id="mock_feed_usps" />);
    fireEvent.click(screen.getByRole("button", { name: "It's fine" }));
    expect(screen.queryByText(/Your note to Mom/)).toBeNull();
  });

  it("keeps the buttons and says so plainly when sending fails", async () => {
    network.down = true;
    render(<ItemScreen id="mock_feed_usps" />);
    fireEvent.click(screen.getByRole("button", { name: "It's a scam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Please try again.");
    expect(screen.getByRole("button", { name: "It's a scam" })).toBeEnabled();
  });

  it("removes hidden characters that could disguise who sent it", () => {
    render(<ItemScreen id="mock_feed_chase" />);
    expect(screen.getByRole("main").textContent).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
  });

  it("shows what it claims and every check in plain words, never the technical detail", () => {
    render(<ItemScreen id="mock_feed_chase" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Says it's from Chase");
    expect(screen.getByText("alerts@chase-secure-login.co", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("You don't have a Chase account.")).toBeInTheDocument();
    expect(screen.getByText("The button leads to a fake website made 3 days ago.")).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveTextContent(/DMARC|RDAP|href/);
  });

  it("labels each check so color isn't the only clue", () => {
    render(<ItemScreen id="mock_feed_usps" />);
    // USPS: 2 pass, 2 warn, 1 unknown.
    expect(screen.getAllByText("Looks right:", { exact: false })).toHaveLength(2);
    expect(screen.getAllByText("Odd:", { exact: false })).toHaveLength(2);
    expect(screen.getAllByText("Couldn't check:", { exact: false })).toHaveLength(1);
  });

  it("sends \"It's a scam\" with the kid's own note, then shows what was sent", () => {
    render(<ItemScreen id="mock_feed_usps" />);
    fireEvent.change(screen.getByLabelText("A note for Mom (optional)"), {
      target: { value: "  Good catch, Mom. Love you.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "It's a scam" }));

    expect(screen.getByText("You said it's a scam.")).toBeInTheDocument();
    expect(screen.getByText("It stays out of Mom's inbox.")).toBeInTheDocument();
    expect(screen.getByText("Your note to Mom: “Good catch, Mom. Love you.”")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "It's fine" })).toBeNull();
  });

  it("lets the kid release a held email that was really fine", () => {
    render(<ItemScreen id="mock_feed_chase" />);
    expect(screen.getByText(/If it's a real email, tap “It's fine”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "It's fine" }));
    expect(screen.getByText("We put it back in Mom's inbox.")).toBeInTheDocument();
  });

  it("shows an earlier answer instead of the buttons", () => {
    render(<ItemScreen id="mock_feed_medicare" />);
    expect(screen.getByText("Your note to Mom: “Good catch, Mom. That one's fake. Love you.”")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains an unknown id with a way back", () => {
    render(<ItemScreen id="nope" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("We couldn't find that email");
    expect(screen.getByRole("link", { name: "Back to this week" })).toHaveAttribute("href", "/kid");
  });

  it("shows the server's own plain message when it refuses the answer", async () => {
    fakeBackend.mutations["feed:answer"].mockRejectedValueOnce(new ConvexError("You already answered this one."));
    render(<ItemScreen id="mock_feed_usps" />);
    fireEvent.click(screen.getByRole("button", { name: "It's a scam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already answered this one.");
  });
});
