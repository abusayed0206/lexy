import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { Action } from "./actions";

const make = (title: string, shortcut?: string): Action => ({ id: title, title, group: "Insert", shortcut, run: vi.fn() });

describe("CommandPalette", () => {
  it("filters by name, shows shortcuts and runs the chosen action with Enter", async () => {
    vi.useFakeTimers();
    const actions = [make("Equation"), make("Table", "Ctrl+T"), make("Page break")];
    const onClose = vi.fn();
    render(<CommandPalette actions={actions} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Type a command" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "tab" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["TableInsertCtrl+T"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(actions[1].run).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("moves the selection with the arrow keys and closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette actions={[make("A"), make("B")]} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    render(<CommandPalette actions={[make("A")]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    expect(screen.getByText("No matching commands")).toBeInTheDocument();
  });
});
