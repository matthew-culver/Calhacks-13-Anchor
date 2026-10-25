// An in-memory stand-in for Convex and Convex Auth in screen tests. Hooks re-render
// when the fake state changes, like live queries do. Use it in a test file with:
//   vi.mock("convex/react", async () => (await import("@/test/fakeBackend")).convexReact);
//   vi.mock("@convex-dev/auth/react", async () => (await import("@/test/fakeBackend")).authReact);

import { getFunctionName, type FunctionReference } from "convex/server";
import { useSyncExternalStore } from "react";
import { vi, type Mock } from "vitest";

type State = {
  isAuthenticated: boolean;
  /** Query results by function name, e.g. "families:getMyFamily". */
  queries: Record<string, unknown>;
};

const fresh = (): State => ({ isAuthenticated: false, queries: {} });
let state = fresh();
const listeners = new Set<() => void>();

export const fakeBackend = {
  get state() {
    return state;
  },
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  setQuery(name: string, value: unknown) {
    fakeBackend.set({ queries: { ...state.queries, [name]: value } });
  },
  /** Mutations by function name, e.g. "families:createFamily". */
  mutations: {} as Record<string, Mock<(args?: unknown) => Promise<unknown>>>,
  signIn: vi.fn(),
  reset() {
    state = fresh();
    fakeBackend.mutations = {};
    fakeBackend.signIn = vi.fn();
  },
};

const useFakeState = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

type Ref = FunctionReference<"query" | "mutation">;

export const convexReact = {
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: useFakeState().isAuthenticated }),
  useQuery: (ref: Ref, args?: unknown) => {
    const { queries } = useFakeState();
    return args === "skip" ? undefined : queries[getFunctionName(ref)];
  },
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      const fn = fakeBackend.mutations[name];
      if (!fn) throw new Error(`No fake for mutation ${name}`);
      return fn(args);
    };
  },
};

export const authReact = {
  useAuthActions: () => ({
    signIn: (...args: unknown[]) => fakeBackend.signIn(...args),
    signOut: vi.fn(),
  }),
};
