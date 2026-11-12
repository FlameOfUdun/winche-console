import { useEffect, useRef } from "react";
import { Box } from "@mantine/core";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";

/** A TypeScript editor for one file; the parent owns the text. */
export function CodeEditor({ value, onChange, readOnly = false, label }: { value: string; onChange?: (v: string) => void; readOnly?: boolean; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle), javascript({ typescript: true }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => { if (u.docChanged) change.current?.(u.state.doc.toString()); }),
          EditorView.theme({ "&": { fontSize: "13px", height: "100%" }, ".cm-scroller": { fontFamily: "var(--mantine-font-family-monospace)" } }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // A new editor per file (label) and mode; text changes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, readOnly]);

  // Text replaced from outside (discard, a version opened): reset the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <Box ref={host} h={460} style={{ border: "1px solid var(--mantine-color-gray-4)", borderRadius: 6, overflow: "hidden" }} data-testid="code-editor" />;
}
