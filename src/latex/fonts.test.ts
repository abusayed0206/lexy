import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_FONTS,
  fontFromLines,
  fontLabel,
  fontLines,
  isValidFamily,
  sameFont,
  type FontChoice,
} from "./fonts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("fonts", () => {
  it.each(BUILTIN_FONTS.map((font) => [font.id, font.lines] as const))("%s has documented preamble lines", (id, lines) => {
    expect(fontLines({ kind: "builtin", id })).toEqual(lines);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.startsWith("\\"))).toBe(true);
  });

  it("uses fontspec for installed fonts", () => {
    expect(fontLines({ kind: "system", family: "Georgia" })).toEqual(["\\usepackage{fontspec}", "\\setmainfont{Georgia}"]);
  });

  it.each(["Times New Roman", "Segoe UI", "AT&T Sans", "D'Nealian", "Noto Sans-JP", "Font_1.0+"])("accepts %s", (name) => {
    expect(isValidFamily(name)).toBe(true);
  });

  it.each(["", "Evil}\\input{x}", "50%", "C#", "{Braces}", "back\\slash", "Ünïcode", "x".repeat(65)])("rejects %j", (name) => {
    expect(isValidFamily(name)).toBe(false);
    expect(() => fontLines({ kind: "system", family: name })).toThrow();
  });

  it("rejects unknown built-in ids", () => {
    expect(() => fontLines({ kind: "builtin", id: "comic" as never })).toThrow("Unknown font");
  });

  it.each([...BUILTIN_FONTS.map((font): FontChoice => ({ kind: "builtin", id: font.id })), { kind: "system", family: "Calibri" } as FontChoice])(
    "round-trips %j through its lines",
    (font) => {
      expect(fontFromLines(fontLines(font))).toEqual(font);
    },
  );

  it("does not confuse Latin Modern with Helvetica (both use T1 fontenc)", () => {
    expect(fontFromLines(["\\usepackage[T1]{fontenc}"])).toBeNull();
    expect(fontFromLines(fontLines({ kind: "builtin", id: "helvetica" }))).toEqual({ kind: "builtin", id: "helvetica" });
  });

  it("labels and compares fonts", () => {
    expect(fontLabel({ kind: "builtin", id: "palatino" })).toBe("Palatino");
    expect(fontLabel({ kind: "system", family: "Georgia" })).toBe("Georgia");
    expect(sameFont({ kind: "builtin", id: "times" }, { kind: "builtin", id: "times" })).toBe(true);
    expect(sameFont({ kind: "builtin", id: "times" }, { kind: "system", family: "times" })).toBe(false);
  });
});

describe("listSystemFonts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(invoke).mockReset();
  });

  it("asks the backend once and caches the list", async () => {
    vi.mocked(invoke).mockResolvedValue(["Arial", "Georgia"]);
    const { listSystemFonts } = await import("./fonts");
    await expect(listSystemFonts()).resolves.toEqual(["Arial", "Georgia"]);
    await listSystemFonts();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("list_system_fonts");
  });

  it("retries after a failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("boom").mockResolvedValueOnce(["Arial"]);
    const { listSystemFonts } = await import("./fonts");
    await expect(listSystemFonts()).rejects.toBe("boom");
    await expect(listSystemFonts()).resolves.toEqual(["Arial"]);
  });

  it("round-trips a project font from kriti.app with Bengali shaping", async () => {
    const { fontLines, fontFromLines, fontLabel } = await import("./fonts");
    const font = { kind: "project" as const, family: "BCC Purno", regular: "BCC-Purno-Regular.ttf", bold: "BCC-Purno-Bold.ttf", italic: null, boldItalic: "BCC-Purno-Bold-Italic.ttf" };
    const lines = fontLines(font);
    expect(lines).toEqual([
      "% kriti.app font: BCC Purno",
      "\\usepackage{fontspec}",
      "\\setmainfont{BCC-Purno-Regular.ttf}[Path=fonts/, Script=Bengali, BoldFont=BCC-Purno-Bold.ttf, BoldItalicFont=BCC-Purno-Bold-Italic.ttf]",
    ]);
    expect(fontFromLines(lines)).toEqual(font);
    expect(fontLabel(font)).toBe("BCC Purno");
    expect(() => fontLines({ ...font, regular: "bad}name.ttf" })).toThrow();
    expect(() => fontLines({ kind: "kriti", family: "Kalpurush" })).toThrow();
  });
});
