import { describe, expect, it } from "vitest";
import { senderText } from "./senderText";

describe("senderText", () => {
  it("removes invisible characters that reverse how text displays", () => {
    // U+202E flips what follows: this would display as "alerts@chase.com" backwards trickery.
    expect(senderText("alerts@\u202emoc.esahc")).toBe("alerts@moc.esahc");
    expect(senderText("\u2066Chase\u2069 \u200fBank")).toBe("Chase Bank");
  });

  it("collapses spaces and line breaks", () => {
    expect(senderText("  Your\n\n package   is  waiting ")).toBe("Your package is waiting");
  });
});
