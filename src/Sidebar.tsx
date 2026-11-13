import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorText, isWithin, listDir, parentOf, sameRel, type Entry } from "./projects";
import { Icon } from "./ribbon/icons";

export type SidebarActions = {
  onOpen: (entry: Entry) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  /** Rename in place; resolves false to keep the rename field open (name taken, invalid). */
  onRename: (entry: Entry, name: string) => Promise<boolean>;
  onDelete: (entry: Entry) => void;
  onSetMain: (path: string) => void;
  /** Show a folder (or the folder holding a file) in Explorer; "" is the project folder. */
  onReveal: (dir: string) => void;
  onHome: () => void;
  onImport: (sources: string[], dir: string) => void;
  onError: (message: string) => void;
};

type Props = {
  projectName: string;
  /** Bump to re-list every loaded folder (after file operations and outside changes). */
  version: number;
  current: string | null;
  main: string | null;
  /** Lower-cased paths with unsaved edits. */
  dirty: ReadonlySet<string>;
  readOnly: boolean;
  actions: SidebarActions;
};

type Row = { entry: Entry; depth: number };
type Menu = { entry: Entry | null; x: number; y: number; more?: boolean };

const HIDDEN_KEY = "lexy.showHidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Folder that an action on `entry` targets: the folder itself, or the file's folder. */
const folderOf = (entry: Entry | null) => (entry === null ? "" : entry.kind === "folder" ? entry.path : parentOf(entry.path));

