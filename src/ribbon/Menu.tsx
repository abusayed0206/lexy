import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type MenuItem = {
  label: string;
  detail?: string;
  checked?: boolean;
  onSelect: () => void;
};

type Props = {
  label: string;
  icon: IconName;
  items?: MenuItem[];
  /** Custom popup content (e.g. the table grid); rendered above the items. */
  children?: (close: () => void) => ReactNode;
};

/** A ribbon button that opens a menu (WAI-ARIA menu button pattern). */
export function MenuButton({ label, icon, items = [], children }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();

  function close(refocus = true) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent | MouseEvent) {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !button.current?.contains(target)) close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    // Focus the first item (or the custom content) when opened.
    const first = popup.current?.querySelector<HTMLElement>('[role^="menuitem"], [tabindex="0"]');
    first?.focus();
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = [...(popup.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" && entries.length) {
      event.preventDefault();
      entries[(index + 1) % entries.length].focus();
    } else if (event.key === "ArrowUp" && entries.length) {
      event.preventDefault();
      entries[(index - 1 + entries.length) % entries.length].focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  return (
    <div className="menu-button">
      <button
        ref={button}
        type="button"
        className="ribbon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={icon} />
        <span className="ribbon-label">
          {label}
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open ? (
        <div className="menu-popup" id={id} ref={popup} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
          {children?.(() => close())}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              className="menu-item"
              tabIndex={-1}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span className="menu-check" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
              <span className="menu-text">
                {item.label}
                {item.detail ? <small>{item.detail}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
