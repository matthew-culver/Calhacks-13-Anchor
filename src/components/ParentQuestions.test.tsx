import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeedEntry } from "@/shared/feedApi";
import { ParentQuestions } from "./ParentQuestions";

const entry = (id: string, kind: FeedEntry["kind"], subject: string, kidAnswer?: FeedEntry["kidAnswer"]) =>
  ({ _id: id, kind, createdAt: Number(id.slice(1)), kidAnswer, verdict: { level: "real", subject, fromDomain: "kp.org" } }) as unknown as FeedEntry;

describe("the parent's questions", () => {
  it("lists only the emails the parent asked about, with where each one stands", () => {
    render(
      <ParentQuestions
        kidName="Lucas"
        entries={[
          entry("q1", "asked", "Your flu shot is ready", { answer: "fine", note: "That one's real, Mom!", answeredAt: 1 }),
          entry("q2", "asked", "Package delivery problem"),
          entry("q3", "held", "Verify your Chase account"), // Anchor's own catch: not her question
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your questions for Lucas" })).toBeInTheDocument();
    expect(screen.getByText("“Package delivery problem”")).toBeInTheDocument();
    expect(screen.getByText("Lucas is looking at it.")).toBeInTheDocument();
    expect(screen.getByText("Lucas says it's fine.")).toBeInTheDocument();
    expect(screen.getByText("“That one's real, Mom!”")).toBeInTheDocument();
    expect(screen.queryByText(/Chase/)).toBeNull();
  });

  it("shows nothing until the parent has asked", () => {
    const { container } = render(<ParentQuestions kidName="Lucas" entries={[entry("q3", "held", "x")]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
