import { useRef, type KeyboardEvent } from "react";
import type { OutlineEntry } from "./latex/index";

type Props = {
  entries: OutlineEntry[];
  /** No main document yet: the outline follows the main document's includes. */
  hasMain: boolean;
  onJump: (file: string, line: number) => void;
};

const KIND_LABEL: Partial<Record<OutlineEntry["kind"], string>> = { figure: "Figure", table: "Table" };

/** Sections, figures and tables across the project in document order (spec 007 US2). */
export function Outline({ entries, hasMain, onJump }: Props) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number, entry: OutlineEntry) {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const go = (to: number) => rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(rows.length - 1);
    else if (event.key === "Enter" || event.key === " ") onJump(entry.file, entry.line);
    else return;
    event.preventDefault();
  }

  if (!entries.length) {
    return <p className="side-empty">{hasMain ? "No headings yet" : "Choose a main document to see its outline"}</p>;
  }
  return (
    <div className="outline" role="tree" aria-label="Document outline" ref={list}>
      {entries.map((entry, index) => {
        const label = KIND_LABEL[entry.kind];
        return (
          <div
            key={`${entry.file}:${entry.line}:${index}`}
            role="treeitem"
            aria-level={entry.depth + 1}
            tabIndex={index === 0 ? 0 : -1}
            className={`outline-row outline-${entry.kind}`}
            style={{ paddingLeft: 8 + entry.depth * 12 }}
            title={`${label ? `${label}: ` : ""}${entry.title} (${entry.file}:${entry.line})`}
            onClick={() => onJump(entry.file, entry.line)}
            onKeyDown={(event) => onKeyDown(event, index, entry)}
          >
            {label ? <span className="outline-kind">{label}</span> : null}
            <span className="outline-title">{entry.title}</span>
          </div>
        );
      })}
    </div>
  );
}
