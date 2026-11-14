import { describe, expect, it } from "vitest";
import { tokens, wordDiff } from "./wordDiff";

const render = (before: string, after: string) =>
  wordDiff(before, after)
    .map((part) => (part.kind === "same" ? part.text : part.kind === "added" ? `[+${part.text}]` : `[-${part.text}]`))
    .join("");

describe("wordDiff", () => {
  it("marks changed words only", () => {
    expect(render("The quick brown fox.", "The slow brown fox jumps.")).toBe("The [-quick][+slow] brown fox[+ jumps].");
  });

  it("handles inserts, deletes and identical texts", () => {
    expect(render("", "new")).toBe("[+new]");
    expect(render("old", "")).toBe("[-old]");
    expect(render("same text", "same text")).toBe("same text");
    expect(render("a b c", "a c")).toBe("a [-b ]c");
  });

  it("reproduces both texts", () => {
    const before = "\\section{Intro}\nOne two three four.\nFive six.";
    const after = "\\section{Introduction}\nOne three four, five.\nSix.";
    const parts = wordDiff(before, after);
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe(before);
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe(after);
  });

  it("splits words, spaces and punctuation, keeping LaTeX commands whole", () => {
    expect(tokens("a, \\textbf{b}")).toEqual(["a", ",", " ", "\\textbf", "{", "b", "}"]);
  });
});
