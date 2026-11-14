/**
 * Suggestions (spec 007 R2): commands after `\`, environments inside `\begin{`, labels inside
 * `\ref{`-like commands, and bibliography keys inside `\cite{`-like commands (comma lists too).
 */
import { snippet, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { BUILTIN_COMMANDS, BUILTIN_ENVIRONMENTS } from "./commands";
import type { ProjectIndex } from "./index";

const REF = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\{([^}\n]*)$/;
const CITE = /\\(?:cite|citep|citet|citealp|parencite|textcite|autocite|footcite|nocite|citeauthor|citeyear)\*?(?:\[[^\]\n]*\])*\{([^}\n]*)$/;
const BEGIN = /\\begin\{([A-Za-z*]*)$/;
const COMMAND = /\\[A-Za-z@]*\*?$/;

/** A snippet that also swallows the `}` closeBrackets put after the cursor. */
function environmentApply(name: string, args: string) {
  const insert = snippet(`${name}}${args}\n\t\${}\n\\end{${name}}`);
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 1) === "}" ? to + 1 : to;
    insert(view, completion, from, end);
  };
}

function commandOptions(index: ProjectIndex): Completion[] {
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const macro of index.macros) {
    const label = `\\${macro.name}`;
    if (seen.has(label)) continue;
    seen.add(label);
    options.push(snippetCompletion(label + "{${}}".repeat(macro.args), { label, detail: `Defined in ${macro.file}`, type: "function", boost: 1 }));
  }
  for (const command of BUILTIN_COMMANDS) {
    if (seen.has(command.label)) continue;
    seen.add(command.label);
    options.push(snippetCompletion(command.template, { label: command.label, detail: command.detail, type: "keyword" }));
  }
  options.push(snippetCompletion("\\begin{${env}}\n\t${}\n\\end{${env}}", { label: "\\begin", detail: "Environment", type: "keyword" }));
  return options;
}

/** The completion source; `getIndex` is read on every request, so it always sees the latest project. */
export function latexCompletions(getIndex: () => ProjectIndex) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const index = getIndex();

    const ref = REF.exec(before);
    if (ref) {
      return {
        from: context.pos - ref[1].length,
        options: index.labels.map((label) => ({
          label: label.key,
          detail: label.context,
          info: label.duplicate ? `Defined more than once (${label.file}:${label.line})` : `${label.file}:${label.line}`,
          type: "variable",
        })),
        validFor: /^[^}\s]*$/,
      };
    }

    const cite = CITE.exec(before);
    if (cite) {
      const typed = cite[1].slice(cite[1].lastIndexOf(",") + 1).trimStart();
      return {
        from: context.pos - typed.length,
        options: index.bibEntries.map((entry) => ({
          label: entry.key,
          detail: [entry.author.split(/\s+and\s+/)[0], entry.year].filter(Boolean).join(" · "),
          info: entry.title || undefined,
          type: "text",
        })),
        validFor: /^[^,}\s]*$/,
      };
    }

    const begin = BEGIN.exec(before);
    if (begin) {
      return {
        from: context.pos - begin[1].length,
        options: BUILTIN_ENVIRONMENTS.map((env) => ({ label: env.name, detail: env.detail, type: "class", apply: environmentApply(env.name, env.args) })),
        validFor: /^[A-Za-z*]*$/,
      };
    }

    const command = COMMAND.exec(before);
    if (command && (command[0].length > 1 || context.explicit)) {
      return { from: context.pos - command[0].length, options: commandOptions(index), validFor: /^\\[A-Za-z@]*\*?$/ };
    }
    return null;
  };
}
