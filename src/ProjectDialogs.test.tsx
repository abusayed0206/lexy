import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { promptAction, useChoice, useNamePrompt, windowsOrder } from "./ProjectDialogs";

describe("Windows dialog order (batch W)", () => {
  it("puts the primary choice first and the safe one last", () => {
    const order = windowsOrder([
      { label: "Cancel", value: "cancel" },
      { label: "Don't save", value: "discard" },
      { label: "Save all", value: "save", primary: true },
    ]).map((choice) => choice.label);
    expect(order).toEqual(["Save all", "Don't save", "Cancel"]);
  });

  it("names the prompt button with a verb, never OK", () => {
    expect(promptAction("New file")).toBe("Create");
    expect(promptAction("New note")).toBe("Add note");
    expect(promptAction("Save as")).toBe("Save");
    expect(promptAction("Publish to GitHub")).toBe("Publish");
    expect(promptAction("Connect to existing repository")).toBe("Connect");
    expect(promptAction("Your name for commits")).toBe("Save");
  });
});

function ChoiceHost({ destructive }: { destructive: boolean }) {
  const { ask, dialog } = useChoice();
  return (
    <>
      <button type="button" onClick={() => void ask("Delete", "Delete it?", [{ label: "Cancel", value: "cancel" }, { label: "Delete permanently", value: "delete", primary: true, destructive }])}>
        open
      </button>
      {dialog}
    </>
  );
}

describe("useChoice", () => {
  it("renders primary first and focuses it", () => {
    render(<ChoiceHost destructive={false} />);
    act(() => screen.getByRole("button", { name: "open" }).click());
    const buttons = screen.getAllByRole("button").filter((button) => button.closest(".dialog"));
    expect(buttons.map((button) => button.textContent)).toContain("Delete permanently");
    expect(buttons[buttons.length - 1]).toHaveTextContent("Cancel");
    expect(screen.getByRole("button", { name: "Delete permanently" })).toHaveFocus();
  });

  it("starts on the safe choice when the primary one is destructive", () => {
    render(<ChoiceHost destructive />);
    act(() => screen.getByRole("button", { name: "open" }).click());
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});

function PromptHost() {
  const { prompt, dialog } = useNamePrompt();
  return (
    <>
      <button type="button" onClick={() => void prompt("New folder", "Folder name", "x")}>
        open
      </button>
      {dialog}
    </>
  );
}

describe("useNamePrompt", () => {
  it("shows the verb button first and Cancel last", () => {
    render(<PromptHost />);
    act(() => screen.getByRole("button", { name: "open" }).click());
    const buttons = screen.getAllByRole("button").filter((button) => button.closest(".dialog"));
    expect(buttons.slice(-2).map((button) => button.textContent)).toEqual(["Create", "Cancel"]);
  });
});
