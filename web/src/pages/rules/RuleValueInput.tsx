import { useEffect, useState } from "react";
import { Group, NumberInput, Select, SegmentedControl, Text, TextInput } from "@mantine/core";
import type { RuleValue } from "../../api/rules";

// Mirrors the tagged-JSON convention in Winche.Rules.Json.RuleValueJsonConverter: plain JSON for
// null/bool/string, `{"$integer":"<digits>"}` (string!) and `{"$double":<number>}` for numerics, and
// tags this editor doesn't special-case ($timestamp/$bytes/$path, plus maps/lists) go through the
// Advanced raw-JSON escape hatch.
type ValueVariant = "String" | "Boolean" | "Integer" | "Double" | "Null" | "Advanced";

const VARIANT_OPTIONS = ["String", "Boolean", "Integer", "Double", "Null", "Advanced"].map((v) => ({ value: v, label: v }));

function isTaggedInteger(v: unknown): v is { $integer: string } {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.$integer === "string";
}
function isTaggedDouble(v: unknown): v is { $double: number } {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.$double === "number";
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function detectVariant(v: RuleValue): ValueVariant {
  if (v === null || v === undefined) return "Null";
  if (typeof v === "boolean") return "Boolean";
  if (typeof v === "string") return "String";
  if (isTaggedInteger(v)) return "Integer";
  if (isTaggedDouble(v)) return "Double";
  return "Advanced";
}

function defaultForVariant(variant: ValueVariant): RuleValue {
  switch (variant) {
    case "String": return "";
    case "Boolean": return true;
    case "Integer": return { $integer: "0" };
    case "Double": return { $double: 0 };
    case "Null": return null;
    case "Advanced": return {};
  }
}

/** Editor for one `RuleValue` (the payload of a `literal` expression node). */
export function RuleValueInput({ value, onChange }: { value: RuleValue; onChange: (v: RuleValue) => void }) {
  const variant = detectVariant(value);
  const [advancedText, setAdvancedText] = useState(() => JSON.stringify(value ?? null));
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  // Keep the Advanced textbox in sync when the value changes from outside (e.g. switching kinds).
  useEffect(() => {
    if (variant === "Advanced") { setAdvancedText(JSON.stringify(value ?? null)); setAdvancedError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onVariantChange = (v: string | null) => {
    if (!v || v === variant) return;
    onChange(defaultForVariant(v as ValueVariant));
  };

  const commitAdvanced = () => {
    try {
      const parsed = JSON.parse(advancedText);
      setAdvancedError(null);
      onChange(parsed);
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <Group gap={6} align="flex-start" wrap="wrap">
      <Select size="xs" w={110} data={VARIANT_OPTIONS} value={variant} onChange={onVariantChange}
        allowDeselect={false} aria-label="Value type" />
      {variant === "String" && (
        <TextInput size="xs" style={{ flex: 1, minWidth: 140 }} value={value as string}
          onChange={(e) => onChange(e.currentTarget.value)} />
      )}
      {variant === "Boolean" && (
        <SegmentedControl size="xs" data={[{ label: "true", value: "true" }, { label: "false", value: "false" }]}
          value={value ? "true" : "false"} onChange={(v) => onChange(v === "true")} />
      )}
      {variant === "Integer" && (
        <TextInput size="xs" w={140} ff="monospace" inputMode="numeric"
          value={(value as { $integer: string }).$integer}
          onChange={(e) => onChange({ $integer: e.currentTarget.value })} />
      )}
      {variant === "Double" && (
        <NumberInput size="xs" w={140} value={(value as { $double: number }).$double}
          onChange={(v) => onChange({ $double: typeof v === "number" ? v : 0 })} />
      )}
      {variant === "Null" && <Text size="xs" c="dimmed">null</Text>}
      {variant === "Advanced" && (
        <TextInput size="xs" ff="monospace" style={{ flex: 1, minWidth: 220 }}
          placeholder='e.g. {"$timestamp":"2026-01-01T00:00:00Z"}'
          value={advancedText} onChange={(e) => setAdvancedText(e.currentTarget.value)}
          onBlur={commitAdvanced} error={advancedError} />
      )}
    </Group>
  );
}
