import { act, render, screen } from "@testing-library/react";
import { getDocument } from "pdfjs-dist";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfView } from "./PdfView";

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeDocument(pages: number, renders: Deferred[] = []) {
  const destroy = vi.fn(() => Promise.resolve());
  const doc = {
    numPages: pages,
    destroy,
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => {
        const gate = deferred();
        renders.push(gate);
        return { promise: gate.promise };
      },
    })),
  };
  return doc;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

describe("PdfView", () => {
  beforeEach(() => {
    vi.mocked(getDocument).mockReset();
    HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  });

  it("shows placeholders without a PDF", () => {
    const { rerender } = render(<PdfView bytes={null} busy={false} />);
    expect(screen.getByText("No PDF yet")).toBeInTheDocument();
    rerender(<PdfView bytes={null} busy />);
    expect(screen.getByText("Compiling")).toBeInTheDocument();
  });

  it("renders every page into canvases and passes a copy of the bytes", async () => {
    const renders: Deferred[] = [];
    const doc = fakeDocument(2, renders);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as never);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    render(<PdfView bytes={bytes} busy={false} />);
    await settle();
    renders.forEach((gate) => gate.resolve());
    await settle();
    renders.forEach((gate) => gate.resolve());
    await settle();

    expect(screen.getAllByRole("img").map((page) => page.getAttribute("aria-label"))).toEqual(["Page 1", "Page 2"]);
    const passed = vi.mocked(getDocument).mock.calls[0][0] as { data: Uint8Array };
    expect(passed.data).toEqual(bytes);
    expect(passed.data).not.toBe(bytes);
    expect(screen.queryByText("No PDF yet")).not.toBeInTheDocument();
  });

  it("keeps the old pages until all new ones are drawn, then restores the scroll position", async () => {
    const firstRenders: Deferred[] = [];
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(fakeDocument(1, firstRenders)) } as never);
    const { rerender, container } = render(<PdfView bytes={new Uint8Array([1])} busy={false} />);
    await settle();
    firstRenders[0].resolve();
    await settle();
    const oldCanvas = screen.getByRole("img");

    // Height follows the number of pages shown, like a real layout.
    const scroller = container.querySelector<HTMLElement>(".pdf-scroller")!;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scroller.querySelectorAll("canvas").length * 1000,
    });
    scroller.scrollTop = 500;

    const secondRenders: Deferred[] = [];
    const second = fakeDocument(2, secondRenders);
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(second) } as never);
    rerender(<PdfView bytes={new Uint8Array([2])} busy={false} />);
    await settle();
    secondRenders[0].resolve();
    await settle();
    expect(screen.getAllByRole("img")).toEqual([oldCanvas]);

    secondRenders[1].resolve();
    await settle();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(scroller.scrollTop).toBe(1000);
  });

  it("destroys the previous document after swapping", async () => {
    const renders: Deferred[] = [];
    const first = fakeDocument(1, renders);
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(first) } as never);
    const { rerender } = render(<PdfView bytes={new Uint8Array([1])} busy={false} />);
    await settle();
    renders[0].resolve();
    await settle();

    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(fakeDocument(1, renders)) } as never);
    rerender(<PdfView bytes={new Uint8Array([2])} busy={false} />);
    await settle();
    renders[1].resolve();
    await settle();
    expect(first.destroy).toHaveBeenCalled();
  });

  it("reports a broken PDF and keeps the old pages", async () => {
    const renders: Deferred[] = [];
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(fakeDocument(1, renders)) } as never);
    const onError = vi.fn();
    const { rerender } = render(<PdfView bytes={new Uint8Array([1])} busy={false} onError={onError} />);
    await settle();
    renders[0].resolve();
    await settle();

    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.reject(new Error("Invalid PDF structure")) } as never);
    rerender(<PdfView bytes={new Uint8Array([9])} busy={false} onError={onError} />);
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Invalid PDF structure"));
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("clears the pages when the PDF goes away (new document)", async () => {
    const renders: Deferred[] = [];
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(fakeDocument(1, renders)) } as never);
    const { rerender } = render(<PdfView bytes={new Uint8Array([1])} busy={false} />);
    await settle();
    renders[0].resolve();
    await settle();
    rerender(<PdfView bytes={null} busy={false} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No PDF yet")).toBeInTheDocument();
  });
});

