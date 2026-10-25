// Demo mode must never surprise a real user: the address always wins, and parent links only
// honor ?demo=1 in their own address.

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDemoMode } from "./demoMode";

const at = (search: string) => window.history.replaceState(null, "", `/${search}`);

afterEach(() => {
  sessionStorage.clear();
  at("");
});

describe("useDemoMode", () => {
  it("turns on with ?demo=1 and remembers it for kid pages in this tab", () => {
    at("?demo=1");
    expect(renderHook(() => useDemoMode()).result.current).toBe(true);
    at("");
    expect(renderHook(() => useDemoMode()).result.current).toBe(true);
  });

  it("does not let a remembered demo reach a parent link", () => {
    sessionStorage.setItem("anchor.demo", "1");
    expect(renderHook(() => useDemoMode({ sticky: false })).result.current).toBe(false);
    at("?demo=1");
    expect(renderHook(() => useDemoMode({ sticky: false })).result.current).toBe(true);
  });

  it("lets ?demo=0 turn off even a demo deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    expect(renderHook(() => useDemoMode()).result.current).toBe(true);
    at("?demo=0");
    expect(renderHook(() => useDemoMode()).result.current).toBe(false);
  });
});
