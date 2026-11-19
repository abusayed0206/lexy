import type { EngineChoice } from "../latex/engine";
import { MenuButton } from "./Menu";

type Props = {
  choice: EngineChoice;
  /** "Last compile: XeLaTeX (fontspec package)", or null before the first compile. */
  lastCompile: string | null;
  disabled?: boolean;
  onChange: (choice: EngineChoice) => void;
};

const CHOICES: { value: EngineChoice; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "pdflatex", label: "pdfLaTeX" },
  { value: "xelatex", label: "XeLaTeX" },
  { value: "lualatex", label: "LuaLaTeX" },
];

/** Layout → Engine (spec 008 US3): writes or removes the main document's engine line. */
export function EngineMenu({ choice, lastCompile, disabled, onChange }: Props) {
  return (
    <MenuButton
      label="Engine"
      icon="engine"
      disabled={disabled}
      items={CHOICES.map((item) => ({ label: item.label, checked: item.value === choice, onSelect: () => onChange(item.value) }))}
    >
      {() => (lastCompile ? <p className="menu-caption">{lastCompile}</p> : null)}
    </MenuButton>
  );
}

/** "engine line", "fontspec package", "default" or "Bangla text" for the menu's last-compile line. */
export function reasonLabel(reason: string | undefined): string {
  if (!reason || reason === "default") return "default";
  if (reason === "marker") return "engine line";
  if (reason.startsWith("Bangla")) return "Bangla text";
  return `${reason} package`;
}
