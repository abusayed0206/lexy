import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Icon } from "./ribbon/icons";
import { baseName, sameRel } from "./projects";

type Props = {
  /** Open files in tab order. */
  paths: string[];
  current: string | null;
  main: string | null;
  /** Lower-cased paths with unsaved edits. */
  dirty: ReadonlySet<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onMove: (path: string, index: number) => void;
  onCloseOthers: (path: string) => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
};

type Menu = { path: string; x: number; y: number };

/**
 * Tabs for open files (spec 007 R10, Windows TabView rules): one tab is always active, arrows move
 * between tabs, Enter/Space select, Delete closes, drag reorders, middle-click closes.
 */
export function EditorTabs({ paths, current, main, dirty, onSelect, onClose, onMove, onCloseOthers, onCopyPath, onReveal }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const dragged = useRef<string | null>(null);

  function focusTab(index: number) {
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, path: string, index: number) {
    if (event.key === "ArrowRight") focusTab((index + 1) % paths.length);
    else if (event.key === "ArrowLeft") focusTab((index - 1 + paths.length) % paths.length);
    else if (event.key === "Home") focusTab(0);
    else if (event.key === "End") focusTab(paths.length - 1);
    else if (event.key === "Enter" || event.key === " ") onSelect(path);
    else if (event.key === "Delete" && !sameRel(path, main)) onClose(path);
    else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({ path, x: box.left, y: box.bottom });
    } else return;
    event.preventDefault();
  }

  function drop(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    if (dragged.current !== null) onMove(dragged.current, index);
    dragged.current = null;
  }

  if (!paths.length) return null;
  return (
    <div className="editor-tabs" ref={strip} role="tablist" aria-label="Open files" onScroll={() => setMenu(null)}>
      {paths.map((path, index) => {
        const active = sameRel(path, current);
        const unsaved = dirty.has(path.toLowerCase());
        const isMain = sameRel(path, main);
        return (
          <div
            key={path}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={active ? "editor-tab active" : "editor-tab"}
            title={path}
            draggable
            onClick={() => onSelect(path)}
            onAuxClick={(event) => {
              if (event.button === 1 && !isMain) onClose(path);
            }}
            onKeyDown={(event) => onKeyDown(event, path, index)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ path, x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event) => {
              dragged.current = path;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, index)}
          >
            <span className="editor-tab-name">{baseName(path)}</span>
            {unsaved ? <span className="unsaved-dot" role="img" aria-label="Unsaved changes" /> : null}
            {isMain ? null : (
              <button
                type="button"
                className="editor-tab-close"
                aria-label={`Close ${baseName(path)}`}
                title="Close (Ctrl+W)"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        );
      })}
      {menu ? (
        <TabMenu
          menu={menu}
          canClose={!sameRel(menu.path, main)}
          onClose={() => setMenu(null)}
          items={{
            close: () => onClose(menu.path),
            closeOthers: () => onCloseOthers(menu.path),
            copyPath: () => onCopyPath(menu.path),
            reveal: () => onReveal(menu.path),
          }}
        />
      ) : null}
    </div>
  );
}

function TabMenu({
  menu,
  canClose,
  onClose,
  items,
}: {
  menu: Menu;
  canClose: boolean;
  onClose: () => void;
  items: { close: () => void; closeOthers: () => void; copyPath: () => void; reveal: () => void };
}) {
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div
        className="menu-popup tab-menu"
        role="menu"
        style={{ left: Math.min(menu.x, window.innerWidth - 232), top: menu.y }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <button type="button" role="menuitem" className="menu-item" disabled={!canClose} onClick={run(items.close)} autoFocus>
          Close
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={run(items.closeOthers)}>
          Close others
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={run(items.copyPath)}>
          Copy path
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={run(items.reveal)}>
          Reveal in sidebar
        </button>
      </div>
    </>
  );
}
