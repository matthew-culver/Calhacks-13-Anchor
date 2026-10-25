// Smoke tests for the B0 app shell: every screen renders, has one heading,
// one main action, and none of the words the parent should never see.

import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAccounts, mockRecap } from "@/shared/mock";
import { fakeBackend } from "@/test/fakeBackend";
import Home from "./page";
import Start from "./start/page";
import KidFeed from "./kid/page";
import KidAccounts from "./kid/accounts/page";
import { InviteScreen } from "./invite/[token]/InviteScreen";
import { ParentScreen } from "./p/[token]/ParentScreen";
import { ConnectProblemScreen, PROBLEM_REASONS } from "./connect-problem/ConnectProblemScreen";

vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);
vi.mock("@convex-dev/auth/react", async () => (await import("@/test/fakeBackend")).authReact);

// From CLAUDE.md: plain words only, and never say "safe".
const BANNED = /\b(safe|phishing|domain|dkim|spf|dmarc)\b/i;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://x.convex.site");
  fakeBackend.reset();
  fakeBackend.setQuery("families:getInvite", {
    parentName: "Mom",
    kidName: "Lucas",
    kidEmail: "lucas@example.com",
    status: "invited",
    inviteExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
});

const screens: [string, () => ReactElement][] = [
  ["/", () => <Home />],
  ["/start", () => <Start />],
  ["/kid", () => <KidFeed />],
  ["/kid/accounts", () => <KidAccounts />],
  ["/invite/[token]", () => <InviteScreen token="tok123" />],
  ["/p/[token]", () => <ParentScreen token="tok123" />],
  ["/p/[token]?connected=1", () => <ParentScreen token="tok123" justConnected />],
  ...PROBLEM_REASONS.map((r): [string, () => ReactElement] => [
    `/connect-problem?reason=${r}`,
    () => <ConnectProblemScreen reason={r} />,
  ]),
];

describe.each(screens)("%s", (_route, renderScreen) => {
  it("has exactly one main heading", () => {
    render(renderScreen());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("uses only plain words", () => {
    const { container } = render(renderScreen());
    expect(container.textContent).not.toMatch(BANNED);
  });
});

describe("landing page", () => {
  it("has one big action that starts kid setup", () => {
    render(<Home />);
    const main = screen.getByRole("main");
    const actions = within(main).getAllByRole("link");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAttribute("href", "/start");
  });
});

describe("parent invite page", () => {
  it("offers one button: Protect my email", () => {
    render(<InviteScreen token="tok123" />);
    const main = screen.getByRole("main");
    const actions = [
      ...within(main).queryAllByRole("link"),
      ...within(main).queryAllByRole("button"),
    ];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveTextContent("Protect my email");
  });
});

describe("kid feed", () => {
  it("shows this week's numbers", () => {
    render(<KidFeed />);
    expect(screen.getByText(`${mockRecap.checked} checked`)).toBeInTheDocument();
    expect(screen.getByText(`${mockRecap.held} held`)).toBeInTheDocument();
  });
});

describe("kid My Accounts", () => {
  it("lists every account", () => {
    render(<KidAccounts />);
    for (const a of mockAccounts) {
      expect(screen.getByText(a.orgName)).toBeInTheDocument();
    }
  });

  it("links only to the verified login page, and shows no link when there isn't one", () => {
    render(<KidAccounts />);
    for (const a of mockAccounts) {
      const row = screen.getByText(a.orgName).closest("li")!;
      const link = within(row).queryByRole("link");
      if (a.loginUrl) {
        expect(link).toHaveAttribute("href", a.loginUrl);
      } else {
        expect(link).toBeNull();
      }
    }
  });
});
