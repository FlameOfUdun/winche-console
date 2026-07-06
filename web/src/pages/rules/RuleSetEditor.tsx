import { useMemo, useState } from "react";
import { Alert, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import type { RuleSet } from "../../api/rules";
import { MatchTree } from "./MatchTree";
import { normalizeRuleSet } from "./normalize";

type ViewMode = "builder" | "json";

function tryNormalize(json: string): { ruleSet: RuleSet | null; error: string | null } {
  try {
    return { ruleSet: normalizeRuleSet(JSON.parse(json)), error: null };
  } catch (e) {
    return { ruleSet: null, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

/**
 * Editable body of a ruleset with a Builder (GUI tree) / JSON (raw textarea) toggle. `json`/`onChange`
 * stay the source of truth for the parent's draft state (import/export/save/validate all key off the
 * string); Builder mode derives a working `RuleSet` from `json` by defensive normalization and, on every
 * structural edit, re-serializes back into `onChange(JSON.stringify(next, null, 2))` — producing the
 * exact backend-expected PascalCase + lowercase-`kind` shape.
 */
export function RuleSetEditor({ value: _value, json, onChange }: {
  value: RuleSet | null;
  json: string;
  onChange: (json: string) => void;
}) {
  const [mode, setMode] = useState<ViewMode>("builder");

  const { ruleSet, error } = useMemo(() => tryNormalize(json), [json]);
  // Unparseable JSON forces JSON mode — the Builder has nothing it can render.
  const effectiveMode: ViewMode = error ? "json" : mode;

  return (
    <Stack gap="sm">
      <SegmentedControl
        size="xs" w="fit-content"
        data={[{ label: "Builder", value: "builder" }, { label: "JSON", value: "json" }]}
        value={effectiveMode}
        onChange={(v) => setMode(v as ViewMode)}
        disabled={!!error}
      />

      {error && (
        <Alert color="yellow" title="Can't render the Builder view">
          <Text size="sm">The rules JSON isn't valid, so the visual builder can't parse it. Fix it here in JSON mode, then switch back: {error}</Text>
        </Alert>
      )}

      {effectiveMode === "json" || !ruleSet ? (
        <Textarea
          value={json}
          onChange={(e) => onChange(e.currentTarget.value)}
          autosize
          minRows={18}
          maxRows={48}
          aria-label="Rules JSON"
          styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
        />
      ) : (
        <MatchTree ruleSet={ruleSet} onChange={(next) => onChange(JSON.stringify(next, null, 2))} />
      )}
    </Stack>
  );
}
