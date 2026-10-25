import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedEntry } from "@/shared/feedApi";
import { AlertsButton, useNewItemAlerts } from "./Alerts";

const entry = (id: string, kind: FeedEntry["kind"]) =>
  ({ _id: id, kind, createdAt: 0, verdict: { level: "unsure", claimedOrg: "Chase", fromDomain: "x.co" } }) as unknown as FeedEntry;

function fakeNotifications(permission: NotificationPermission) {
  const shown: { title: string; body?: string }[] = [];
  class FakeNotification {
    static permission = permission;
    onclick: (() => void) | null = null;
    constructor(title: string, opts?: { body?: string }) {
      shown.push({ title, body: opts?.body });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return shown;
}

afterEach(() => vi.unstubAllGlobals());

describe("new email alerts", () => {
  it("alerts once for each email that arrives after the page opened, never for the ones already there", () => {
    const shown = fakeNotifications("granted");
    const { rerender } = renderHook(({ feed }) => useNewItemAlerts(feed, "Mom"), { initialProps: { feed: [entry("a", "needs_answer")] } });
    expect(shown).toEqual([]);
    rerender({ feed: [entry("a", "needs_answer"), entry("b", "asked")] });
    expect(shown).toEqual([{ title: "Mom asked you about an email", body: "Says it's from Chase" }]);
    rerender({ feed: [entry("a", "needs_answer"), entry("b", "asked")] });
    expect(shown).toHaveLength(1);
  });

  it("stays quiet until the kid turns alerts on", () => {
    const shown = fakeNotifications("default");
    const { rerender } = renderHook(({ feed }) => useNewItemAlerts(feed, "Mom"), { initialProps: { feed: [] as FeedEntry[] } });
    rerender({ feed: [entry("c", "held")] });
    expect(shown).toEqual([]);
  });
});

describe("a browser that refuses alerts", () => {
  it("never breaks the page (Chrome on Android throws when asked for one)", () => {
    class RefusingNotification {
      static permission = "granted";
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    }
    vi.stubGlobal("Notification", RefusingNotification);
    const { rerender } = renderHook(({ feed }) => useNewItemAlerts(feed, "Mom"), { initialProps: { feed: [] as FeedEntry[] } });
    expect(() => rerender({ feed: [entry("d", "held")] })).not.toThrow();
  });
});

describe("turning alerts on", () => {
  function askingNotifications(answer: NotificationPermission, refuses = false) {
    const shown: string[] = [];
    class AskingNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn(async () => answer);
      constructor(title: string) {
        if (refuses) throw new TypeError("Illegal constructor");
        shown.push(title);
      }
    }
    vi.stubGlobal("Notification", AskingNotification);
    return shown;
  }

  it("shows a first alert right away and moves focus to the confirmation", async () => {
    const shown = askingNotifications("granted");
    render(<AlertsButton />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Get alerts on this computer" })));
    expect(shown).toEqual(["Alerts are on"]);
    expect(screen.getByRole("status")).toHaveTextContent("Alerts are on for this computer.");
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("says so plainly when the browser can't show them", async () => {
    askingNotifications("granted", true);
    render(<AlertsButton />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Get alerts on this computer" })));
    expect(screen.getByRole("status")).toHaveTextContent("This browser can't show alerts.");
  });
});
