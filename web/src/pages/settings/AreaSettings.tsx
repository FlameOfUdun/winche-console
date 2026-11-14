import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { AreaSettings, DataArea } from "../../api/dataSettings";
import { when } from "../authentication/UsersView";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** A number field's value; empty stays empty while the user types (the server refuses it if saved). */
export const num = (v: string | number) => (v === "" ? ("" as unknown as number) : Number(v));

/**
 * Database / Storage → Settings: loads an area, keeps a draft, and saves it with a reason. The body edits the draft;
 * changes apply to every server within seconds and are kept in the history below.
 */
export function AreaSettingsView<T>({ area, title, children, optional = false, history = true }: {
  /** Hide (rather than show an error) when the app doesn't have this area. */
  optional?: boolean;
  area: DataArea;
  title: string;
  /** Show the change history under it (off where a settings tab lists it on its own). */
  history?: boolean;
  children: (draft: T, set: (next: T) => void, editable: boolean) => ReactNode;
}) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["data-settings", area], queryFn: () => api.dataSettings<T>(area) });
  const [draft, setDraft] = useState<T | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data) setDraft(clone(saved.data.settings));
  }, [saved.data]);
  const dirty = useMemo(() => !!saved.data && !!draft && JSON.stringify(saved.data.settings) !== JSON.stringify(draft), [saved.data, draft]);

  if (saved.isLoading || (saved.data && !draft)) return <Loader size="sm" />;
  if (optional && saved.isError && (saved.error as { status?: number })?.status === 404) return null;   // this app doesn't have the area
  if (saved.isError || !saved.data || !draft) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const d: AreaSettings<T> = saved.data;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.saveDataSettings(area, draft, reason.trim());
      setReason("");
      setNotice(`Saved as version ${v.number}. It applies to every server within seconds.`);
      for (const key of [["data-settings", area], ["data-settings-history", area]]) await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>{title}</Title>
        {d.source === "console" && d.version && (
          <Text size="xs" c="dimmed" mt={4} data-testid="area-source">
            Version {d.version.number}, {when(d.version.at)}{d.version.by ? ` by ${d.version.by}` : ""}{d.version.reason ? ` — ${d.version.reason}` : ""}
          </Text>
        )}
      </div>
      {!d.editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}

      {children(draft, setDraft, d.editable)}

      {d.editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="area-save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined, position: "sticky", bottom: 8 }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save changes</Button>
                <Button variant="subtle" disabled={busy} onClick={() => { setDraft(clone(d.settings)); setError(null); }}>Discard</Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}

      {history && <AreaHistory area={area} editable={d.editable} />}
    </Stack>
  );
}

export function AreaHistory({ area, editable }: { area: DataArea; editable: boolean }) {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["data-settings-history", area], queryFn: () => api.dataSettingsHistory(area) });
  const [restoring, setRestoring] = useState<{ id: number; number: number } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const versions = history.data?.versions ?? [];
  if (versions.length === 0) return null;

  const restore = async () => {
    if (!restoring) return;
    try {
      await api.restoreDataSettings(restoring.id, reason.trim());
      setRestoring(null);
      setReason("");
      for (const key of [["data-settings", area], ["data-settings-history", area]]) await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorWithList(e));
    }
  };

  return (
    <Stack gap="xs">
      <Text fw={600}>Change history</Text>
      <Paper withBorder style={{ overflowX: "auto" }}>
        <Table verticalSpacing={6} fz="sm" miw={560}>
          <Table.Tbody>
            {versions.map((v) => (
              <Table.Tr key={v.id} data-testid="area-version">
                <Table.Td><Text size="xs">{when(v.at)}</Text></Table.Td>
                <Table.Td><Text size="xs">{v.reset ? "Back to the code's values" : `Version ${v.number}${v.restoredFrom ? ", restored" : ""}`}</Text></Table.Td>
                <Table.Td><Text size="xs">{v.by ?? "—"}</Text></Table.Td>
                <Table.Td><Text size="xs">{v.reason ?? "—"}</Text></Table.Td>
                <Table.Td ta="right">
                  {v.current ? <Badge color="teal" variant="light" tt="none">In use</Badge>
                    : editable && !v.reset ? <Button size="xs" variant="default" onClick={() => setRestoring({ id: v.id, number: v.number })}>Restore</Button> : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {restoring && (
        <Group gap="xs" wrap="wrap">
          <Text size="sm">Restore version {restoring.number}?</Text>
          <TextInput placeholder="Why?" aria-label="Reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button size="xs" disabled={!reason.trim()} onClick={restore}>Restore</Button>
          <Button size="xs" variant="subtle" onClick={() => setRestoring(null)}>Cancel</Button>
          {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        </Group>
      )}
    </Stack>
  );
}

/** A group of fields; with no title, just the box. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        {title && <Text fw={600}>{title}</Text>}
        {children}
      </Stack>
    </Paper>
  );
}
