import { useEffect, useRef, useState } from "react";
import { Loader, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import { api } from "../../api/client";
import type { ConditionSyntaxError, RuleExpression } from "../../api/rules";
import { ExpressionBuilder } from "./ExpressionBuilder";
import { useReportConditionValidity } from "./conditionValidity";

type Mode = "text" | "builder";

const PARSE_DELAY_MS = 300;

/**
 * A rule condition, edited as text (the Winche.Rules syntax, e.g.
 * `request.auth.uid == uid && request.resource.data.keys().hasOnly(['name'])`) or with the tree builder.
 * The server parses and formats, so the console and the engine read the text the same way. While the
 * text has an error (or hasn't been checked yet) the draft keeps the last valid condition and Save is
 * blocked (see conditionValidity).
 */
export function ConditionEditor({ value, onChange }: { value: RuleExpression; onChange: (next: RuleExpression) => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<ConditionSyntaxError | string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  // The JSON of the expression the text currently stands for, so a value that comes back from our own
  // onChange isn't re-formatted (which would move the cursor / rewrite what the user typed).
  const shown = useRef<string | null>(null);
  const valueJson = JSON.stringify(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  // (Re)format when the condition changes from outside: first load, the builder, a loaded version.
  useEffect(() => {
    if (mode !== "text" || valueJson === shown.current) return;
    let cancelled = false;
    api.rulesFormatText(valueJson)
      .then(({ text: formatted }) => {
        if (cancelled) return;
        shown.current = valueJson;
        setText(formatted);
        setError(null);
        setWarnings([]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not show this condition as text."));
    return () => { cancelled = true; };
  }, [valueJson, mode]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useReportConditionValidity(mode === "text" && (pending || error !== null || text === null));

  const onText = (next: string) => {
    setText(next);
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    const call = ++latest.current;
    timer.current = setTimeout(async () => {
      try {
        const result = await api.rulesParseText(next);
        if (call !== latest.current) return;   // a newer edit is on its way
        if (result.ok && result.expressionJson) {
          const parsed = JSON.parse(result.expressionJson) as RuleExpression;
          shown.current = JSON.stringify(parsed);
          setError(null);
          setWarnings(result.warnings);
          onChange(parsed);
        } else {
          setError(result.error);
          setWarnings([]);
        }
      } catch (e) {
        if (call === latest.current) setError(e instanceof Error ? e.message : "Could not check the condition.");
      } finally {
        if (call === latest.current) setPending(false);
      }
    }, PARSE_DELAY_MS);
  };

  const canSwitch = !pending && error === null;

  return (
    <Stack gap={4}>
      <SegmentedControl size="xs" w="fit-content"
        data={[{ label: "Text", value: "text" }, { label: "Builder", value: "builder" }]}
        value={mode}
        onChange={(m) => { if (canSwitch || m === "text") setMode(m as Mode); }}
        disabled={!canSwitch && mode === "text"}
        aria-label="Condition editor mode" />

      {mode === "builder" ? (
        <ExpressionBuilder value={value} onChange={onChange} />
      ) : text === null && error === null ? (
        <Loader size="xs" />
      ) : (
        <>
          <Textarea
            value={text ?? ""}
            onChange={(e) => onText(e.currentTarget.value)}
            autosize minRows={1} maxRows={16}
            spellCheck={false}
            aria-label="Condition"
            error={error !== null}
            styles={{ input: { fontFamily: "monospace", fontSize: 13 } }} />
          {error !== null && (
            <Text size="xs" c="red" role="alert">
              {typeof error === "string" ? error : `Line ${error.line}, column ${error.column}: ${error.message}`}
            </Text>
          )}
          {warnings.map((w) => <Text key={w} size="xs" c="orange">{w}</Text>)}
        </>
      )}
    </Stack>
  );
}
