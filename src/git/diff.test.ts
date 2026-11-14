import { describe, expect, it } from "vitest";
import { formatSize, parseDiff } from "./diff";

describe("parseDiff", () => {
  it("numbers context, removed and added lines across hunks and skips headers", () => {
    const patch = [
      "diff --git a/main.tex b/main.tex",
      "--- a/main.tex",
      "+++ b/main.tex",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "@@ -10,2 +10,3 @@ section",
      " ten",
      "+ten and a half",
      " eleven",
      "\\ No newline at end of file",
    ].join("\n");
    const rows = parseDiff(patch);
    expect(rows.map((r) => [r.kind, r.oldLine, r.newLine, r.text])).toEqual([
      ["hunk", undefined, undefined, "@@ -1,3 +1,3 @@"],
      ["ctx", 1, 1, "one"],
      ["del", 2, undefined, "two"],
      ["add", undefined, 2, "TWO"],
      ["ctx", 3, 3, "three"],
      ["hunk", undefined, undefined, "@@ -10,2 +10,3 @@ section"],
      ["ctx", 10, 10, "ten"],
      ["add", undefined, 11, "ten and a half"],
      ["ctx", 11, 12, "eleven"],
    ]);
  });

  it("handles new and deleted files", () => {
    expect(parseDiff("--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n").map((r) => r.kind)).toEqual(["hunk", "add", "add"]);
    expect(parseDiff("@@ -1 +0,0 @@\n-gone\n").map((r) => [r.kind, r.oldLine])).toEqual([
      ["hunk", undefined],
      ["del", 1],
    ]);
    expect(parseDiff("")).toEqual([]);
  });

  it("formats sizes", () => {
    expect([formatSize(null), formatSize(12), formatSize(12 * 1024), formatSize(3 * 1024 * 1024)]).toEqual(["none", "12 B", "12 KB", "3.0 MB"]);
  });
});
