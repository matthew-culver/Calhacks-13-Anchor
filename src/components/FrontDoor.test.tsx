// B8: the parent's front door. Accounts grouped in plain words, most important first, with
// the reason we think Mom uses each one; and the demo replay of a live import.

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAccounts } from "@/shared/mock";
import { SAMPLE_IMPORT_STEPS, sampleImportStep, useSampleImport } from "@/shared/sampleImport";
import { renderHook } from "@testing-library/react";
import { byImportance, groupAccounts, ParentAccountList, usedFor, type AccountView } from "./AccountList";

const names = (list: AccountView[]) => list.map((a) => a.orgName);

describe("grouping and order", () => {
  it("puts the group with Mom's most important account first, and sorts inside each group", () => {
    const groups = groupAccounts(mockAccounts);
    expect(groups.map((g) => g.group)).toEqual(["Money", "Health", "Other", "Bills", "Shopping"]);
    expect(names(groups[0].accounts)).toEqual(["Wells Fargo", "AARP Medicare Supplement"]);
    expect(names(groups[1].accounts)).toEqual(["Kaiser Permanente", "CVS Pharmacy", "Walgreens"]);
  });

  it("ranks by real use, not by how much mail arrives: Amazon sends the most but isn't first", () => {
    const shopping = groupAccounts(mockAccounts).find((g) => g.group === "Shopping")!;
    expect(names(shopping.accounts)).toEqual(["Amazon", "Costco"]);
    expect([...mockAccounts].sort(byImportance)[0].orgName).toBe("Wells Fargo");
  });

  it("falls back to mail volume, then name, before A8 fills in ranks", () => {
    const unranked = mockAccounts.map((a) => ({ ...a, rank: undefined }));
    expect([...unranked].sort(byImportance)[0].orgName).toBe("Amazon");
  });
});

describe("why we think Mom uses it", () => {
  it("names the two most telling kinds of email in plain words", () => {
    expect(usedFor(["sign_in", "bill", "statement"])).toBe("Bills · Statements");
    expect(usedFor(["code", "appointment"])).toBe("Appointments · Sign-in codes");
  });

  it("says nothing until A8 knows", () => {
    expect(usedFor(undefined)).toBeNull();
    expect(usedFor([])).toBeNull();
  });
});

describe("front door list", () => {
  it("shows each group as a heading with its accounts as big sign-in buttons", () => {
    render(<ParentAccountList accounts={mockAccounts} />);
    const money = screen.getByRole("region", { name: "Money" });
    expect(within(money).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Wells Fargo",
      "AARP Medicare Supplement",
    ]);
    expect(within(money).getByRole("link", { name: "Open Wells Fargo" })).toHaveAttribute(
      "href",
      "https://connect.secure.wellsfargo.com/auth/login/present",
    );
    const wells = within(money).getByRole("heading", { name: "Wells Fargo" }).closest("li")!;
    expect(within(wells).getByText("Bills · Statements")).toBeInTheDocument();
  });

  it("still shows no link for a place without a verified sign-in page", () => {
    render(<ParentAccountList accounts={mockAccounts} />);
    const row = screen.getByRole("heading", { name: "Sunrise Senior Center" }).closest("li")!;
    expect(within(row).queryByRole("link")).toBeNull();
  });
});

describe("demo import replay", () => {
  afterEach(() => vi.useRealTimers());

  it("finds the busiest senders first, ranked roughly, then re-sorts by real use at the end", () => {
    const early = sampleImportStep(1);
    expect(names(early)).toEqual(["Amazon", "Wells Fargo", "Kaiser Permanente"]);
    expect([...early].sort(byImportance)[0].orgName).toBe("Amazon");

    const final = sampleImportStep(SAMPLE_IMPORT_STEPS);
    expect(final).toHaveLength(mockAccounts.length);
    expect([...final].sort(byImportance)[0].orgName).toBe("Wells Fargo");
  });

  it("plays once, in steps, and says when it's done", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSampleImport(true));
    expect(result.current).toEqual({ accounts: [], done: false });
    act(() => vi.advanceTimersByTime(1200));
    expect(result.current.accounts).toHaveLength(3);
    act(() => vi.advanceTimersByTime(1200 * (SAMPLE_IMPORT_STEPS + 2)));
    expect(result.current.done).toBe(true);
    expect(result.current.accounts).toHaveLength(mockAccounts.length);
  });
});
