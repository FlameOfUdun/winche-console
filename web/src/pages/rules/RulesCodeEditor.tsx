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
const rulesLanguage = StreamLanguage.define<{ inPath: boolean }>({
  startState: () => ({ inPath: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (state.inPath) {
      state.inPath = false;
      if (stream.match(/^\S+?(?=\s*\{|\s|$)/)) return "string.special";
    }
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
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
  { tag: tags.keyword, color: "#7c3aed", fontWeight: "600" },
  { tag: tags.comment, color: "#8a8f98", fontStyle: "italic" },
  { tag: tags.string, color: "#0f7b3f" },
  { tag: tags.special(tags.string), color: "#1d4ed8" },
  { tag: tags.number, color: "#b45309" },
  { tag: tags.atom, color: "#b45309" },
  { tag: tags.special(tags.variableName), color: "#be185d" },
  { tag: tags.function(tags.variableName), color: "#0e7490" },
  { tag: tags.operator, color: "#6b7280" },
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
            "&": { fontSize: "13px", border: "1px solid #dee2e6", borderRadius: "6px", background: "#fff" },
            "&.cm-focused": { outline: "2px solid #a5b4fc" },
            ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: "360px" },
            ".cm-gutters": { background: "#F9FAFB", borderRight: "1px solid #eee", color: "#adb5bd" },
            ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#eef2ff", color: "inherit" },
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
