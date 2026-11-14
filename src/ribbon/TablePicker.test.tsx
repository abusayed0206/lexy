import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TABLE } from "../latex/tables";
import { GRID_COLS, GRID_ROWS, TablePicker } from "./TablePicker";

function setup() {
  const onInsert = vi.fn();
  const user = userEvent.setup();
  render(<TablePicker onInsert={onInsert} />);
  return { onInsert, user };
}

describe("TablePicker grid", () => {
  it("is a 10x8 grid with a live size caption", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getAllByRole("gridcell")).toHaveLength(GRID_COLS * GRID_ROWS);
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "3 x 2" }));
    expect(screen.getByText("3 x 2 Table")).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell").filter((c) => c.getAttribute("aria-selected") === "true")).toHaveLength(6);
  });

  it("inserts the hovered size on click", async () => {
    const { user, onInsert } = setup();
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("gridcell", { name: "3 x 2" }));
    expect(onInsert).toHaveBeenCalledWith({ ...DEFAULT_TABLE, cols: 3, rows: 2 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("works with the keyboard and clamps at the edges", async () => {
    const { user, onInsert } = setup();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("grid", { name: "Table size" })).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{ArrowLeft}{ArrowUp}{ArrowUp}");
    expect(screen.getByText("2 x 1 Table")).toBeInTheDocument();
    for (let i = 0; i < 15; i++) await user.keyboard("{ArrowRight}");
    expect(screen.getByText("10 x 1 Table")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onInsert).toHaveBeenCalledWith({ ...DEFAULT_TABLE, cols: 10, rows: 1 });
  });
});

describe("Insert table dialog", () => {
  async function openDialog() {
    const ctx = setup();
    await ctx.user.click(screen.getByRole("button", { name: "Table" }));
    await ctx.user.click(screen.getByRole("menuitem", { name: "Insert table…" }));
    return ctx;
  }

  it("opens with defaults and focus on Columns", async () => {
    await openDialog();
    expect(screen.getByRole("dialog", { name: "Insert table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Columns")).toHaveFocus();
    expect(screen.getByLabelText("Columns")).toHaveValue(2);
    expect(screen.getByLabelText("Header row")).toBeChecked();
    expect(screen.getByLabelText("Borders")).toBeChecked();
  });

  it("inserts the configured table", async () => {
    const { user, onInsert } = await openDialog();
    await user.clear(screen.getByLabelText("Columns"));
    await user.type(screen.getByLabelText("Columns"), "4");
    await user.clear(screen.getByLabelText("Rows"));
    await user.type(screen.getByLabelText("Rows"), "5");
    await user.click(screen.getByLabelText("Borders"));
    await user.selectOptions(screen.getByLabelText("Alignment"), "c");
    await user.type(screen.getByLabelText("Caption (optional)"), " Results ");
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith({ cols: 4, rows: 5, header: true, borders: false, align: "c", caption: "Results" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["Columns", "21", "Columns: 1 to 20"],
    ["Columns", "0", "Columns: 1 to 20"],
    ["Rows", "51", "Rows: 1 to 50"],
    ["Rows", "", "Required"],
  ])("rejects %s = %j", async (field, value, message) => {
    const { user, onInsert } = await openDialog();
    await user.clear(screen.getByLabelText(field));
    if (value) await user.type(screen.getByLabelText(field), value);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(field)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("Escape closes without inserting", async () => {
    const { user, onInsert } = await openDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });
});
