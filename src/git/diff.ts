export type DiffRow = { kind: "ctx" | "add" | "del" | "hunk"; oldLine?: number; newLine?: number; text: string };

/** Unified diff text → display rows with line numbers. File headers are dropped. */
export function parseDiff(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
    } else if (!inHunk || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldLine: oldLine++, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith("diff ")) {
      inHunk = false;
    }
  }
  return rows;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "none";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
