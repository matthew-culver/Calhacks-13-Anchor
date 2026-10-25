// The parent's page: big-text accounts by the private link, the right words for every state,
// and the B2 done screen.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByRole("main")).toHaveTextContent("Lucas sees only this list, the emails we set aside or weren't sure about, and the ones you ask about.");
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

  it("right after connecting: says you're done, with the real kid's name, and nothing to decide", () => {
    render(<ParentScreen token="ptok" justConnected />);
    expect(title()).toHaveTextContent("You're done");
    expect(screen.getByRole("main")).toHaveTextContent("You don't need to do anything else.");
    expect(screen.getByRole("main")).toHaveTextContent("Lucas hears about anything we're not sure of.");
    // No "Turn it off" on the screen Mom sees the moment she connects.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("connect screen, live (B10)", () => {
  it("says it's finding her accounts before any arrive", () => {
    seedParent("learning");
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("status")).toHaveTextContent("Finding the places you use…");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows accounts as they arrive, and keeps saying it's still finding more", () => {
    seedParent("learning");
    fakeBackend.setQuery("accounts:parentAccounts", mockAccounts.slice(0, 2));
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("status")).toHaveTextContent("Still finding more…");
    expect(screen.getByRole("link", { name: "Open Wells Fargo" })).toBeInTheDocument();

    act(() => fakeBackend.setQuery("accounts:parentAccounts", mockAccounts));
    expect(screen.getByRole("link", { name: "Open Medicare" })).toBeInTheDocument();
  });

  it("when the import is done, lets her know she can tap one whenever she needs it", () => {
    seedParent("active");
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "These are the real websites you use. Whenever you need one, tap it to sign in.",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Money" })).toBeInTheDocument();
  });

  it("doesn't say \"tap one\" before it knows the import is finished", () => {
    fakeBackend.setQuery("families:getParentView", undefined);
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("status")).toHaveTextContent("Still finding more…");
  });

  it("doesn't say \"finding\" forever when the import found nothing", () => {
    seedParent("active");
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("status")).toHaveTextContent("We didn't find any yet. We'll keep looking.");
  });
});

describe("parent weekly recap", () => {
  it("tells the parent this week's story in plain sentences, with the good catch", () => {
    render(<ParentScreen token="ptok" />);
    const recap = screen.getByRole("heading", { level: 2, name: "This week" }).closest("div")!;
    expect(recap).toHaveTextContent("We checked 41 emails for you.");
    expect(recap).toHaveTextContent("We set aside 3 fake emails, so you didn't have to.");
    expect(recap).toHaveTextContent("You and Lucas caught 1 scam together. Good catch!");
  });

  it("says nothing looked fake on a quiet week, and skips the good-catch line", () => {
    fakeBackend.setQuery("feed:parentWeeklyRecap", { weekStart: 0, checked: 12, held: 0, needAnswer: 0, goodCatches: 0 });
    render(<ParentScreen token="ptok" />);
    expect(screen.getByText("Nothing looked fake.")).toBeInTheDocument();
    expect(screen.queryByText(/Good catch/)).toBeNull();
  });

  it("doesn't say \"checked 0 emails\" before any mail arrives", () => {
    fakeBackend.setQuery("feed:parentWeeklyRecap", { weekStart: 0, checked: 0, held: 0, needAnswer: 0, goodCatches: 0 });
    render(<ParentScreen token="ptok" />);
    expect(screen.getByText("No new emails yet this week.")).toBeInTheDocument();
  });
});

describe("turning it off", () => {
  const turnOff = () => fakeBackend.mutations["turnOff:turnOff"];

  it("never turns off by itself: opening the page does nothing", () => {
    render(<ParentScreen token="ptok" />);
    expect(turnOff()).not.toHaveBeenCalled();
  });

  it("asks first, and \"Keep it on\" changes nothing", () => {
    render(<ParentScreen token="ptok" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off Anchor" }));
    expect(screen.getByRole("heading", { name: "Turn off Anchor?" })).toHaveFocus();
    expect(screen.getByText(/delete everything we learned\. Lucas will see that it's off\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep it on" }));
    expect(turnOff()).not.toHaveBeenCalled();
    // Focus goes back where the parent was, not to the top of the page.
    expect(screen.getByRole("button", { name: "Turn off Anchor" })).toHaveFocus();
  });

  it("turns off after \"Yes, turn it off\", and the page says protection is off", async () => {
    render(<ParentScreen token="ptok" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off Anchor" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, turn it off" }));

    expect(turnOff()).toHaveBeenCalledWith({ parentToken: "ptok" });
    expect(await screen.findByRole("heading", { level: 1, name: "Protection is off" })).toBeInTheDocument();
  });

  it("can be turned off while the accounts are still being learned", () => {
    seedParent("learning");
    fakeBackend.setQuery("accounts:parentAccounts", []);
    render(<ParentScreen token="ptok" />);
    expect(screen.getByRole("button", { name: "Turn off Anchor" })).toBeInTheDocument();
  });

  it("says plainly when turning off fails, and keeps the choice open", async () => {
    turnOff().mockRejectedValueOnce(new Error("offline"));
    render(<ParentScreen token="ptok" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off Anchor" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, turn it off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Please try again.");
    expect(screen.getByRole("button", { name: "Yes, turn it off" })).not.toHaveAttribute("aria-disabled");
  });

  it("keeps focus on \"Yes, turn it off\" while it works, instead of dropping it to the page", () => {
    turnOff().mockImplementationOnce(() => new Promise(() => {}));
    render(<ParentScreen token="ptok" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off Anchor" }));
    const yes = screen.getByRole("button", { name: "Yes, turn it off" });
    yes.focus();
    fireEvent.click(yes);
    const busy = screen.getByRole("button", { name: "Turning off..." });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    // A second tap while busy does nothing.
    fireEvent.click(busy);
    expect(turnOff()).toHaveBeenCalledTimes(1);
  });
});

describe("links that shouldn't say \"You're done\"", () => {
  it("a bad ?connected=1 link says it doesn't work", () => {
    fakeBackend.setQuery("families:getParentView", null);
    render(<ParentScreen token="nope" justConnected />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link doesn't work");
  });

  it("a ?connected=1 link after turning off says protection is off", () => {
    seedParent("off");
    render(<ParentScreen token="ptok" justConnected />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Protection is off");
  });
});

describe("demo mode on a real parent link", () => {
  afterEach(() => sessionStorage.clear());

  it("ignores a demo remembered from an earlier rehearsal in this tab", () => {
    sessionStorage.setItem("anchor.demo", "1");
    render(<ParentScreen token="ptok" />);
    expect(screen.queryByText("Sample data for the demo")).toBeNull();
    expect(screen.getByRole("main")).toHaveTextContent("Hi Mom.");
    expect(screen.getByRole("button", { name: "Turn off Anchor" })).toBeInTheDocument();
  });
});
