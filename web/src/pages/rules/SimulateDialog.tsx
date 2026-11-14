import { useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Modal, Paper, SegmentedControl, Select, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type { RuleOperation, RuleSubsystem } from "../../api/rules";
import { surface } from "../../theme";

const OPERATIONS: RuleOperation[] = ["Get", "List", "Create", "Update", "Delete"];

/** A field's kind, as the rules see it. */
type Kind = "text" | "number" | "yesno" | "time" | "reference" | "null" | "json";
const KINDS: { value: Kind; label: string }[] = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "yesno", label: "Yes / no" },
  { value: "time", label: "Time" }, { value: "reference", label: "Reference" }, { value: "null", label: "Null" },
  { value: "json", label: "List or map (JSON)" },
];
export interface FieldRow { name: string; kind: Kind; value: string }

/** A field as a rule literal (what the server reads): numbers, times and references are tagged. */
export function ruleLiteral(row: FieldRow): unknown {
  const v = row.value.trim();
  switch (row.kind) {
    case "text": return row.value;
    case "number": return /^-?\d+$/.test(v) ? { $integer: v } : { $double: Number(v) };
    case "yesno": return v === "true";
    case "time": return { $timestamp: v ? new Date(v).toISOString() : new Date().toISOString() };
    case "reference": return { $path: v };
    case "null": return null;
    case "json": return JSON.parse(v || "null");
  }
}
/** A claim as plain JSON (what a token carries). */
const plain = (row: FieldRow): unknown =>
  row.kind === "number" ? Number(row.value) : row.kind === "yesno" ? row.value === "true" : row.kind === "json" ? JSON.parse(row.value || "null") : row.value;

function rowsToMap(rows: FieldRow[], convert: (r: FieldRow) => unknown): Record<string, unknown> {
  return Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), convert(r)]));
}

