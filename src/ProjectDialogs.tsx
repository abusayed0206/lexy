import { useCallback, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Dialog } from "./ribbon/Dialog";
import { countEntries, INVALID_NAME_MESSAGE, validName } from "./projects";

/** `destructive`: the primary action can't be undone (permanent delete), so focus starts on the safe choice. */
export type Choice<T extends string> = { label: string; value: T; primary?: boolean; destructive?: boolean };

/**
 * Windows dialog order (DESIGN.md "Windows design alignment"): the primary action first (left),
 * then the others, the safe "close" choice last (right). Callers list Cancel first, so the
 * non-primary choices are reversed.
 */
export function windowsOrder<T extends string>(choices: Choice<T>[]): Choice<T>[] {
  return [...choices.filter((choice) => choice.primary), ...choices.filter((choice) => !choice.primary).reverse()];
}
type Pending = { title: string; body: ReactNode; choices: Choice<string>[]; resolve: (value: string | null) => void };

/**
 * Promise-based modal choices (Save all / Don't save / Cancel, Replace / Keep both / Skip…).
 * `ask` resolves with the chosen value, or null on Esc.
 */
export function useChoice() {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback(
    <T extends string>(title: string, body: ReactNode, choices: Choice<T>[]) =>
      new Promise<T | null>((resolve) => {
        setPending({ title, body, choices, resolve: resolve as (value: string | null) => void });
      }),
    [],
  );
  const finish = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };
  const dialog = pending ? (
    <Dialog
      title={pending.title}
      onClose={() => finish(null)}
      actions={windowsOrder(pending.choices).map((choice, index, ordered) => {
        // Focus the primary choice, unless it is destructive: then the safe last one.
        const destructive = ordered.some((item) => item.primary && item.destructive);
        const focus = destructive ? index === ordered.length - 1 : !!choice.primary;
        return (
          <button
            key={choice.value}
            type="button"
            className={choice.primary ? "primary" : undefined}
            data-autofocus={focus ? "" : undefined}
            onClick={() => finish(choice.value)}
          >
            {choice.label}
          </button>
        );
      })}
    >
      {pending.body}
    </Dialog>
  ) : null;
  return { ask, dialog };
}

/** Returns an error message, or null when the value is fine. */
export type Validate = (value: string) => string | null;
type NamePending = { title: string; label: string; initial: string; validate?: Validate; action: string; resolve: (value: string | null) => void };

/** A specific verb for the prompt's button (never "OK" for a question): New… → Create, Save… → Save, … */
export function promptAction(title: string): string {
  const first = title.split(" ")[0];
  return ({ New: title === "New note" ? "Add note" : "Create", Save: "Save", Publish: "Publish", Connect: "Connect", Rename: "Rename" } as Record<string, string>)[first] ?? "Save";
}

/** Promise-based single-name prompt with Windows name validation. */
export function useNamePrompt() {
  const [pending, setPending] = useState<NamePending | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const prompt = useCallback(
    (title: string, label: string, initial: string, validate?: Validate, action = promptAction(title)) =>
      new Promise<string | null>((resolve) => {
        setValue(initial);
        setError(null);
        setPending({ title, label, initial, validate, action, resolve });
      }),
    [],
  );
  const finish = (result: string | null) => {
    pending?.resolve(result);
    setPending(null);
  };
  const submit = () => {
    const name = value.trim();
    if (pending?.validate) {
      const problem = pending.validate(name);
      if (problem) setError(problem);
      else finish(name);
      return;
    }
    // Paths like chapters\intro.tex are allowed in Save as; every part must be a valid name.
    if (!name || !name.split(/[\\/]/).every(validName)) {
      setError(INVALID_NAME_MESSAGE);
      return;
    }
    finish(name.replace(/\//g, "\\"));
  };
  const dialog = pending ? (
    <Dialog
      title={pending.title}
      onClose={() => finish(null)}
      actions={
        <>
          <button type="button" className="primary" onClick={submit}>
            {pending.action}
          </button>
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
        </>
      }
    >
      <label className="field">
        <span>{pending.label}</span>
        <input
          ref={input}
          data-autofocus=""
          value={value}
          aria-invalid={!!error}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  ) : null;
  return { prompt, dialog };
}

export const LARGE_FOLDER = 5000;

/**
 * "Open folder…": pick a folder; folders with more than 5,000 entries need a confirmation
 * (spec edge case). Returns the folder, or null when cancelled.
 */
export async function chooseProjectFolder(
  confirmLarge: () => Promise<boolean>,
  startIn?: string | null,
): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, ...(startIn ? { defaultPath: startIn } : {}) });
  if (typeof picked !== "string") return null;
  const count = await countEntries(picked, LARGE_FOLDER + 1);
  if (count > LARGE_FOLDER && !(await confirmLarge())) return null;
  return picked;
}