describe("Find in PDF (spec 008 US4)", () => {
  beforeEach(() => {
    vi.mocked(getDocument).mockReset();
    HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  });

  const text = (str: string, x: number, y: number, hasEOL = false) => ({ str, width: str.length * 6, height: 10, transform: [10, 0, 0, 10, x, y], hasEOL });

  function textDocument(pages: string[][]) {
    return {
      numPages: pages.length,
      destroy: vi.fn(() => Promise.resolve()),
      getPage: vi.fn(async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
          convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1, 800 - y1, x2, 800 - y2],
        }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: pages[number - 1].map((line, index) => text(line, 72, 700 - index * 20, true)) }),
      })),
    };
  }

  async function showPdf(pages: string[][]) {
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(textDocument(pages)) } as never);
    const utils = render(<PdfView bytes={new Uint8Array([1])} busy={false} />);
    await settle();
    await settle();
    return utils;
  }

  const scroller = () => screen.getByRole("document", { name: "PDF pages" });
  const field = () => screen.getByRole("searchbox", { name: "Find in PDF" });
  const typeQuery = async (value: string) => {
    await act(async () => {
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.change(field(), { target: { value } });
    });
    await settle();
  };
  const key = async (target: Element, init: KeyboardEventInit) => {
    const { fireEvent } = await import("@testing-library/react");
    await act(async () => void fireEvent.keyDown(target, init));
    await settle();
  };

  it("Ctrl+F opens the bar; typing highlights every match and counts them", async () => {
    const { container } = await showPdf([["Lexy writes LaTeX.", "Lexy compiles."], ["Again Lexy."]]);
    await key(scroller(), { key: "f", ctrlKey: true });
    await typeQuery("lexy");
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(container.querySelectorAll(".pdf-find-match")).toHaveLength(3);
    expect(container.querySelectorAll(".pdf-find-current")).toHaveLength(1);
  });

  it("Enter and Shift+Enter step through matches and wrap", async () => {
    await showPdf([["one two one"], ["one"]]);
    await key(scroller(), { key: "f", ctrlKey: true });
    await typeQuery("one");
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    await key(field(), { key: "Enter" });
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await key(field(), { key: "Enter", shiftKey: true });
    await key(field(), { key: "Enter", shiftKey: true });
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });

  it("says No results, and Esc closes the bar and clears the highlights", async () => {
    const { container } = await showPdf([["nothing here", "but text"]]);
    await key(scroller(), { key: "f", ctrlKey: true });
    await typeQuery("absent");
    expect(screen.getByText("No results")).toBeInTheDocument();
    await typeQuery("text");
    expect(container.querySelectorAll(".pdf-find-match")).toHaveLength(1);
    await key(field(), { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Find in PDF" })).toBeNull();
    expect(container.querySelectorAll(".pdf-find-match")).toHaveLength(0);
    expect(scroller()).toHaveFocus();
  });

  it("does nothing without a PDF", async () => {
    render(<PdfView bytes={null} busy={false} />);
    await key(scroller(), { key: "f", ctrlKey: true });
    expect(screen.queryByRole("searchbox", { name: "Find in PDF" })).toBeNull();
  });

  it("runs the search again on a new PDF", async () => {
    const { rerender } = await showPdf([["alpha beta"]]);
    await key(scroller(), { key: "f", ctrlKey: true });
    await typeQuery("beta");
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(textDocument([["beta beta beta"]])) } as never);
    rerender(<PdfView bytes={new Uint8Array([2])} busy={false} />);
    await settle();
    await settle();
    await settle();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });
});
