/** Re-indent environments (spec 007 R8): 2 spaces per level, verbatim-like content untouched. */
import { stripComments } from "./index";

const VERBATIM = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*"]);
/** Too wide to indent: the whole body would shift. */
const FLAT = new Set(["document"]);
const INDENT = "  ";

export function tidy(text: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let depth = 0;
  let verbatim: string | null = null;
  for (const line of lines) {
    if (verbatim) {
      const close = line.indexOf(`\\end{${verbatim}}`);
      if (close < 0) {
        out.push(line);
        continue;
      }
      verbatim = null;
      depth = Math.max(0, depth - 1);
      out.push(INDENT.repeat(depth) + line.trim());
      continue;
    }
    const content = line.trim();
    if (!content) {
      out.push("");
      continue;
    }
    const code = stripComments(content);
    let opens = 0;
    let closes = 0;
    let leadingCloses = 0;
    let seenOpen = false;
    for (const m of code.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
      if (FLAT.has(m[2])) continue;
      if (m[1] === "begin") {
        opens++;
        seenOpen = true;
        if (VERBATIM.has(m[2]) && !code.includes(`\\end{${m[2]}}`, m.index)) verbatim = m[2];
      } else if (opens > 0) opens--;
      else {
        closes++;
        if (!seenOpen) leadingCloses++;
      }
    }
    out.push(INDENT.repeat(Math.max(0, depth - leadingCloses)) + content);
    depth = Math.max(0, depth - closes + opens);
  }
  return out.join(eol);
}
