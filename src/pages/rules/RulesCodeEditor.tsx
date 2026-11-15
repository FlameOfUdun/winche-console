import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Box } from "@mantine/core";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import type { RuleSubsystem, RulesSyntaxError } from "../../api/rules";
import { analyze, definedFunctions, suggest, type FieldInfo, type Suggestion } from "./rulesCompletion";

const KEYWORDS = new Set(["match", "allow", "if", "in", "is", "read", "write", "get", "list", "create", "update", "delete", "function", "let", "return"]);
const ATOMS = new Set(["true", "false", "null"]);
const ROOTS = new Set(["request", "resource"]);

/** Colours for the rules syntax (a small tokenizer; the server is what actually parses). */
const BRACKETS = ["(", "[", "'", '"', "`"];
const rulesLanguage = StreamLanguage.define<{ inPath: boolean; depth: number }>({
  startState: () => ({ inPath: false, depth: 0 }),
  // Blocks indent by their depth; a line starting with } goes back one (typing } puts it there).
  indent(state, textAfter, cx) {
    return Math.max(0, state.depth - (/^\s*\}/.test(textAfter) ? 1 : 0)) * cx.unit;
  },
  // { isn't closed for you: the } you type ends the block (an extra one made for you would be one too many).
  languageData: { indentOnInput: /^\s*\}$/, closeBrackets: { brackets: BRACKETS } },
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (state.inPath) {
      state.inPath = false;
      if (stream.match(/^\S+?(?=\s*\{|\s|$)/)) return "string.special";
    }
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match("{")) { state.depth++; return "operator"; }
    if (stream.match("}")) { state.depth = Math.max(0, state.depth - 1); return "operator"; }
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
    // A path literal, /users/$( … ): the segments are coloured as a path; $( … ) contents as code.
    if (stream.match(/^\/(?!\/)[A-Za-z0-9_.~@%+/-]*/)) return "string.special";
    if (stream.match("$(")) return "operator";
    if (stream.match(/^`[^`]*`?/)) return "propertyName";
    const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (w === "match") { state.inPath = true; return "keyword"; }
      // The readable forms: `not in`, `has only|all|any`, `changes only|all|any` (the words alone are names).
      if (w === "not" && stream.match(/^\s+in\b/)) return "keyword";
      if ((w === "has" || w === "changes") && stream.match(/^\s+(only|all|any)\b/)) return "keyword";
      if (KEYWORDS.has(w)) return "keyword";
      if (ATOMS.has(w)) return "atom";
      if (ROOTS.has(w)) return "variableName.special";
      if (stream.peek() === "(") return "function";
      return "variableName";
    }
    if (stream.match(/^(&&|\|\||==|!=|<=|>=|[<>!?:])/)) return "operator";
    stream.next();
    return null;
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--w-syn-keyword)", fontWeight: "600" },
  { tag: tags.comment, color: "var(--w-syn-comment)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--w-syn-string)" },
  { tag: tags.special(tags.string), color: "var(--w-syn-special)" },
  { tag: tags.number, color: "var(--w-syn-number)" },
  { tag: tags.atom, color: "var(--w-syn-number)" },
  { tag: tags.special(tags.variableName), color: "var(--w-syn-var)" },
  { tag: tags.function(tags.variableName), color: "var(--w-syn-fn)" },
  { tag: tags.operator, color: "var(--w-syn-op)" },
]);

// Where the cursor goes after inserting a suggestion: inside [] or '' or the parentheses of a call that
// takes arguments; after the call otherwise.
const TAKES_ARGUMENTS = new Set(["diff", "exists", "get", "size"]);
function apply(s: Suggestion): Completion["apply"] {
  const text = s.insert ?? s.label;
  return (view, _completion, from, to) => {
    let cursor = text.length;
    if (text.includes("[]")) cursor = text.indexOf("[]") + 1;
    else if (text.includes("''")) cursor = text.indexOf("''") + 1;
    else if (text.endsWith("()") && s.type === "function" && (TAKES_ARGUMENTS.has(s.label) || (s.detail !== undefined && s.detail !== "()"))) cursor = text.length - 1;
    else if (text.endsWith("()") && s.label === "diff") cursor = text.length - 1;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursor } });
  };
}

const KINDS: Record<Suggestion["type"], string> = {
  keyword: "keyword", variable: "variable", property: "property", method: "method", function: "function", type: "type",
};

/** Undo / redo from outside the editor (the toolbar). */
export interface RulesCodeEditorHandle {
  undo: () => void;
  redo: () => void;
}

export const RulesCodeEditor = forwardRef<RulesCodeEditorHandle, {
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  /** Whether there's anything to undo / redo, whenever that changes. */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  error: RulesSyntaxError | null;
  subsystem: RuleSubsystem;
  /** The fields of the documents a match pattern covers (cached by the caller). */
  fieldsFor: (pattern: string) => Promise<FieldInfo[]>;
  placeholder?: string;
}>(function RulesCodeEditor({ value, onChange, onBlur, onHistoryChange, error, subsystem, fieldsFor, placeholder }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest props for the long-lived editor's callbacks.
  const props = useRef({ onChange, onBlur, onHistoryChange, subsystem, fieldsFor });
  props.current = { onChange, onBlur, onHistoryChange, subsystem, fieldsFor };

  useImperativeHandle(ref, () => ({
    undo: () => { if (view.current) { undo(view.current); view.current.focus(); } },
    redo: () => { if (view.current) { redo(view.current); view.current.focus(); } },
  }), []);

  useEffect(() => {
    const complete = async (context: CompletionContext) => {
      const text = context.state.doc.toString();
      const ctx = analyze(text, context.pos);
      const charBefore = text[context.pos - 1] ?? "";
      if (!context.explicit && ctx.word === "" && !/[.\s(:,]/.test(charBefore)) return null;
      const pattern = ctx.patterns[ctx.patterns.length - 1];
      let fields: FieldInfo[] = [];
      if (pattern && ctx.where === "condition") {
        try { fields = await props.current.fieldsFor(pattern); } catch { /* suggestions without fields */ }
      }
      const options = suggest(ctx, fields, props.current.subsystem, definedFunctions(text));
      if (options.length === 0) return null;
      return {
        from: ctx.from,
        options: options.map((s): Completion => ({
          label: s.label, type: KINDS[s.type], detail: s.detail, info: s.info, apply: apply(s),
          boost: s.type === "property" && s.info?.startsWith("A field") ? 10 : 0,
        })),
        validFor: /^\w*$/,
      };
    };

    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
          rulesLanguage, syntaxHighlighting(highlight), lintGutter(),
          autocompletion({ override: [complete], activateOnTyping: true, icons: true }),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
          cmPlaceholder(placeholder ?? ""),
          EditorView.contentAttributes.of({ "aria-label": "Rules", spellcheck: "false" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) props.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.transactions.length > 0)
              props.current.onHistoryChange?.(undoDepth(u.state) > 0, redoDepth(u.state) > 0);
          }),
          EditorView.domEventHandlers({ blur: () => { props.current.onBlur?.(); } }),
          EditorView.theme({
            "&": { fontSize: "13px", border: "1px solid var(--w-border)", borderRadius: "6px", background: "var(--w-card)" },
            "&.cm-focused": { outline: "2px solid var(--w-focus)" },
            ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: "360px" },
            ".cm-gutters": { background: "var(--w-hover)", borderRight: "1px solid var(--w-border)", color: "var(--w-faint)" },
            ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--w-accent-soft)", color: "inherit" },
          }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; value changes are pushed below
  }, []);

  // Text from outside (format, a loaded version): replace the document when it differs.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  // The error, underlined where it is.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const from = error ? Math.min(Math.max(error.offset, 0), len) : 0;
    const to = error ? Math.min(from + Math.max(1, /^\w+/.exec(v.state.doc.sliceString(from, from + 40))?.[0].length ?? 1), len) : 0;
    v.dispatch(setDiagnostics(v.state, error ? [{ from, to: Math.max(to, from), severity: "error", message: error.message }] : []));
  }, [error]);

  return <Box ref={host} />;
});