/** Rows of name, kind and value. */
function Fields({ rows, onChange, kinds = KINDS, addLabel, testId }: {
  rows: FieldRow[]; onChange: (rows: FieldRow[]) => void; kinds?: typeof KINDS; addLabel: string; testId: string;
}) {
  const set = (i: number, patch: Partial<FieldRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Stack gap={6} data-testid={testId}>
      {rows.map((r, i) => (
        <Group key={i} gap={6} wrap="nowrap" align="flex-start">
          <TextInput size="xs" placeholder="name" aria-label="Field name" style={{ flex: "0 0 30%" }} styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            value={r.name} onChange={(e) => set(i, { name: e.currentTarget.value })} />
          <Select size="xs" data={kinds} value={r.kind} allowDeselect={false} aria-label="Kind" style={{ flex: "0 0 24%" }}
            onChange={(v) => v && set(i, { kind: v as Kind, value: v === "yesno" ? "true" : v === "null" ? "" : r.value })} />
          {r.kind === "yesno" ? (
            <SegmentedControl size="xs" style={{ flex: 1 }} value={r.value} onChange={(v) => set(i, { value: v })}
              data={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} />
          ) : r.kind === "null" ? (
            <Text size="xs" c={surface.faint} style={{ flex: 1 }} pt={6}>null</Text>
          ) : (
            <TextInput size="xs" aria-label="Value" style={{ flex: 1 }} type={r.kind === "time" ? "datetime-local" : undefined}
              placeholder={r.kind === "reference" ? "users/abc123" : r.kind === "json" ? '["a", "b"] or {"k": 1}' : r.kind === "number" ? "42" : ""}
              styles={r.kind === "text" ? undefined : { input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
              value={r.value} onChange={(e) => set(i, { value: e.currentTarget.value })} />
          )}
          <ActionIcon size="sm" mt={4} variant="subtle" color="gray" aria-label="Remove field" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content" onClick={() => onChange([...rows, { name: "", kind: "text", value: "" }])}>
        {addLabel}
      </Button>
    </Stack>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" mb={8}>
        <Text size="sm" fw={600}>{title}</Text>
        {right}
      </Group>
      {children}
    </Paper>
  );
}

/**
 * Simulating a request against the rules in the editor (saved or not), built the way a real call is: who's asking,
 * the document or file as it is now, and what's being written. What was entered stays between openings.
 */
export function SimulateDialog({ subsystem, rulesJson, opened, onClose }: {
  subsystem: RuleSubsystem; rulesJson: string; opened: boolean; onClose: () => void;
}) {
  const storage = subsystem === "storage";
  const [operation, setOperation] = useState<RuleOperation>("Get");
  const [path, setPath] = useState("");
  const [signedIn, setSignedIn] = useState(true);
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(true);
  const [claims, setClaims] = useState<FieldRow[]>([]);
  const [exists, setExists] = useState(true);
  const fileRows = (): FieldRow[] => [{ name: "mimeType", kind: "text", value: "image/png" }, { name: "sizeBytes", kind: "number", value: "20000" }];
  const [existing, setExisting] = useState<FieldRow[]>(storage ? fileRows() : []);
  const [incoming, setIncoming] = useState<FieldRow[]>(storage ? fileRows() : []);
  const [inputError, setInputError] = useState<string | null>(null);

  const showExisting = operation !== "Create";
  const showIncoming = operation === "Create" || operation === "Update";
  const thing = storage ? "file" : "document";

  const simulate = useMutation({
    mutationFn: () => api.rulesSimulate(subsystem, {
      rulesJson, operation, documentPath: path.trim(), structured: true,
      auth: signedIn && uid.trim() ? {
        uid: uid.trim(),
        claims: { ...(email.trim() ? { email: email.trim(), email_verified: verified } : {}), ...rowsToMap(claims, plain) },
      } : null,
      existing: showExisting && exists ? rowsToMap(existing, ruleLiteral) : null,
      incoming: showIncoming ? rowsToMap(incoming, ruleLiteral) : null,
    }),
  });
  const run = () => {
    setInputError(null);
    try { simulate.mutate(); } catch (e) { setInputError(e instanceof Error ? e.message : String(e)); }
  };
  const requestError = simulate.isError
    ? (simulate.error instanceof ApiError || simulate.error instanceof Error ? simulate.error.message : "Simulation request failed.")
    : null;

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Text fw={700} fz={18}>Simulate a request</Text>}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">Checks the rules as they are in the editor now, saved or not.</Text>
        <Group grow align="flex-end" wrap="wrap">
          <Stack gap={4}>
            <Text size="sm" fw={500}>Operation</Text>
            <SegmentedControl value={operation} onChange={(v) => setOperation(v as RuleOperation)} data={OPERATIONS} aria-label="Operation" />
          </Stack>
          <TextInput label={storage ? "File path" : "Document path"} placeholder={storage ? "users/abc123/avatar.png" : "users/abc123"} data-autofocus
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} value={path} onChange={(e) => setPath(e.currentTarget.value)} />
        </Group>

        <Section title="Who's asking" right={
          <SegmentedControl size="xs" value={signedIn ? "in" : "out"} onChange={(v) => setSignedIn(v === "in")}
            data={[{ value: "out", label: "Signed out" }, { value: "in", label: "Signed in" }]} />
        }>
          {signedIn ? (
            <Stack gap="xs">
              <Group grow align="flex-end">
                <TextInput size="xs" label="User id (request.auth.uid)" placeholder="abc123" value={uid} onChange={(e) => setUid(e.currentTarget.value)}
                  styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
                <TextInput size="xs" label="Email (optional)" placeholder="ann@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
                <Switch size="xs" label="Email verified" checked={verified} disabled={!email.trim()} onChange={(e) => setVerified(e.currentTarget.checked)} mb={6} />
              </Group>
              <Text size="xs" c={surface.muted}>Other token claims (request.auth.token)</Text>
              <Fields rows={claims} onChange={setClaims} addLabel="Add a claim" testId="claims"
                kinds={KINDS.filter((k) => ["text", "number", "yesno", "json"].includes(k.value))} />
            </Stack>
          ) : (
            <Text size="sm" c={surface.muted}>request.auth is null.</Text>
          )}
        </Section>

        {showExisting && (
          <Section title={`The ${thing} now (resource${storage ? "" : ".data"})`} right={
            <Switch size="xs" label="It exists" checked={exists} onChange={(e) => setExists(e.currentTarget.checked)} />
          }>
            {exists ? <Fields rows={existing} onChange={setExisting} addLabel="Add a field" testId="existing" />
              : <Text size="sm" c={surface.muted}>resource is null.</Text>}
          </Section>
        )}
        {showIncoming && (
          <Section title={`What's being written (request.resource${storage ? "" : ".data"})`}>
            <Fields rows={incoming} onChange={setIncoming} addLabel="Add a field" testId="incoming" />
          </Section>
        )}

        {(inputError || requestError) && <Alert color="red" p="xs">{inputError ?? requestError}</Alert>}
        {simulate.data?.error && (
          <Alert color={simulate.data.allowed ? "yellow" : "red"} p="xs" title="Why">
            <Text size="sm" ff="monospace">{simulate.data.error}</Text>
          </Alert>
        )}
        <Group justify="space-between">
          {simulate.data ? (
            <Badge size="lg" color={simulate.data.allowed ? "green" : "red"} variant="light">{simulate.data.allowed ? "Allowed" : "Denied"}</Badge>
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>Close</Button>
            <Button onClick={run} loading={simulate.isPending} disabled={!path.trim() || (signedIn && !uid.trim())}>Simulate</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
