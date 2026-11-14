import { describe, expect, it } from "vitest";
import { captureAnchor, cssScale, parseZoom, PX_PER_PT, restoreAnchor, zoomIn, zoomLabel, zoomOut } from "./zoom";

describe("zoom", () => {
  it("steps between fixed levels and clamps at 50 % and 300 %", () => {
    expect(zoomIn(1, 0)).toBe(1.25);
    expect(zoomOut(1, 0)).toBe(0.75);
    expect(zoomIn(3, 0)).toBe(3);
    expect(zoomOut(0.5, 0)).toBe(0.5);
  });

  it("steps from fit relative to what fit currently shows", () => {
    const fit = 1.1 * PX_PER_PT; // fit shows 110 %
    expect(zoomIn("fit", fit)).toBe(1.25);
    expect(zoomOut("fit", fit)).toBe(1);
  });

  it("computes the CSS scale, labels and saved values", () => {
    expect(cssScale("fit", 600, 900)).toBe(1.5);
    expect(cssScale(1.5, 600, 900)).toBeCloseTo(2);
    expect([zoomLabel("fit"), zoomLabel(1.25)]).toEqual(["Fit", "125 %"]);
    expect([parseZoom(null), parseZoom("fit"), parseZoom("1.5"), parseZoom("7")]).toEqual(["fit", "fit", 1.5, "fit"]);
  });

  it("keeps page and offset when page heights change", () => {
    const anchor = captureAnchor(1150, [0, 1000, 2000], [990, 990, 990]);
    expect(anchor.page).toBe(1);
    expect(anchor.fraction).toBeCloseTo(150 / 990);
    expect(restoreAnchor(anchor, [0, 2000, 4000], [1980, 1980, 1980])).toBeCloseTo(2300);
    expect(restoreAnchor({ page: 5, fraction: 0 }, [0, 100], [90, 90])).toBe(100);
    expect(captureAnchor(0, [], [])).toEqual({ page: 0, fraction: 0 });
  });
});
