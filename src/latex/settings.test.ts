import { describe, expect, it } from "vitest";
import { BUILTIN_FONTS, type FontChoice } from "./fonts";
import {
  applySettings,
  BLOCK_END,
  BLOCK_START,
  conflicts,
  DEFAULT_SETTINGS,
  geometryLine,
  hasSettingsBlock,
  MARGIN_PRESETS,
  marginPresetOf,
  parseSettings,
  XELATEX_MARKER,
  replacesPdflatexLine,
  type DocumentSettings,
} from "./settings";

const DOC = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHello\n\\end{document}\n";

const with_ = (overrides: Partial<DocumentSettings>): DocumentSettings => ({ ...DEFAULT_SETTINGS, ...overrides });

describe("parseSettings", () => {
  it("returns defaults for a document Lexy never touched", () => {
    expect(parseSettings(DOC)).toEqual(DEFAULT_SETTINGS);
    expect(hasSettingsBlock(DOC)).toBe(false);
  });

  it("reads the size option from \\documentclass even without a block", () => {
    expect(parseSettings("\\documentclass[twocolumn,12pt]{report}").size).toBe(12);
    expect(parseSettings("\\documentclass[a4paper]{article}").size).toBe(10);
  });

  it("ignores a commented-out documentclass", () => {
    expect(parseSettings("% \\documentclass[12pt]{article}\n\\documentclass[11pt]{article}").size).toBe(11);
  });

  it("never throws on garbage", () => {
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(`${BLOCK_START}\n\\usepackage[top=abc]{geometry}\n${BLOCK_END}`)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("applySettings — golden examples (contracts/settings-block.md)", () => {
  it("adds the block after \\documentclass: Times + Narrow + A4", () => {
    const out = applySettings(DOC, with_({ font: { kind: "builtin", id: "times" }, margins: MARGIN_PRESETS.narrow }))!;
    expect(out).toBe(
      [
        "\\documentclass[10pt]{article}",
        BLOCK_START,
        "\\usepackage[a4paper,portrait,top=1.27cm,bottom=1.27cm,left=1.27cm,right=1.27cm]{geometry}",
        "\\usepackage{newtxtext,newtxmath}",
        BLOCK_END,
        "\\usepackage{amsmath}",
        "\\begin{document}",
        "Hello",
        "\\end{document}",
        "",
      ].join("\n"),
    );
  });

  it("adds the XeLaTeX marker for a system font and removes it again", () => {
    const georgia = applySettings(DOC, with_({ font: { kind: "system", family: "Georgia" } }))!;
    expect(georgia.split("\n")[0]).toBe(XELATEX_MARKER);
    expect(georgia).toContain("\\usepackage{fontspec}\n\\setmainfont{Georgia}");

    const back = applySettings(georgia, DEFAULT_SETTINGS)!;
    expect(back.startsWith("\\documentclass")).toBe(true);
    expect(back).not.toContain("fontspec");
    expect(back).not.toContain(XELATEX_MARKER);
  });

  it("leaves engine lines chosen in the Engine menu alone (spec 008)", () => {
    const lua = `% !TEX TS-program = lualatex\n${DOC}`;
    const georgia = applySettings(lua, with_({ font: { kind: "system", family: "Georgia" } }))!;
    expect(georgia.split("\n")[0]).toBe("% !TEX TS-program = lualatex");
    expect(georgia).not.toContain(XELATEX_MARKER);
    expect(applySettings(georgia, DEFAULT_SETTINGS)!.split("\n")[0]).toBe("% !TEX TS-program = lualatex");
  });

  it("replaces an explicit pdfLaTeX line when the font needs XeLaTeX, and says so", () => {
    const pdf = `% !TEX TS-program = pdflatex\n${DOC}`;
    const georgia = with_({ font: { kind: "system", family: "Georgia" } });
    expect(replacesPdflatexLine(pdf, georgia)).toBe(true);
    expect(replacesPdflatexLine(DOC, georgia)).toBe(false);
    const out = applySettings(pdf, georgia)!;
    expect(out.split("\n")[0]).toBe(XELATEX_MARKER);
    expect(out.match(/!TEX/g)).toHaveLength(1);
  });

  it("removes Lexy's marker even when it is not on line 1", () => {
    const text = `% my note\n${XELATEX_MARKER}\n${DOC}`;
    const out = applySettings(applySettings(text, with_({ font: { kind: "system", family: "Georgia" } }))!, DEFAULT_SETTINGS)!;
    expect(out).not.toContain(XELATEX_MARKER);
    expect(out.startsWith("% my note\n")).toBe(true);
  });

  it("keeps other class options and replaces only the size", () => {
    const out = applySettings("\\documentclass[twocolumn,12pt]{report}\n", with_({ size: 11 }))!;
    expect(out.split("\n")[0]).toBe("\\documentclass[twocolumn,11pt]{report}");
  });

  it("rewrites an existing block in place, wherever it is", () => {
    const first = applySettings(DOC, DEFAULT_SETTINGS)!;
    const moved = first.replace(`${BLOCK_START}`, `% my note\n${BLOCK_START}`);
    const out = applySettings(moved, with_({ paper: "letter" }))!;
    expect(out).toContain(`% my note\n${BLOCK_START}\n\\usepackage[letterpaper`);
    expect(out.match(/Lexy settings \(/g)).toHaveLength(1);
  });

  it("drops unknown lines inside Lexy's block", () => {
    const first = applySettings(DOC, DEFAULT_SETTINGS)!.replace(BLOCK_END, `\\usepackage{junk}\n${BLOCK_END}`);
    expect(applySettings(first, DEFAULT_SETTINGS)).not.toContain("junk");
  });

  it("writes a fresh block when one marker was deleted", () => {
    const orphan = applySettings(DOC, DEFAULT_SETTINGS)!.replace(`${BLOCK_END}\n`, "");
    const out = applySettings(orphan, DEFAULT_SETTINGS)!;
    expect(parseSettings(out)).toEqual(DEFAULT_SETTINGS);
    expect(hasSettingsBlock(out)).toBe(true);
  });

  it("leaves every non-Lexy line untouched", () => {
    const out = applySettings(DOC, with_({ font: { kind: "builtin", id: "palatino" }, size: 12 }))!;
    const userLines = DOC.split("\n").slice(1);
    for (const line of userLines) expect(out.split("\n")).toContain(line);
  });

  it("preserves CRLF line endings", () => {
    const out = applySettings(DOC.replace(/\n/g, "\r\n"), DEFAULT_SETTINGS)!;
    expect(out.includes("\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("returns null when there is no \\documentclass", () => {
    expect(applySettings("just text", DEFAULT_SETTINGS)).toBeNull();
  });

  it.each([0.2, 6.5, Number.NaN, -1])("refuses margin %s", (bad) => {
    expect(() => applySettings(DOC, with_({ margins: { ...MARGIN_PRESETS.normal, left: bad } }))).toThrow("margin");
  });

  it("refuses unsafe system font names", () => {
    expect(() => applySettings(DOC, with_({ font: { kind: "system", family: "x}\\input{evil" } }))).toThrow();
  });

  it("formats centimetres without float noise", () => {
    expect(geometryLine(with_({ margins: { top: 1.1, bottom: 2, left: 0.5, right: 5.999 } }))).toContain(
      "top=1.1cm,bottom=2cm,left=0.5cm,right=6cm",
    );
  });
});

describe("applySettings — round trip over every combination (SC-005)", () => {
  const fonts: FontChoice[] = [...BUILTIN_FONTS.map((f): FontChoice => ({ kind: "builtin", id: f.id })), { kind: "system", family: "Georgia" }];
  const cases: DocumentSettings[] = [];
  for (const font of fonts)
    for (const margins of Object.values(MARGIN_PRESETS))
      for (const paper of ["a4", "letter"] as const)
        for (const orientation of ["portrait", "landscape"] as const)
          for (const size of [10, 11, 12] as const) cases.push({ font, margins, paper, orientation, size });

  it(`covers ${cases.length} combinations`, () => {
    for (const settings of cases) {
      const once = applySettings(DOC, settings)!;
      expect(parseSettings(once)).toEqual(settings);
      expect(applySettings(once, settings)).toBe(once);
      expect(once).toContain("\\begin{document}\nHello\n\\end{document}");
      expect(once.split("\n").filter((line) => line.startsWith("\\documentclass"))).toHaveLength(1);
    }
  });
});

describe("marginPresetOf", () => {
  it("recognises Word presets and custom values", () => {
    expect(marginPresetOf(MARGIN_PRESETS.moderate)).toBe("moderate");
    expect(marginPresetOf({ top: 2.54, bottom: 2.54, left: 2.54, right: 3 })).toBeNull();
  });
});

describe("conflicts", () => {
  it("finds the user's own geometry and font packages outside Lexy's block", () => {
    const doc = "\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{mathptmx}\n% \\usepackage{lmodern}\n\\usepackage{amsmath}\n\\begin{document}\n\\usepackage{geometry}\n\\end{document}";
    expect(conflicts(doc)).toEqual(["\\usepackage[margin=1in]{geometry}", "\\usepackage{mathptmx}"]);
  });

  it("ignores Lexy's own block", () => {
    expect(conflicts(applySettings(DOC, with_({ font: { kind: "system", family: "Georgia" } }))!)).toEqual([]);
  });
});

describe("applySettings with LaTeXbangla (spec 005, FR-009)", () => {
  const BANGLA = "\\documentclass{article}\n\\usepackage{latexbangla}\n\\setbanglamainfont{Kalpurush}\n\\begin{document}\nবাংলা ও English\n\\end{document}\n";

  it("sets only the English font and leaves the Bangla lines untouched", () => {
    const updated = applySettings(BANGLA, with_({ font: { kind: "system", family: "Georgia" } }))!;
    expect(updated).toContain("\\setmainfont{Georgia}");
    expect(updated).toContain("\n\\usepackage{latexbangla}\n\\setbanglamainfont{Kalpurush}\n");
    expect(updated).toContain("বাংলা ও English");
    const back = applySettings(updated, with_({ font: { kind: "builtin", id: "latin-modern" } }))!;
    expect(back).toContain("\\usepackage{latexbangla}\n\\setbanglamainfont{Kalpurush}\n");
  });
});
