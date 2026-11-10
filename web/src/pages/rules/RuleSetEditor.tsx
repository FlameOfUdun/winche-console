import { useEffect, useRef, useState } from "react";
import { Loader, Stack, Text, Textarea } from "@mantine/core";
import { api } from "../../api/client";
import type { RulesSyntaxError } from "../../api/rules";

const PARSE_DELAY_MS = 300;

/** rulesJson in a canonical form, so the same rules compare equal however they were spaced. */
function canonical(json: string): string {
  try { return JSON.stringify(JSON.parse(json)); } catch { return json; }
}

/**
 * The ruleset as one rules file (Winche.Rules' text syntax):
 *
 *   match users/{uid} {
 *     allow read: if request.auth.uid == uid;
 *   }
 *
 * `json` (rulesJson) stays the parent's draft and what's saved; the server parses the text into it and
 * formats it back, so the editor reads rules exactly as the engine does. While the text has an error, or
 * hasn't been checked yet, the draft keeps the last valid rules and `onValidityChange(false)` tells the
 * parent to block Save — so what's saved is always what's on screen.
 */
export function RuleSetEditor({ json, onChange, onValidityChange }: {
  json: string;
  onChange: (json: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<RulesSyntaxError | string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  // The rules the text currently stands for: a draft that comes back from our own onChange isn't
  // re-formatted (that would rewrite what's being typed and move the cursor).
  const shown = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  // Format when the draft changes from outside: first load, import, a loaded or reverted version.
  useEffect(() => {
    const draft = canonical(json);
    if (draft === shown.current) return;
    let cancelled = false;
    api.rulesFormatText(json)
      .then(({ text: formatted }) => {
        if (cancelled) return;
        shown.current = draft;
        setText(formatted);
        setError(null);
        setWarnings([]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not show these rules as text."));
    return () => { cancelled = true; };
  }, [json]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => onValidityChange(text !== null && !pending && error === null), [text, pending, error, onValidityChange]);

  const onText = (next: string) => {
    setText(next);
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    const call = ++latest.current;
    timer.current = setTimeout(async () => {
      try {
        const result = await api.rulesParseText(next);
        if (call !== latest.current) return;   // a newer edit is on its way
        if (result.ok && result.rulesJson) {
          shown.current = canonical(result.rulesJson);
          setError(null);
          setWarnings(result.warnings);
          onChange(JSON.stringify(JSON.parse(result.rulesJson), null, 2));
        } else {
          setError(result.error);
          setWarnings([]);
        }
      } catch (e) {
        if (call === latest.current) setError(e instanceof Error ? e.message : "Could not check the rules.");
      } finally {
        if (call === latest.current) setPending(false);
      }
    }, PARSE_DELAY_MS);
  };

  if (text === null && error === null) return <Loader size="sm" />;

  return (
    <Stack gap={6}>
      <Textarea
        value={text ?? ""}
        onChange={(e) => onText(e.currentTarget.value)}
        autosize minRows={18} maxRows={60}
        spellCheck={false}
        aria-label="Rules"
        placeholder={"match users/{uid} {\n  allow read: if request.auth.uid == uid;\n}"}
        error={error !== null}
        styles={{ input: { fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 } }} />
      {error !== null && (
        <Text size="sm" c="red" role="alert">
          {typeof error === "string" ? error : `Line ${error.line}, column ${error.column}: ${error.message}`}
        </Text>
      )}
      {warnings.map((w) => <Text key={w} size="sm" c="orange">{w}</Text>)}
      <Text size="xs" c="dimmed">
        Operations: read (get, list), write (create, update, delete). Functions: keys(), hasOnly(), diff(...).affectedKeys(),
        x is string, matches(), size(), get(key, default), exists(), get(path). Comments (//) aren't saved.
      </Text>
    </Stack>
  );
}