/** Lazy project tree (contracts/ui.md): one folder listed at a time, tree keyboard pattern, context menu, drop target. */
export function Sidebar({ projectName, version, current, main, dirty, readOnly, actions }: Props) {
  const [children, setChildren] = useState<ReadonlyMap<string, Entry[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([""]));
  const [focused, setFocused] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showHidden, setShowHidden] = useState(readHidden);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  async function load(dir: string) {
    try {
      const entries = await listDir(dir);
      setChildren((map) => new Map(map).set(dir, entries));
    } catch (error) {
      // A folder that vanished is simply dropped from the tree.
      setChildren((map) => {
        const next = new Map(map);
        next.delete(dir);
        return next;
      });
      if (dir === "") actionsRef.current.onError(`Could not list the project folder. ${errorText(error)}`);
    }
  }

  // (Re)list every expanded folder whenever the version changes.
  useEffect(() => {
    for (const dir of expanded) void load(dir);
    // `expanded` changes are handled in toggle(); this only reacts to refreshes.
  }, [version]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of children.get(dir) ?? []) {
        if (entry.hidden && !showHidden) continue;
        out.push({ entry, depth });
        if (entry.kind === "folder" && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk("", 1);
    return out;
  }, [children, expanded, showHidden]);

  const focusedPath = focused !== null && rows.some((row) => row.entry.path === focused) ? focused : (rows[0]?.entry.path ?? null);

  function focusRow(path: string | null) {
    setFocused(path);
    if (path === null) return;
    requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
  }

  function toggle(entry: Entry, open?: boolean) {
    if (entry.kind !== "folder") return;
    const willOpen = open ?? !expanded.has(entry.path);
    setExpanded((set) => {
      const next = new Set(set);
      if (willOpen) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
    if (willOpen && !children.has(entry.path)) void load(entry.path);
  }

  function activate(entry: Entry) {
    if (entry.kind === "folder") toggle(entry);
    else actions.onOpen(entry);
  }

  function startRename(entry: Entry) {
    if (readOnly) return;
    setRenaming(entry.path);
    setRenameValue(entry.name);
    setMenu(null);
  }

  async function commitRename(entry: Entry) {
    const name = renameValue.trim();
    if (!name || name === entry.name) {
      setRenaming(null);
      return;
    }
    if (await actions.onRename(entry, name)) {
      setRenaming(null);
      focusRow(entry.path.slice(0, entry.path.length - entry.name.length) + name);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, row: Row) {
    const { entry } = row;
    const index = rows.findIndex((r) => r.entry.path === entry.path);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case "ArrowDown":
        handled();
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.entry.path ?? null);
        return;
      case "ArrowUp":
        handled();
        focusRow(rows[Math.max(0, index - 1)]?.entry.path ?? null);
        return;
      case "Home":
        handled();
        focusRow(rows[0]?.entry.path ?? null);
        return;
      case "End":
        handled();
        focusRow(rows[rows.length - 1]?.entry.path ?? null);
        return;
      case "ArrowRight":
        handled();
        if (entry.kind === "folder" && !expanded.has(entry.path)) toggle(entry, true);
        else if (entry.kind === "folder") focusRow(rows[index + 1]?.depth > row.depth ? rows[index + 1].entry.path : entry.path);
        return;
      case "ArrowLeft":
        handled();
        if (entry.kind === "folder" && expanded.has(entry.path)) toggle(entry, false);
        else if (parentOf(entry.path)) focusRow(parentOf(entry.path));
        return;
      case "Enter":
        handled();
        activate(entry);
        return;
      case "F2":
        handled();
        startRename(entry);
        return;
      case "Delete":
        handled();
        if (!readOnly) actions.onDelete(entry);
        return;
      case "ContextMenu":
      case "F10":
        if (event.key === "F10" && !event.shiftKey) return;
        handled();
        openMenu(entry, event.currentTarget.getBoundingClientRect().left + 24, event.currentTarget.getBoundingClientRect().bottom);
        return;
    }
  }

  function openMenu(entry: Entry | null, x: number, y: number) {
    setMenu({ entry, x, y });
  }

  function onContextMenu(event: MouseEvent, entry: Entry | null) {
    event.preventDefault();
    event.stopPropagation();
    openMenu(entry, event.clientX, event.clientY);
  }

  // Files dropped from Explorer (research R5): Tauri's native drag-drop reports physical pixels.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const targetAt = (x: number, y: number): string | null => {
      const scale = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(x / scale, y / scale) as HTMLElement | null;
      if (!element || !box.current?.contains(element)) return null;
      const row = element.closest<HTMLElement>("[data-path]");
      if (!row) return "";
      return row.dataset.kind === "folder" ? row.dataset.path! : parentOf(row.dataset.path!);
    };
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "over" || payload.type === "enter") setDropTarget(targetAt(payload.position.x, payload.position.y));
          else if (payload.type === "drop") {
            const target = targetAt(payload.position.x, payload.position.y);
            setDropTarget(null);
            if (target !== null && payload.paths.length) actionsRef.current.onImport(payload.paths, target);
          } else setDropTarget(null);
        }),
      )
      .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
      .catch(() => undefined); // Not running inside Tauri (tests, browser preview).
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  function menuItems(entry: Entry | null) {
    const dir = folderOf(entry);
    const items: { label: string; run: () => void; disabled?: boolean }[] = [];
    if (entry) items.push({ label: "Open", run: () => activate(entry) });
    if (entry) items.push({ label: "Rename", run: () => startRename(entry), disabled: readOnly });
    if (entry) items.push({ label: "Delete", run: () => actions.onDelete(entry), disabled: readOnly });
    items.push({ label: "New file here", run: () => actions.onNewFile(dir), disabled: readOnly });
    items.push({ label: "New folder here", run: () => actions.onNewFolder(dir), disabled: readOnly });
    if (entry?.kind === "file" && /\.tex$/i.test(entry.name) && !sameRel(entry.path, main)) {
      items.push({ label: "Set as main document", run: () => actions.onSetMain(entry.path), disabled: readOnly });
    }
    items.push({ label: "Open in Explorer", run: () => actions.onReveal(dir) });
    return items;
  }

  const focusedDir = (() => {
    const entry = rows.find((row) => row.entry.path === focusedPath)?.entry ?? null;
    return folderOf(entry);
  })();

  return (
    <aside className="sidebar" aria-label="Project files" ref={box} onContextMenu={(event) => onContextMenu(event, null)}>
      <div className="sidebar-header">
        <strong className="sidebar-title" title={projectName}>
          {projectName}
        </strong>
        <button type="button" className="icon-button" title="New file" aria-label="New file" disabled={readOnly} onClick={() => actions.onNewFile(focusedDir)}>
          <Icon name="new" />
        </button>
        <button type="button" className="icon-button" title="New folder" aria-label="New folder" disabled={readOnly} onClick={() => actions.onNewFolder(focusedDir)}>
          <Icon name="newFolder" />
        </button>
        <button
          type="button"
          className="icon-button"
          title="More"
          aria-label="More"
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ entry: null, x: rect.left, y: rect.bottom, more: true });
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          …
        </button>
      </div>

      <div
        className={dropTarget === "" ? "file-tree drop-target" : "file-tree"}
        role="tree"
        aria-label={`${projectName} files`}
        ref={tree}
      >
        {rows.map((row) => {
          const { entry } = row;
          const isFolder = entry.kind === "folder";
          const open = isFolder && expanded.has(entry.path);
          const unsaved = dirty.has(entry.path.toLowerCase()) || (isFolder && [...dirty].some((path) => isWithin(path, entry.path.toLowerCase())));
          const classes = [
            "tree-row",
            sameRel(entry.path, current) ? "current" : "",
            entry.hidden ? "hidden-entry" : "",
            dropTarget !== null && isFolder && dropTarget === entry.path ? "drop-target" : "",
          ];
          return (
            <div
              key={entry.path}
              role="treeitem"
              aria-level={row.depth}
              aria-expanded={isFolder ? open : undefined}
              aria-selected={sameRel(entry.path, current)}
              aria-label={entry.name}
              data-path={entry.path}
              data-kind={entry.kind}
              tabIndex={entry.path === focusedPath ? 0 : -1}
              className={classes.filter(Boolean).join(" ")}
              style={{ paddingLeft: 6 + (row.depth - 1) * 14 }}
              onFocus={() => setFocused(entry.path)}
              onClick={() => {
                setFocused(entry.path);
                activate(entry);
              }}
              onKeyDown={(event) => renaming !== entry.path && onKeyDown(event, row)}
              onContextMenu={(event) => onContextMenu(event, entry)}
            >
              <span className="tree-twisty" aria-hidden="true">
                {isFolder ? (open ? "▾" : "▸") : ""}
              </span>
              {renaming === entry.path ? (
                <input
                  className="tree-rename"
                  aria-label={`Rename ${entry.name}`}
                  autoFocus
                  value={renameValue}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => void commitRename(entry)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitRename(entry);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRenaming(null);
                      focusRow(entry.path);
                    }
                  }}
                />
              ) : (
                <span className="tree-name">{entry.name}</span>
              )}
              {sameRel(entry.path, main) ? <span className="main-badge">Main</span> : null}
              {unsaved ? <span className="unsaved-dot" role="img" aria-label="Unsaved changes" /> : null}
            </div>
          );
        })}
        {children.has("") && rows.length === 0 ? <p className="tree-empty">Empty folder</p> : null}
      </div>

      {menu ? (
        <div
          className="context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const items = [...(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") {
              event.preventDefault();
              setMenu(null);
              focusRow(focusedPath);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}
        >
          {(menu.more
            ? [
                {
                  label: showHidden ? "Hide hidden files" : "Show hidden files",
                  run: () => {
                    const next = !showHidden;
                    setShowHidden(next);
                    try {
                      localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
                    } catch {
                      // Storage blocked: the choice just isn't remembered.
                    }
                  },
                },
                { label: "Open in Explorer", run: () => actions.onReveal("") },
                { label: "Project Home", run: actions.onHome },
              ]
            : menuItems(menu.entry)
          ).map((item: { label: string; run: () => void; disabled?: boolean }, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              disabled={item.disabled}
              onClick={() => {
                setMenu(null);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

