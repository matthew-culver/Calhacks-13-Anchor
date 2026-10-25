// B2: where the parent lands when connecting Gmail didn't work.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectProblemScreen } from "./ConnectProblemScreen";

afterEach(() => sessionStorage.clear());

describe("connect problem page", () => {
  it("uses the kid's name remembered from the invite page", () => {
    sessionStorage.setItem("anchor.kidName", "Lucas");
    render(<ConnectProblemScreen reason="invite_invalid" />);
    expect(screen.getByRole("main")).toHaveTextContent("Ask Lucas for a new one.");
  });

  it("falls back to plain words when there's no name", () => {
    render(<ConnectProblemScreen reason="wrong_account" />);
    expect(screen.getByRole("main")).toHaveTextContent(
      "pick the Gmail address the person who sent you the link set up",
    );
  });

  it("reassures the parent when they pressed Cancel", () => {
    render(<ConnectProblemScreen reason="cancelled" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No problem");
    expect(screen.getByRole("main")).toHaveTextContent("Nothing was changed.");
  });

  it.each([undefined, "", "nonsense", "__proto__", "toString"])(
    "shows the general message for an unknown reason (%s)",
    (reason) => {
      render(<ConnectProblemScreen reason={reason} />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Google had a hiccup");
    },
  );
});
