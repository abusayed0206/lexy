import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CitationDialog } from "./CitationDialog";
import type { BibEntry } from "../latex/index";

const entries: BibEntry[] = [
  { key: "knuth84", type: "book", title: "The TeXbook", author: "Donald Knuth", year: "1984", file: "refs.bib", line: 1 },
  { key: "lamport94", type: "book", title: "LaTeX", author: "Leslie Lamport", year: "1994", file: "refs.bib", line: 5 },
];

function setup(hasBib = true) {
  const handlers = { onInsert: vi.fn(), onAddByDoi: vi.fn(), onCreateBib: vi.fn(), onClose: vi.fn() };
  render(<CitationDialog entries={entries} hasBib={hasBib} {...handlers} />);
  return handlers;
}

describe("CitationDialog", () => {
  it("searches by author, title, year or key and inserts the picked keys", () => {
    const handlers = setup();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1994" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(handlers.onInsert).toHaveBeenCalledWith(["lamport94", "knuth84"]);
  });

  it("Enter inserts the only match", () => {
    const handlers = setup();
    const search = screen.getByRole("textbox");
    fireEvent.change(search, { target: { value: "knuth" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(handlers.onInsert).toHaveBeenCalledWith(["knuth84"]);
  });

  it("offers to create references.bib and to add by DOI", () => {
    const handlers = setup(false);
    expect(screen.getByText(/No bibliography yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create references.bib" }));
    expect(handlers.onCreateBib).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add by DOI…" }));
    expect(handlers.onAddByDoi).toHaveBeenCalled();
  });
});
