import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfSpot } from "./compile";
import { captureAnchor, cssScale, parseZoom, restoreAnchor, zoomIn, zoomOut, type Zoom } from "./pdfView/zoom";

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
    })().catch((error) => {
      if (!cancelled) onErrorRef.current?.(`The PDF could not be shown. ${error}`);
    });

    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [bytes, zoom]);

  useEffect(() => () => void current.current?.destroy(), []);

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
      <div className="pdf-pages" ref={pagesHost} />
      {!hasPages ? <p className="preview-empty">{busy ? "Compiling" : "No PDF yet"}</p> : null}
    </div>
  );
}
