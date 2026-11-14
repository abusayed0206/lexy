import type { RibbonActions } from "./Ribbon";
import { DEFAULT_TABLE } from "./latex/tables";

/**
 * One list of user actions (spec 007 R12): the command palette, the ribbon's tooltips and the
 * shortcut listener read titles and shortcuts from it.
 */

export type Action = {
  /** Stable id, e.g. `file.save`, `insert.table`. */
  id: string;
  /** Sentence case, as shown in the palette. */
  title: string;
  /** Ribbon tab or area, e.g. "File", "Insert". */
  group: string;
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
};

/** The ribbon's existing commands as actions (titles match the ribbon labels; shortcuts match DESIGN.md). */
export function ribbonCommands(run: RibbonActions): Action[] {
  const a = (id: string, group: string, title: string, go: () => void, shortcut?: string): Action => ({ id, group, title, run: go, shortcut });
  return [
    a("file.newFile", "File", "New file", run.onNew, "Ctrl+N"),
    a("file.newProject", "File", "New project", run.onNewProject),
    a("file.openFolder", "File", "Open folder…", run.onOpen, "Ctrl+O"),
    a("file.home", "File", "Project Home", run.onHome),
    a("file.save", "File", "Save", run.onSave, "Ctrl+S"),
    a("file.saveAs", "File", "Save as", run.onSaveAs, "Ctrl+Shift+S"),
    a("file.history", "File", "Earlier versions", run.onHistory),
    a("file.settings", "File", "Settings", run.onSettings, "Ctrl+,"),
    a("file.exportWord", "File", "Export to Word", () => run.onExport("docx")),
    a("file.exportHtml", "File", "Export to web page", () => run.onExport("html")),
    a("home.bold", "Home", "Bold", () => run.onFormat("textbf"), "Ctrl+B"),
    a("home.italic", "Home", "Italic", () => run.onFormat("textit"), "Ctrl+I"),
    a("home.underline", "Home", "Underline", () => run.onFormat("underline"), "Ctrl+U"),
    a("home.bullets", "Home", "Bullets", () => run.onList("itemize")),
    a("home.numbering", "Home", "Numbering", () => run.onList("enumerate")),
    a("home.normal", "Home", "Normal text", () => run.onHeading(0)),
    a("home.heading1", "Home", "Heading 1", () => run.onHeading(1)),
    a("home.heading2", "Home", "Heading 2", () => run.onHeading(2)),
    a("home.heading3", "Home", "Heading 3", () => run.onHeading(3)),
    a("home.tidy", "Home", "Tidy indentation", run.onTidy, "Shift+Alt+F"),
    a("review.grammar", "Review", "Check grammar", run.onGrammar, "F7"),
    a("insert.equation", "Insert", "Equation", run.onEquation),
    a("insert.table", "Insert", "Table", () => run.onTable({ ...DEFAULT_TABLE, rows: 3, cols: 3 })),
    a("insert.pageBreak", "Insert", "Page break", run.onPageBreak),
    a("insert.footnote", "Insert", "Footnote", run.onFootnote),
    a("insert.citation", "Insert", "Citation", run.onCitation),
    a("insert.image", "Insert", "Image", run.onImage),
    a("review.newNote", "Review", "New note", run.onNewNote, "Ctrl+Alt+M"),
    a("review.notes", "Review", "Show notes", run.onShowNotes),
    a("review.pdfNotes", "Review", "Export PDF with notes", run.onExportNotes),
    a("review.compareLast", "Review", "Compare with last version", run.onCompareLast),
    a("review.compareWith", "Review", "Compare with…", run.onCompareWith),
    a("view.files", "View", "Files", run.onToggleFiles, "Ctrl+Shift+E"),
    a("view.focus", "View", "Focus mode", run.onToggleFocus, "F11"),
    a("view.live", "View", "Live preview", run.onToggleLive),
    a("view.compile", "View", "Compile now", run.onCompile, "F5"),
    a("view.logs", "View", "Logs", run.onToggleLogs, "Ctrl+L"),
    a("view.showInPdf", "View", "Show in PDF", run.onShowInPdf, "Ctrl+J"),
    a("view.zoomIn", "View", "Zoom in", () => run.onZoom("in"), "Ctrl+="),
    a("view.zoomOut", "View", "Zoom out", () => run.onZoom("out"), "Ctrl+-"),
    a("view.fit", "View", "Fit width", () => run.onZoom("fit"), "Ctrl+0"),
    a("git.panel", "Git", "Git panel", () => run.onGit("changes"), "Ctrl+Shift+G"),
    a("git.commit", "Git", "Commit", () => run.onGit("focus"), "Ctrl+Shift+K"),
    a("git.init", "Git", "Start version history", () => run.onGit("init")),
    a("git.history", "Git", "History", () => run.onGit("history")),
    a("git.publish", "Git", "Publish to GitHub", () => run.onGit("publish")),
    a("git.connect", "Git", "Connect…", () => run.onGit("connect")),
    a("git.push", "Git", "Push", () => run.onGit("push")),
    a("git.pull", "Git", "Pull", () => run.onGit("pull")),
    a("git.sync", "Git", "Sync", () => run.onGit("sync")),
  ];
}

/**
 * Subsequence match of `query` in `title` (case-insensitive). Higher is better: matches at word
 * starts and consecutive matches score more. Null when `query` is not a subsequence.
 */
export function fuzzyMatch(query: string, title: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = title.toLowerCase();
  let score = 0;
  let at = 0;
  let previous = -2;
  for (const char of q) {
    if (char === " ") continue;
    const found = t.indexOf(char, at);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-./(]/.test(t[found - 1]);
    score += 1 + (wordStart ? 3 : 0) + (found === previous + 1 ? 2 : 0);
    previous = found;
    at = found + 1;
  }
  // Greedy matching can pick early letters ("t" in "Insert"); a whole-substring hit, best at a word start, outranks it.
  const compact = q.replace(/\s+/g, " ");
  const hit = t.indexOf(compact);
  if (hit >= 0) score += hit === 0 || /[\s\-./(]/.test(t[hit - 1]) ? 10 : 5;
  // Prefer shorter titles when scores tie.
  return score - title.length / 100;
}

/** Actions matching `query`, best first; disabled actions are left out. */
export function searchActions(actions: Action[], query: string): Action[] {
  return actions
    .filter((action) => action.enabled?.() ?? true)
    // The group ("Git push") counts only when the query has two words; otherwise it matches too much.
    .map((action) => ({
      action,
      score: fuzzyMatch(query, action.title) ?? (query.trim().includes(" ") ? fuzzyMatch(query, `${action.group} ${action.title}`) : null),
    }))
    .filter((hit): hit is { action: Action; score: number } => hit.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.action);
}
