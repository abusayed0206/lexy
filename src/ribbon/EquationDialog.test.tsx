import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EquationDialog from "./EquationDialog";

// Run requestAnimationFrame callbacks right away so placeholder selection is observable.
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

function setup(props: Partial<Parameters<typeof EquationDialog>[0]> = {}) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<EquationDialog onInsert={onInsert} onClose={onClose} {...props} />);
  const field = screen.getByLabelText("LaTeX math") as HTMLTextAreaElement;
  return { onInsert, onClose, user, field };
}

const preview = () => screen.getByRole("region", { name: "Equation preview" });

describe("EquationDialog", () => {
  it("is a labelled modal with focus in the math field and Insert disabled when empty", () => {
    const { field } = setup();
    expect(screen.getByRole("dialog", { name: "Equation" })).toHaveAttribute("aria-modal", "true");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    expect(preview()).toHaveTextContent("Preview appears here");
  });

  it("has named palette buttons in the required groups", () => {
    setup();
    for (const group of ["Structures", "Greek", "Relations", "Operators", "Arrows"]) {
      expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
    }
    for (const name of ["Fraction", "Square root", "Integral", "Matrix 3x3", "alpha", "Omega", "Not equal", "Infinity", "Implies"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("renders typed math with KaTeX", async () => {
    const { user, field } = setup();
    await user.type(field, "a^2");
    expect(preview().querySelector(".katex")).not.toBeNull();
  });

  it("shows a readable message for math it can't preview, but still allows Insert", async () => {
    const { user, field } = setup();
    await user.type(field, "\\frac{{");
    expect(preview()).toHaveTextContent("Can't preview");
    expect(screen.getByRole("button", { name: "Insert" })).toBeEnabled();
  });

  it("palette inserts a snippet with the first placeholder selected; Tab jumps to the next", async () => {
    const { user, field } = setup();
    await user.click(screen.getByRole("button", { name: "Fraction" }));
    expect(field.value).toBe("\\frac{□}{□}");
    expect([field.selectionStart, field.selectionEnd]).toEqual([6, 7]);
    await user.keyboard("a");
    expect(field.value).toBe("\\frac{a}{□}");
    await user.keyboard("{Tab}");
    expect([field.selectionStart, field.selectionEnd]).toEqual([9, 10]);
    await user.keyboard("b");
    expect(field.value).toBe("\\frac{a}{b}");
    expect(preview().querySelector(".katex")).not.toBeNull();
  });

  it("inserts at the cursor inside existing text", async () => {
    const { user, field } = setup({ initialTex: "x + " });
    field.setSelectionRange(4, 4);
    await user.click(screen.getByRole("button", { name: "alpha" }));
    expect(field.value).toBe("x + \\alpha");
  });

  it("previews placeholders as boxes", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Square root" }));
    expect(preview().querySelector(".katex")).not.toBeNull();
    expect(preview()).not.toHaveTextContent("Can't preview");
  });

  it("defaults to Display and inserts with the chosen mode", async () => {
    const { user, field, onInsert } = setup();
    expect(screen.getByLabelText(/Display/)).toBeChecked();
    await user.type(field, "E=mc^2");
    await user.click(screen.getByLabelText(/Inline/));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith({ tex: "E=mc^2", mode: "inline" });
  });

  it("Ctrl+Enter inserts", async () => {
    const { user, field, onInsert } = setup();
    await user.type(field, "x");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onInsert).toHaveBeenCalledWith({ tex: "x", mode: "display" });
  });

  it("opens prefilled when editing an existing equation", () => {
    const { field } = setup({ initialTex: "a+b", initialMode: "inline", editing: true });
    expect(screen.getByRole("dialog", { name: "Edit equation" })).toBeInTheDocument();
    expect(field).toHaveValue("a+b");
    expect(screen.getByLabelText(/Inline/)).toBeChecked();
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("Escape and Cancel close without inserting", async () => {
    const { user, onClose, onInsert } = setup();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("keeps focus inside the dialog", async () => {
    const { user } = setup({ initialTex: "x" });
    act(() => screen.getByRole("button", { name: "Insert" }).focus());
    await user.tab();
    expect(screen.getByRole("button", { name: "Fraction" })).toHaveFocus();
  });
});
