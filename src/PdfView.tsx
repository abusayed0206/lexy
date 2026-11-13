import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

type Props = {
  bytes: Uint8Array | null;
  busy: boolean;
  onError?: (message: string) => void;
};

/**
 * Renders every page offscreen, then swaps the finished pages in and restores the
 * reader's scroll position, so live refreshes neither flash nor jump (FR-008).
 * shortcut: renders all pages eagerly; fine for ~30 pages, switch to lazy
 * IntersectionObserver rendering when long documents matter.
 */
export function PdfView({ bytes, busy, onError }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesHost = useRef<HTMLDivElement>(null);
  const current = useRef<PDFDocumentProxy | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [hasPages, setHasPages] = useState(false);

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
      const width = Math.max(200, (scroller.current?.clientWidth ?? 600) - 32);
      const ratio = window.devicePixelRatio || 1;
      const pages: HTMLElement[] = [];
      for (let number = 1; number <= loaded.numPages; number++) {
        const page = await loaded.getPage(number);
        if (cancelled) return;
        const scale = width / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.setAttribute("aria-label", `Page ${number}`);
        canvas.setAttribute("role", "img");
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        if (cancelled) return;
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.append(canvas);
        pages.push(wrapper);
      }
      if (cancelled) return;

      const box = scroller.current;
      const position = box && box.scrollHeight > 0 ? box.scrollTop / box.scrollHeight : 0;
      pagesHost.current?.replaceChildren(...pages);
      if (box) box.scrollTop = position * box.scrollHeight;
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
  }, [bytes]);

  useEffect(() => () => void current.current?.destroy(), []);

  return (
    <div className="pdf-scroller" ref={scroller} role="document" aria-label="PDF pages" aria-busy={busy}>
      <div className="pdf-pages" ref={pagesHost} />
      {!hasPages ? <p className="preview-empty">{busy ? "Compiling" : "No PDF yet"}</p> : null}
    </div>
  );
}
