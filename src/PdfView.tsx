import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfSpot } from "./compile";
import { captureAnchor, cssScale, parseZoom, restoreAnchor, zoomIn, zoomOut, type Zoom } from "./pdfView/zoom";
import { findMatches, matchRects, nearestMatch, pageText, type PageText, type TextItemLike } from "./pdfView/find";
import { Icon } from "./ribbon/icons";

/** One page's searchable text, kept per loaded document (spec 008 US4). */
type CachedPage = { items: TextItemLike[]; text: PageText; viewport: { convertToViewportRectangle: (rect: number[]) => number[] } };
/** A match in CSS pixels relative to its page wrapper. */
type Hit = { page: number; top: number; boxes: { left: number; top: number; width: number; height: number }[] };

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_KEY = "lexy.pdfZoom";
const SPOT_MS = 1000;

export type PdfViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Scroll a SyncTeX spot into view and mark it briefly. */
  showSpot: (spot: NonNullable<PdfSpot>) => void;
};

type Props = {
  bytes: Uint8Array | null;
  busy: boolean;
  onError?: (message: string) => void;
  /** Double-click on a page, in PDF points from the page's top-left. */
  onDoubleClickPoint?: (page: number, x: number, y: number) => void;
  onZoomChange?: (zoom: Zoom) => void;
  handle?: Ref<PdfViewHandle>;
};

function loadZoom(): Zoom {
  try {
    return parseZoom(localStorage.getItem(ZOOM_KEY));
  } catch {
    return "fit";
  }
}

function saveZoom(zoom: Zoom) {
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // Storage blocked: the zoom just isn't remembered.
  }
}

/**
 * Renders every page offscreen, then swaps the finished pages in at the same page and
 * offset, so live refreshes and zoom changes neither flash nor jump (spec 003 US4).
 * shortcut: renders all pages eagerly; fine for ~50 pages, switch to lazy
 * IntersectionObserver rendering when long documents matter.
 */
