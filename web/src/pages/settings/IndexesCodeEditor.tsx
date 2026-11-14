import { useEffect, useRef } from "react";
import { Box } from "@mantine/core";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import type { IndexTextError } from "../../api/indexText";

const KEYWORDS = new Set(["collection", "group", "index", "expire", "when"]);
const MODIFIERS = new Set(["asc", "desc", "contains"]);

/** Colours for the index language (a small tokenizer; the server is what parses it). */
const indexLanguage = StreamLanguage.define<{ afterCollection: boolean }>({
  startState: () => ({ afterCollection: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^`[^`]*`?/)) return "propertyName";
    const word = stream.match(/^[A-Za-z_][\w-]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (w === "collection") { state.afterCollection = true; return "keyword"; }
      if (state.afterCollection && w === "group") return "keyword";
      if (state.afterCollection) { state.afterCollection = false; return "string.special"; }
      if (KEYWORDS.has(w)) return "keyword";
      if (MODIFIERS.has(w)) return "atom";
      return "propertyName";
    }
    if (stream.match(/^[{}(),.]/)) return "operator";
    stream.next();
    return null;
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#7c3aed", fontWeight: "600" },
  { tag: tags.comment, color: "#8a8f98", fontStyle: "italic" },
  { tag: tags.special(tags.string), color: "#1d4ed8", fontWeight: "600" },
  { tag: tags.atom, color: "#b45309" },
  { tag: tags.propertyName, color: "#0f172a" },
  { tag: tags.operator, color: "#9ca3af" },
]);

/** Where the cursor is: in a block (and which collection), between parentheses, or after `when`. */
function context(text: string, pos: number) {
  const before = text.slice(0, pos).replace(/\/\/[^\n]*/g, "");
  const opens = [...before.matchAll(/collection\s+(?:group\s+)?([A-Za-z_][\w-]*|`[^`]*`)\s*\{/g)];
  const lastOpen = opens.at(-1);
  const inBlock = !!lastOpen && before.lastIndexOf("}") < (lastOpen.index ?? 0);
  const inParens = before.lastIndexOf("(") > before.lastIndexOf(")");
  const afterWhen = /\bwhen\s+[\w.`-]*$/.test(before);
  return { inBlock, inParens, afterWhen, collection: lastOpen?.[1].replace(/`/g, "") ?? null };
}

/**
 * The editor for Database → Indexes and expiry: highlighting, completion (keywords; inside an index or after `when`,
 * the collection's fields), and the server's error underlined where it is.
 */
export function IndexesCodeEditor({ value, onChange, error, fieldsFor, readOnly = false }: {
  value: string; onChange: (text: string) => void; error: IndexTextError | null;
  fieldsFor: (collection: string) => Promise<string[]>; readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef({ onChange, fieldsFor });
  props.current = { onChange, fieldsFor };

  useEffect(() => {
    const complete = async (cc: CompletionContext) => {
      const word = cc.matchBefore(/[\w.`-]*/);
      if (!word || (word.from === word.to && !cc.explicit)) return null;
      const ctx = context(cc.state.doc.toString(), cc.pos);
      if ((ctx.inParens || ctx.afterWhen) && ctx.collection) {
        let fields: string[] = [];
        try { fields = await props.current.fieldsFor(ctx.collection); } catch { /* keywords only */ }
        const options = fields.map((f) => ({ label: f, type: "property" }));
        if (ctx.inParens) options.push(...["desc", "contains"].map((k) => ({ label: k, type: "keyword" })));
        return { from: word.from, options, validFor: /^[\w.`-]*$/ };
      }
      const options = ctx.inBlock
        ? [{ label: "index", type: "keyword", apply: "index ()" }, { label: "expire when", type: "keyword", apply: "expire when " }]
        : [{ label: "collection", type: "keyword", apply: "collection " }, { label: "collection group", type: "keyword", apply: "collection group " }];
      return { from: word.from, options, validFor: /^\w*$/ };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
          indexLanguage, syntaxHighlighting(highlight), lintGutter(),
          autocompletion({ override: [complete], activateOnTyping: true, icons: true }),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
          cmPlaceholder("collection sessions {\n  index (userId, startedAt desc)\n  expire when expiresAt\n}"),
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ "aria-label": "Indexes and expiry", spellcheck: "false" }),
          EditorView.updateListener.of((u) => { if (u.docChanged) props.current.onChange(u.state.doc.toString()); }),
          EditorView.theme({
            "&": { fontSize: "13px", borderRadius: "10px", background: "#fff" },
            "&.cm-focused": { outline: "2px solid #a5b4fc" },
            ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: "280px", padding: "10px 0" },
            ".cm-gutters": { background: "#F9FAFB", borderRight: "1px solid #EAECF0", color: "#adb5bd", borderRadius: "10px 0 0 10px" },
            ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#eef2ff", color: "inherit" },
          }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; value changes are pushed below
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const from = error ? Math.min(Math.max(error.offset, 0), len) : 0;
    const to = error ? Math.min(from + Math.max(1, /^[\w`]+/.exec(v.state.doc.sliceString(from, from + 40))?.[0].length ?? 1), len) : 0;
    v.dispatch(setDiagnostics(v.state, error ? [{ from, to: Math.max(to, from), severity: "error", message: error.message }] : []));
  }, [error]);

  return <Box ref={host} style={{ border: "1px solid #EAECF0", borderRadius: 10 }} />;
}
