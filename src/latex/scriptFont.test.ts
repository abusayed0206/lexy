import { describe, expect, it } from "vitest";
import { addPurnoSetup, BANGLA_BLOCK_END, BANGLA_BLOCK_START, hasOutdatedPurnoSetup, PURNO_SETUP } from "./scriptFont";
import { XELATEX_MARKER } from "./settings";

describe("addPurnoSetup", () => {
  it("adds the marker on line 1 and the block after \\documentclass, keeping line endings", () => {
    const doc = "\\documentclass{article}\r\n\\title{Untitled}\r\n\\begin{document}\r\nবাংলা\r\n\\end{document}\r\n";
    const out = addPurnoSetup(doc)!;
    expect(out.split("\r\n").slice(0, 6)).toEqual([XELATEX_MARKER, "\\documentclass{article}", BANGLA_BLOCK_START, ...PURNO_SETUP, BANGLA_BLOCK_END]);
    expect(out).toContain("\\title{Untitled}\r\n\\begin{document}\r\nবাংলা");
    expect(out.endsWith("\\end{document}\r\n")).toBe(true);
  });

  it("keeps an existing engine marker and does nothing twice or without a class line", () => {
    const doc = "% !TEX program = lualatex\n\\documentclass{article}\nx\n";
    const out = addPurnoSetup(doc)!;
    expect(out.startsWith("% !TEX program = lualatex\n\\documentclass{article}\n" + BANGLA_BLOCK_START)).toBe(true);
    expect(addPurnoSetup(out)).toBeNull();
    expect(addPurnoSetup("Just text")).toBeNull();
  });

  it("upgrades an older block (without Script=Bengali) in place", () => {
    const old = `\\documentclass{article}\n${BANGLA_BLOCK_START}\n\\usepackage{fontspec}\n\\setmainfont{BCCPurno}[Path=fonts/]\n${BANGLA_BLOCK_END}\nবাংলা\n`;
    expect(hasOutdatedPurnoSetup(old)).toBe(true);
    const out = addPurnoSetup(old)!;
    expect(out).toBe(`\\documentclass{article}\n${BANGLA_BLOCK_START}\n${PURNO_SETUP.join("\n")}\n${BANGLA_BLOCK_END}\nবাংলা\n`);
    expect(hasOutdatedPurnoSetup(out)).toBe(false);
    expect(PURNO_SETUP[1]).toContain("Script=Bengali");
  });
});
