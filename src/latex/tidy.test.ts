import { describe, expect, it } from "vitest";
import { tidy } from "./tidy";

describe("tidy", () => {
  it("indents environments by depth, leaving document level flat", () => {
    const input = [
      "\\begin{document}",
      "      \\begin{itemize}",
      "\\item One   ",
      "    \\begin{enumerate}",
      "\\item Two",
      "\\end{enumerate}",
      "   \\end{itemize}",
      "\\end{document}",
    ].join("\n");
    expect(tidy(input)).toBe(
      [
        "\\begin{document}",
        "\\begin{itemize}",
        "  \\item One",
        "  \\begin{enumerate}",
        "    \\item Two",
        "  \\end{enumerate}",
        "\\end{itemize}",
        "\\end{document}",
      ].join("\n"),
    );
  });

  it("does not touch verbatim content", () => {
    const input = "\\begin{center}\n\\begin{verbatim}\n   keep   this   \n\\end{verbatim}\n\\end{center}";
    expect(tidy(input)).toBe("\\begin{center}\n  \\begin{verbatim}\n   keep   this   \n  \\end{verbatim}\n\\end{center}");
  });

  it("handles begin and end on one line, comments and CRLF", () => {
    const input = "\\begin{a}\r\n\\begin{b}x\\end{b}\r\n% \\begin{c}\r\ny\r\n\\end{a}";
    expect(tidy(input)).toBe("\\begin{a}\r\n  \\begin{b}x\\end{b}\r\n  % \\begin{c}\r\n  y\r\n\\end{a}");
  });

  it("never indents below zero on stray ends", () => {
    expect(tidy("\\end{x}\ntext")).toBe("\\end{x}\ntext");
  });
});
