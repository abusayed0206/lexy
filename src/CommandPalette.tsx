import { useMemo, useState, type KeyboardEvent } from "react";
import { searchActions, type Action } from "./actions";

type Props = { actions: Action[]; onClose: () => void };

/** Ctrl+Shift+P: every action by name with its shortcut (spec 007 R12). */
export function CommandPalette({ actions, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchActions(actions, query).slice(0, 50), [actions, query]);

  function run(action: Action | undefined) {
    if (!action) return;
    onClose();
    // After the palette is gone, so focus-dependent actions (formatting) reach the editor.
    setTimeout(action.run, 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") setActive((at) => Math.min(hits.length - 1, at + 1));
    else if (event.key === "ArrowUp") setActive((at) => Math.max(0, at - 1));
    else if (event.key === "Enter") run(hits[active]);
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const listId = "palette-list";
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="palette dialog" role="dialog" aria-label="Command palette">
        <input
          className="palette-input"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={hits[active] ? `palette-${hits[active].id}` : undefined}
          aria-label="Type a command"
          placeholder="Type a command"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" id={listId} role="listbox" aria-label="Commands">
          {hits.map((action, index) => (
            <li
              key={action.id}
              id={`palette-${action.id}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "palette-item active" : "palette-item"}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                run(action);
              }}
            >
              <span className="palette-title">{action.title}</span>
              <span className="palette-group">{action.group}</span>
              {action.shortcut ? <kbd className="palette-shortcut">{action.shortcut}</kbd> : null}
            </li>
          ))}
          {hits.length ? null : <li className="palette-empty">No matching commands</li>}
        </ul>
      </div>
    </>
  );
}
