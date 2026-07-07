import { Alert, Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { CommandSpec, FieldSpec } from "../../api/tabs";
import type { RunOptions } from "../runtime";

export function CommandModal({
  pending, tabId, inputs, onClose, onDone,
}: {
  pending: { cmd: CommandSpec; opts: RunOptions } | null;
  tabId: string; inputs: Record<string, string>;
  onClose: () => void; onDone: (refetch: "tab" | "none") => void;
}) {
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const seed: Record<string, unknown> = {};
    for (const f of pending.cmd.form) seed[f.key] = f.default ?? (f.kind === "boolean" ? false : "");
    setVals(seed);
    setErrors({});
  }, [pending]);

  if (!pending) return null;
  const { cmd, opts } = pending;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    for (const f of cmd.form) {
      const v = vals[f.key];
      if (f.required && (v === "" || v === null || v === undefined)) e[f.key] = `${f.label} is required`;
      else if (typeof v === "string" && f.pattern && v && !new RegExp(f.pattern).test(v)) e[f.key] = `${f.label} is invalid`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Build the payload, omitting blank numeric fields so an optional number binds to its default/null
  // server-side instead of failing to parse "" into an int/double.
  const buildInput = () => {
    const out: Record<string, unknown> = {};
    for (const f of cmd.form) {
      const v = vals[f.key];
      if (f.kind === "number" && (v === "" || v === null || v === undefined)) continue;
      out[f.key] = v;
    }
    return out;
  };

  const submit = async () => {
    if (cmd.form.length > 0 && !validate()) return;
    setBusy(true);
    try {
      const res = await api.consoleTabCommand(tabId, cmd.id, {
        rowKey: opts.rowKey, input: cmd.form.length ? buildInput() : null, inputs,
      });
      if (res.status === "ok") { notifications.show({ color: "green", message: res.message ?? "Done" }); onDone(res.refetch); }
      else if (res.status === "invalid") setErrors(res.fieldErrors);
      else notifications.show({ color: "red", message: res.message ?? "Failed" });
    } catch {
      notifications.show({ color: "red", message: "Request failed" });
    } finally {
      setBusy(false);
    }
  };

  const field = (f: FieldSpec) => {
    const set = (v: unknown) => setVals((p) => ({ ...p, [f.key]: v }));
    // key is passed literally on each element (not via spread) so it survives React's JSX key handling.
    const common = { id: f.key, label: f.label, "aria-label": f.label, error: errors[f.key], withAsterisk: f.required };
    switch (f.kind) {
      case "textarea": return <Textarea key={f.key} {...common} value={String(vals[f.key] ?? "")} onChange={(e) => set(e.currentTarget.value)} />;
      case "number": return <NumberInput key={f.key} {...common} value={vals[f.key] as number} onChange={set} />;
      case "boolean": return <Switch key={f.key} label={f.label} checked={Boolean(vals[f.key])} onChange={(e) => set(e.currentTarget.checked)} />;
      case "select": return <Select key={f.key} {...common} data={f.options ?? []} value={String(vals[f.key] ?? "")} onChange={(v) => set(v ?? "")} />;
      case "date": return <TextInput key={f.key} {...common} type="date" value={String(vals[f.key] ?? "")} onChange={(e) => set(e.currentTarget.value)} />;
      default: return <TextInput key={f.key} {...common} placeholder={f.placeholder ?? ""} value={String(vals[f.key] ?? "")} onChange={(e) => set(e.currentTarget.value)} />;
    }
  };

  const isConfirmOnly = cmd.form.length === 0;
  return (
    <Modal opened onClose={onClose} title={cmd.label} centered>
      <Stack>
        {cmd.confirm && <Text size="sm">{cmd.confirm}</Text>}
        {errors[""] && <Alert color="red" variant="light">{errors[""]}</Alert>}
        {!isConfirmOnly && cmd.form.map(field)}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button color={cmd.confirm && isConfirmOnly ? "red" : undefined} loading={busy} onClick={submit}>
            {cmd.label}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
