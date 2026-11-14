import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Outline } from "./Outline";
import type { OutlineEntry } from "./latex/index";

const entries: OutlineEntry[] = [
  { kind: "section", title: "Intro", file: "main.tex", line: 4, depth: 2 },
  { kind: "figure", title: "A plot", file: "ch.tex", line: 9, depth: 3 },
  { kind: "subsection", title: "Details", file: "ch.tex", line: 12, depth: 3 },
];

describe("Outline", () => {
  it("lists headings and floats with their level", () => {
    render(<Outline entries={entries} hasMain onJump={vi.fn()} />);
    const rows = screen.getAllByRole("treeitem");
    expect(rows.map((row) => row.textContent)).toEqual(["Intro", "FigureA plot", "Details"]);
    expect(rows[0]).toHaveAttribute("aria-level", "3");
  });

  it("jumps on click and on Enter, and moves with the arrow keys", () => {
    const onJump = vi.fn();
    render(<Outline entries={entries} hasMain onJump={onJump} />);
    fireEvent.click(screen.getByText("A plot"));
    expect(onJump).toHaveBeenCalledWith("ch.tex", 9);
    const first = screen.getAllByRole("treeitem")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onJump).toHaveBeenLastCalledWith("ch.tex", 9);
  });

  it("explains an empty outline", () => {
    const { rerender } = render(<Outline entries={[]} hasMain onJump={vi.fn()} />);
    expect(screen.getByText("No headings yet")).toBeInTheDocument();
    rerender(<Outline entries={[]} hasMain={false} onJump={vi.fn()} />);
    expect(screen.getByText("Choose a main document to see its outline")).toBeInTheDocument();
  });
});
