import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActionIcon, Button, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react";
import type { RulesCodeEditorHandle } from "./RulesCodeEditor";
import { api } from "../../api/client";
import type { RuleSubsystem, RulesSyntaxError } from "../../api/rules";
// CodeMirror is most of the console's JavaScript: load it only when the rules are opened.
const RulesCodeEditor = lazy(() => import("./RulesCodeEditor").then((m) => ({ default: m.RulesCodeEditor })));
import type { FieldInfo } from "./rulesCompletion";

/** rulesJson in a canonical form, so the same rules compare equal however they were spaced. */
function canonical(json: string): string {
  try { return JSON.stringify(JSON.parse(json)); } catch { return json; }
}

/**
 * What an empty ruleset shows: explicit deny-all, as Firebase starts. The engine denies anything no rule
 * allows, so this says what's already true; it counts as unedited (saving it changes nothing).
 */
export const DENY_ALL_TEMPLATE =
  "// No rules yet: everything is denied. Rules only allow — add a match with an allow to open access.\n" +
  "match {path=**} {\n" +
  "  allow read, write: if false;\n" +
  "}\n";

/** What the parent can ask of the editor. */
export interface RuleSetEditorHandle {
  /**
   * Checks the text now. Valid: the draft becomes these rules (via onChange) and their rulesJson is
   * returned. Not valid: the error is shown in the editor and null is returned.
   */
  check: () => Promise<string | null>;
}

/**
 * The ruleset as one rules file (Winche.Rules' text syntax):
 *
 *   match users/{uid} {
 *     allow read: if request.auth.uid == uid;
 *   }
 *
 * `json` (rulesJson) stays the parent's draft and what's saved; the server parses the text into it and
 * formats it back, so the editor reads rules exactly as the engine does. Checking is lazy — nothing is
 * sent while typing: the text is checked when the editor loses focus, on Format, and when the parent
 * calls check() (Save does), so what's saved is always what's on screen.
 */
export const RuleSetEditor = forwardRef<RuleSetEditorHandle, {
  subsystem: RuleSubsystem;
  json: string;
  onChange: (json: string) => void;
  /** Whether the text has changes not yet checked into the draft. */
  onEditedChange?: (edited: boolean) => void;
}>(function RuleSetEditor({ subsystem, json, onChange, onEditedChange }, ref) {
  const [text, setText] = useState<string | null>(null);
  const textRef = useRef<string | null>(null);
  textRef.current = text;
  const [error, setError] = useState<RulesSyntaxError | string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  // The rules the draft currently holds, and the text that was last checked into it: a draft that comes
  // back from our own onChange isn't re-formatted (that would rewrite the text and move the cursor), and
  // unchanged text isn't checked again.
  const shown = useRef<string | null>(null);
  const checkedText = useRef<string | null>(null);
  const [edited, setEdited] = useState(false);
  const code = useRef<RulesCodeEditorHandle>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const onHistoryChange = useCallback((u: boolean, r: boolean) => { setCanUndo(u); setCanRedo(r); }, []);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => onEditedChange?.(edited), [edited, onEditedChange]);

  // Format when the draft changes from outside: first load, a loaded or reverted version.
  useEffect(() => {
    const draft = canonical(json);
    if (draft === shown.current) return;
    let cancelled = false;
    api.rulesFormatText(json)
      .then(({ text: formatted }) => {
        if (cancelled) return;
        const shownText = formatted.trim() === "" ? DENY_ALL_TEMPLATE : formatted;
        shown.current = draft;
        checkedText.current = shownText;
        setText(shownText);
        setEdited(false);
        setError(null);
        setWarnings([]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not show these rules as text."));
    return () => { cancelled = true; };
  }, [json]);

  // Field suggestions: one sample per match pattern, kept for the session of this editor.
  const fieldCache = useRef(new Map<string, Promise<FieldInfo[]>>());
  const fieldsFor = useCallback((pattern: string) => {
    let fields = fieldCache.current.get(pattern);
    if (!fields) {
      fields = api.rulesFields(subsystem, pattern).then((r) => r.fields);
      fieldCache.current.set(pattern, fields);
      fields.catch(() => fieldCache.current.delete(pattern));
    }
    return fields;
  }, [subsystem]);

  const check = useCallback(async (): Promise<string | null> => {
    const current = textRef.current;
    if (current === null) return null;
    if (current === checkedText.current && shown.current !== null) return json;   // nothing new to check
    setChecking(true);
    try {
      const result = await api.rulesParseText(current);
      if (textRef.current !== current) return null;   // edited again while checking
      if (!result.ok || !result.rulesJson) {
        setError(result.error);
        setWarnings([]);
        return null;
      }
      const pretty = JSON.stringify(JSON.parse(result.rulesJson), null, 2);
      shown.current = canonical(result.rulesJson);
      checkedText.current = current;
      setEdited(false);
      setError(null);
      setWarnings(result.warnings);
      onChange(pretty);
      return pretty;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the rules.");
      return null;
    } finally {
      setChecking(false);
    }
  }, [json, onChange]);

  useImperativeHandle(ref, () => ({ check }), [check]);

  const onFormat = async () => {
    const checked = await check();
    if (checked === null) return;
    const { text: formatted } = await api.rulesFormatText(checked);
    checkedText.current = formatted;
    setText(formatted);
  };

  const onText = (next: string) => {
    if (next === textRef.current) return;   // the editor echoing text we set (load, format)
    setText(next);
    setEdited(next !== checkedText.current);
    setError(null);   // a stale position would point at the wrong place; checked again on blur / Save
  };

  if (text === null && error === null) return <Loader size="sm" />;

  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Ctrl+Space for suggestions — field names come from documents each match covers. Checked when you leave the editor or save.</Text>
        <Group gap={4}>
          <Tooltip label={`Undo (${mac ? "⌘Z" : "Ctrl+Z"})`}>
            <ActionIcon variant="default" size="md" aria-label="Undo" disabled={!canUndo} onClick={() => code.current?.undo()}>
              <IconArrowBackUp size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={`Redo (${mac ? "⌘⇧Z" : "Ctrl+Y"})`}>
            <ActionIcon variant="default" size="md" aria-label="Redo" disabled={!canRedo} onClick={() => code.current?.redo()}>
              <IconArrowForwardUp size={16} />
            </ActionIcon>
          </Tooltip>
          <Button size="xs" variant="default" onClick={onFormat} loading={checking}>Format</Button>
        </Group>
      </Group>
      <Suspense fallback={<Loader size="sm" />}>
      <RulesCodeEditor
        ref={code}
        onHistoryChange={onHistoryChange}
        value={text ?? ""}
        onChange={onText}
        onBlur={() => { void check(); }}
        error={typeof error === "object" ? error : null}
        subsystem={subsystem}
        fieldsFor={fieldsFor}
        placeholder={"match users/{uid} {\n  allow read: if request.auth.uid == uid;\n}"} />
      </Suspense>
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
});
