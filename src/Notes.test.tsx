import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Notes } from "./Notes";
import type { Note } from "./latex/notes";

const base = { file: "chapters\\intro.tex", from: 0, to: 4, created: "2026-11-14T10:00:00Z" };
const notes: Note[] = [
  { ...base, id: "a", quote: "data", body: "check this number", state: "open" },
  { ...base, id: "b", quote: "old", body: "done already", state: "resolved" },
  { ...base, id: "c", quote: "gone", body: "about removed text", state: "detached" },
];

function setup(readOnly = false) {
  const handlers = { onJump: vi.fn(), onState: vi.fn(), onDelete: vi.fn() };
  render(<Notes notes={notes} readOnly={readOnly} {...handlers} />);
  return handlers;
}

describe("Notes", () => {
  it("hides resolved notes until asked and marks detached ones", () => {
    setup();
    expect(screen.queryByText("done already")).toBeNull();
    expect(screen.getByText("Text was removed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show resolved (1)" }));
    expect(screen.getByText("done already")).toBeInTheDocument();
  });

  it("jumps, resolves, reopens and deletes", () => {
    const handlers = setup();
    fireEvent.click(screen.getByText("check this number"));
    expect(handlers.onJump).toHaveBeenCalledWith(notes[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    expect(handlers.onState).toHaveBeenCalledWith(notes[0], "resolved");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(handlers.onState).toHaveBeenCalledWith(notes[1], "open");
    fireEvent.click(screen.getByRole("button", { name: "Delete note: check this number" }));
    expect(handlers.onDelete).toHaveBeenCalledWith(notes[0]);
  });

  it("can't jump to removed text or change notes in a read-only window", () => {
    setup(true);
    expect(screen.getByText("Text was removed").closest("button")).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Resolve" })[0]).toBeDisabled();
  });

  it("explains how to add the first note", () => {
    render(<Notes notes={[]} readOnly={false} onJump={vi.fn()} onState={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Select text and press Ctrl\+Alt\+M/)).toBeInTheDocument();
  });
});
