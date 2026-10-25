// B3 detail view: plain checks, and the kid's one-tap answer with an optional note.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMockFeed } from "@/shared/feedApi";
import { ItemScreen } from "./ItemScreen";

beforeEach(() => resetMockFeed());

describe("feed item detail", () => {
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
});
