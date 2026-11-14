/** Preview zoom: "fit" fills the pane width; a number is a percentage of real size (1 = 100 %). */
export type Zoom = "fit" | number;
export type Anchor = { page: number; fraction: number };

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** CSS pixels per PDF point at 100 %. */
export const PX_PER_PT = 96 / 72;
const EPSILON = 1e-6;

/** CSS pixels per PDF point for a page `pageWidthPt` wide in a pane `paneWidthPx` wide. */
export function cssScale(zoom: Zoom, pageWidthPt: number, paneWidthPx: number): number {
  return zoom === "fit" ? Math.max(200, paneWidthPx) / pageWidthPt : zoom * PX_PER_PT;
}

/** Fit is treated as the percentage it currently shows, so the next step is relative to it. */
function asPercent(zoom: Zoom, fitScale: number): number {
  return zoom === "fit" ? fitScale / PX_PER_PT : zoom;
}

export function zoomIn(zoom: Zoom, fitScale: number): number {
  const current = asPercent(zoom, fitScale);
  return ZOOM_STEPS.find((step) => step > current + EPSILON) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

export function zoomOut(zoom: Zoom, fitScale: number): number {
  const current = asPercent(zoom, fitScale);
  return [...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON) ?? ZOOM_STEPS[0];
}

export function zoomLabel(zoom: Zoom): string {
  return zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)} %`;
}

export function parseZoom(saved: string | null): Zoom {
  const value = Number(saved);
  return saved && saved !== "fit" && ZOOM_STEPS.includes(value) ? value : "fit";
}

/** Which page the top of the view is in, and how far into it (0–1). */
export function captureAnchor(scrollTop: number, tops: number[], heights: number[]): Anchor {
  if (!tops.length) return { page: 0, fraction: 0 };
  let page = 0;
  while (page + 1 < tops.length && tops[page + 1] <= scrollTop) page++;
  const fraction = heights[page] > 0 ? Math.min(1, Math.max(0, (scrollTop - tops[page]) / heights[page])) : 0;
  return { page, fraction };
}

/** The scrollTop that puts the anchor back at the top of the view. */
export function restoreAnchor(anchor: Anchor, tops: number[], heights: number[]): number {
  if (!tops.length) return 0;
  const page = Math.min(anchor.page, tops.length - 1);
  return tops[page] + anchor.fraction * heights[page];
}
