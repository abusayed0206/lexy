import { useId, useMemo, useRef, useState } from "react";
import { BUILTIN_FONTS, fontLabel, listKritiFonts, listSystemFonts, sameFont, type FontChoice, type KritiFamily } from "../latex/fonts";

type Props = {
  value: FontChoice;
  /** False when the document has no Lexy settings block yet: shows "Default". */
  managed: boolean;
  onChange: (font: FontChoice) => void;
};

type Option = { key: string; label: string; font: FontChoice; group: "builtin" | "kriti" | "system"; title?: string };

/** ARIA combobox: built-in fonts, then Bangla fonts from kriti.app, then installed fonts (both loaded on first open). */
export function FontPicker({ value, managed, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [kriti, setKriti] = useState<KritiFamily[] | null>(null);
  const [kritiError, setKritiError] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
    const builtin: Option[] = BUILTIN_FONTS.filter((font) => matches(font.label)).map((font) => ({
      key: `b:${font.id}`,
      label: font.label,
      font: { kind: "builtin", id: font.id },
      group: "builtin",
    }));
    const system: Option[] = (installed ?? []).filter(matches).map((family) => ({
      key: `s:${family}`,
      label: family,
      font: { kind: "system", family },
      group: "system",
    }));
    const bangla: Option[] = (kriti ?? [])
      .filter((family) => matches(family.family))
      .map((family) => ({
        key: `k:${family.family}`,
        label: family.family,
        font: { kind: "kriti", family: family.family },
        group: "kriti",
        title: [family.designer, family.license, family.styles.join(", ")].filter(Boolean).join(" · "),
      }));
    return [...builtin, ...bangla, ...system];
  }, [query, installed, kriti]);

  function openList() {
    if (open) return;
    setOpen(true);
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => sameFont(option.font, value))));
    if (kriti === null) {
      setKritiError(false);
      listKritiFonts().then(setKriti, () => {
        setKriti([]);
        setKritiError(true);
      });
    }
    if (installed === null) {
      listSystemFonts().then(setInstalled, () => {
        setInstalled([]);
        setLoadError(true);
      });
    }
  }

  function choose(option: Option | undefined) {
    if (!option) return;
    setOpen(false);
    setQuery("");
    onChange(option.font);
  }

  const shown = managed ? fontLabel(value) : "Default";
  const builtinOptions = options.filter((option) => option.group === "builtin");
  const systemOptions = options.filter((option) => option.group === "system");
  const kritiOptions = options.filter((option) => option.group === "kriti");
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="font-picker">
      <input
        ref={input}
        className="font-input"
        role="combobox"
        aria-label="Font"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        title="Document font"
        value={open ? query : shown}
        placeholder={shown}
        onFocus={openList}
        onClick={openList}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openList();
            else setActive((index) => Math.min(options.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            choose(options[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open ? (
        <div className="font-list" id={listId} role="listbox" aria-label="Fonts">
          {builtinOptions.length ? (
            <div role="group" aria-label="Built-in fonts">
              <div className="font-group" aria-hidden="true">Built-in</div>
              {builtinOptions.map((option) => renderOption(option, options.indexOf(option)))}
            </div>
          ) : null}
          <div role="group" aria-label="Bangla fonts from kriti.app">
            <div className="font-group" aria-hidden="true">
              Bangla fonts (kriti.app, copied into the project)
            </div>
            {kriti === null ? <div className="font-note">Loading the kriti.app catalog</div> : null}
            {kritiError ? <div className="font-note">Could not load the kriti.app catalog (offline?)</div> : null}
            {kritiOptions.map((option) => renderOption(option, options.indexOf(option)))}
          </div>
          <div role="group" aria-label="Installed fonts">
            <div className="font-group" aria-hidden="true">
              Installed fonts (XeLaTeX)
            </div>
            {installed === null ? <div className="font-note">Loading fonts</div> : null}
            {loadError ? <div className="font-note">Could not list installed fonts</div> : null}
            {systemOptions.map((option) => renderOption(option, options.indexOf(option)))}
          </div>
          {!options.length && installed !== null && kriti !== null ? <div className="font-note">No matching fonts</div> : null}
        </div>
      ) : null}
    </div>
  );

  function renderOption(option: Option, index: number) {
    return (
      <div
        key={option.key}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        className={index === active ? "font-option active" : "font-option"}
        title={option.title}
        style={option.group === "system" ? { fontFamily: `"${option.label}"` } : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(option)}
      >
        {option.label}
      </div>
    );
  }
}