export function PdfView({ bytes, busy, onError, onDoubleClickPoint, onZoomChange, handle }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesHost = useRef<HTMLDivElement>(null);
  const current = useRef<PDFDocumentProxy | null>(null);
  const fitScale = useRef(1);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [hasPages, setHasPages] = useState(false);
  const [zoom, setZoomState] = useState<Zoom>(loadZoom);
  // Find in PDF (spec 008 US4).
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [currentHit, setCurrentHit] = useState(0);
  /** Bumped whenever new pages are swapped in, so an open search runs again. */
  const [pagesVersion, setPagesVersion] = useState(0);
  const textCache = useRef(new Map<number, CachedPage>());
  const findInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  function setZoom(next: Zoom) {
    setZoomState(next);
    saveZoom(next);
    onZoomChange?.(next);
  }
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;

  useEffect(() => onZoomChange?.(zoom), []);

  function pageGeometry() {
    const pages = [...(pagesHost.current?.children ?? [])] as HTMLElement[];
    return { tops: pages.map((page) => page.offsetTop), heights: pages.map((page) => page.offsetHeight), pages };
  }

  useImperativeHandle(handle, () => ({
    zoomIn: () => setZoomRef.current(zoomIn(zoomRef.current, fitScale.current)),
    zoomOut: () => setZoomRef.current(zoomOut(zoomRef.current, fitScale.current)),
    fit: () => setZoomRef.current("fit"),
    showSpot: (spot) => {
      const wrapper = pagesHost.current?.children[spot.page - 1] as HTMLElement | undefined;
      const box = scroller.current;
      if (!wrapper || !box) return;
      const scale = Number(wrapper.dataset.scale) || 1;
      const mark = document.createElement("div");
      mark.className = "pdf-spot";
      Object.assign(mark.style, {
        left: `${spot.x * scale - 4}px`,
        top: `${spot.y * scale - 2}px`,
        width: `${Math.max(spot.width * scale, 40) + 8}px`,
        height: `${Math.max(spot.height * scale, 12) + 4}px`,
      });
      wrapper.append(mark);
      box.scrollTop = wrapper.offsetTop + spot.y * scale - box.clientHeight / 2;
      setTimeout(() => mark.remove(), SPOT_MS);
    },
  }));

  useEffect(() => {
    if (!bytes) {
      pagesHost.current?.replaceChildren();
      setHasPages(false);
      void current.current?.destroy();
      current.current = null;
      return;
    }
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    (async () => {
      // pdf.js takes ownership of the buffer it is given; hand it a copy.
      loaded = await getDocument({ data: bytes.slice() }).promise;
      const paneWidth = (scroller.current?.clientWidth ?? 600) - 32;
      const ratio = window.devicePixelRatio || 1;
      const pages: HTMLElement[] = [];
      for (let number = 1; number <= loaded.numPages; number++) {
        const page = await loaded.getPage(number);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        if (number === 1) fitScale.current = cssScale("fit", base.width, paneWidth);
        const scale = cssScale(zoom, base.width, paneWidth);
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(base.width * scale)}px`;
        canvas.style.height = `${Math.floor(base.height * scale)}px`;
        canvas.setAttribute("aria-label", `Page ${number}`);
        canvas.setAttribute("role", "img");
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        if (cancelled) return;
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.dataset.page = String(number);
        wrapper.dataset.scale = String(scale);
        wrapper.append(canvas);
        pages.push(wrapper);
      }
      if (cancelled) return;

      const box = scroller.current;
      const before = pageGeometry();
      const anchor = box ? captureAnchor(box.scrollTop, before.tops, before.heights) : null;
      // Without layout (no page heights yet), fall back to the relative scroll position.
      const position = box && box.scrollHeight > 0 ? box.scrollTop / box.scrollHeight : 0;
      pagesHost.current?.replaceChildren(...pages);
      if (box && anchor) {
        const after = pageGeometry();
        const measured = after.heights.some((height) => height > 0) && before.heights.some((height) => height > 0);
        box.scrollTop = measured ? restoreAnchor(anchor, after.tops, after.heights) : position * box.scrollHeight;
      }
      setHasPages(true);

      void current.current?.destroy();
      current.current = loaded;
      loaded = null;
      textCache.current = new Map();
      setPagesVersion((version) => version + 1);
    })().catch((error) => {
      if (!cancelled) onErrorRef.current?.(`The PDF could not be shown. ${error}`);
    });

    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [bytes, zoom]);

  useEffect(() => () => void current.current?.destroy(), []);

  async function pageTextOf(doc: PDFDocumentProxy, number: number): Promise<CachedPage> {
    const cached = textCache.current.get(number);
    if (cached) return cached;
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is TextItemLike & typeof item => "str" in item) as TextItemLike[];
    const entry = { items, text: pageText(items), viewport: page.getViewport({ scale: 1 }) };
    textCache.current.set(number, entry);
    return entry;
  }

  /** Search every page; `near` keeps the current match close to where it was (after a recompile). */
  async function runSearch(text: string, near?: { page: number; top: number }) {
    const seq = ++searchSeq.current;
    const doc = current.current;
    if (!doc || !text.trim()) {
      setHits([]);
      setCurrentHit(0);
      return;
    }
    const pages: CachedPage[] = [];
    for (let number = 1; number <= doc.numPages; number++) pages.push(await pageTextOf(doc, number));
    if (seq !== searchSeq.current) return;
    const wrappers = [...(pagesHost.current?.children ?? [])] as HTMLElement[];
    const found: Hit[] = findMatches(
      pages.map((page) => page.text),
      text,
    ).map((match) => {
      const page = pages[match.page];
      const scale = Number(wrappers[match.page]?.dataset.scale) || 1;
      const boxes = matchRects(match, page.items, page.text).map((rect) => {
        const [x1, y1, x2, y2] = page.viewport.convertToViewportRectangle([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
        return { left: Math.min(x1, x2) * scale, top: Math.min(y1, y2) * scale, width: Math.abs(x2 - x1) * scale, height: Math.abs(y2 - y1) * scale };
      });
      return { page: match.page, top: Math.min(Infinity, ...boxes.map((box) => box.top)), boxes };
    });
    setHits(found);
    const from = near ?? { page: visiblePage(), top: 0 };
    const index = found.length ? nearestMatch(found, from.page, from.top) : 0;
    setCurrentHit(index);
    if (found.length) scrollToHit(found[index]);
  }

  /** Index of the first page whose bottom is below the top of the view. */
  function visiblePage(): number {
    const box = scroller.current;
    const { tops, heights } = pageGeometry();
    if (!box) return 0;
    const index = tops.findIndex((top, i) => top + heights[i] > box.scrollTop);
    return index < 0 ? 0 : index;
  }

  function scrollToHit(hit: Hit) {
    const box = scroller.current;
    const wrapper = pagesHost.current?.children[hit.page] as HTMLElement | undefined;
    if (!box || !wrapper || !Number.isFinite(hit.top)) return;
    const y = wrapper.offsetTop + hit.top;
    if (y < box.scrollTop || y > box.scrollTop + box.clientHeight - 40) box.scrollTop = y - box.clientHeight / 2;
  }

  function step(delta: number) {
    if (!hits.length) return;
    const index = (currentHit + delta + hits.length) % hits.length;
    setCurrentHit(index);
    scrollToHit(hits[index]);
  }

  function closeFind() {
    searchSeq.current++;
    setFindOpen(false);
    setHits([]);
    scroller.current?.focus();
  }

  // Draw the highlight boxes into the page wrappers.
  useEffect(() => {
    const host = pagesHost.current;
    if (!host) return;
    host.querySelectorAll(".pdf-find-match").forEach((node) => node.remove());
    hits.forEach((hit, index) => {
      const wrapper = host.children[hit.page] as HTMLElement | undefined;
      if (!wrapper) return;
      for (const box of hit.boxes) {
        const mark = document.createElement("div");
        mark.className = index === currentHit ? "pdf-find-match pdf-find-current" : "pdf-find-match";
        Object.assign(mark.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        wrapper.append(mark);
      }
    });
  }, [hits, currentHit, pagesVersion]);

  // Run the search again on a new PDF, keeping the current match near where it was.
  useEffect(() => {
    if (!findOpen || !query.trim()) return;
    const last = hits[currentHit];
    void runSearch(query, last ? { page: last.page, top: last.top } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesVersion]);

  // Ctrl+wheel zooms; the listener must be non-passive to stop the page zoom.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const next = event.deltaY < 0 ? zoomIn(zoomRef.current, fitScale.current) : zoomOut(zoomRef.current, fitScale.current);
      setZoomRef.current(next);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="pdf-scroller"
      ref={scroller}
      role="document"
      aria-label="PDF pages"
      aria-busy={busy}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!event.ctrlKey || event.altKey) return;
        if (event.key.toLowerCase() === "f" && !event.shiftKey) {
          if (!hasPages) return;
          event.preventDefault();
          setFindOpen(true);
          requestAnimationFrame(() => findInput.current?.select());
          findInput.current?.focus();
          return;
        }
        const next = { "=": "in", "+": "in", "-": "out", "0": "fit" }[event.key];
        if (!next) return;
        event.preventDefault();
        setZoom(next === "fit" ? "fit" : next === "in" ? zoomIn(zoom, fitScale.current) : zoomOut(zoom, fitScale.current));
      }}
      onDoubleClick={(event) => {
        const wrapper = (event.target as HTMLElement).closest?.(".pdf-page") as HTMLElement | null;
        if (!wrapper || !onDoubleClickPoint) return;
        const rect = wrapper.getBoundingClientRect();
        const scale = Number(wrapper.dataset.scale) || 1;
        onDoubleClickPoint(Number(wrapper.dataset.page), (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
      }}
    >
      {findOpen ? (
        <div className="pdf-find-host">
          <div className="pdf-find" role="search" aria-label="Find in PDF">
            <input
              ref={findInput}
              type="search"
              aria-label="Find in PDF"
              placeholder="Find in PDF"
              value={query}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                void runSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  step(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="pdf-find-count" aria-live="polite">
              {query.trim() ? (hits.length ? `${currentHit + 1} of ${hits.length}` : "No results") : ""}
            </span>
            <button type="button" className="icon-button" aria-label="Previous match (Shift+Enter)" title="Previous match (Shift+Enter)" disabled={!hits.length} onClick={() => step(-1)}>
              <Icon name="up" size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Next match (Enter)" title="Next match (Enter)" disabled={!hits.length} onClick={() => step(1)}>
              <Icon name="down" size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Close (Esc)" title="Close (Esc)" onClick={closeFind}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      ) : null}
      <div className="pdf-pages" ref={pagesHost} />
      {!hasPages ? <p className="preview-empty">{busy ? "Compiling" : "No PDF yet"}</p> : null}
    </div>
  );
}
