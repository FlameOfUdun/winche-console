import { SavedVersion } from "../../components/SectionTitle";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text, TextInput, Timeline, Title } from "@mantine/core";
import { IconArrowBackUp, IconCheck, IconHistory } from "@tabler/icons-react";
import { EmptyState } from "../../components/EmptyState";
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
  /** The body; `block` stops saving with a reason (an unparsable text), or lets it again with null. */
  children: (draft: T, set: (next: T) => void, editable: boolean, block: (why: string | null) => void) => ReactNode;
}) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["data-settings", area], queryFn: () => api.dataSettings<T>(area) });
  const [draft, setDraft] = useState<T | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

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
        <SavedVersion version={d.source === "console" ? d.version : null} testId="area-source" />
      </div>
      {!d.editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}

      {children(draft, setDraft, d.editable, setBlocked)}

      {d.editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="area-save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined, position: "sticky", bottom: 8 }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim() || !!blocked} onClick={save} title={blocked ?? undefined}>Save changes</Button>
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

/** The versions an area's settings went through, newest first, as a timeline; restore one in a dialog. */
export function AreaHistory({ area, editable, empty = true }: { area: DataArea; editable: boolean; empty?: boolean }) {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["data-settings-history", area], queryFn: () => api.dataSettingsHistory(area) });
  const [restoring, setRestoring] = useState<{ id: number; number: number } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const versions = history.data?.versions ?? [];
  if (history.isLoading) return <Loader size="sm" />;
  if (versions.length === 0) {
    return empty
      ? <EmptyState icon={IconHistory} title="No changes yet" description="Saved changes show up here: who made them, when and why." />
      : null;
  }

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
    <Paper withBorder radius="md" p="lg">
      <Timeline active={versions.findIndex((v) => v.current)} color="teal" bulletSize={26} lineWidth={2}>
        {versions.map((v) => (
          <Timeline.Item key={v.id} data-testid="area-version"
            bullet={v.current ? <IconCheck size={14} /> : v.reset ? <IconArrowBackUp size={14} /> : <IconHistory size={14} />}
            color={v.current ? "teal" : "gray"}
            title={
              <Group gap={8} justify="space-between" wrap="nowrap">
                <Group gap={8}>
                  <Text fw={600} size="sm">{v.reset ? "Back to the defaults" : `Version ${v.number}`}</Text>
                  {v.restoredFrom && <Badge size="xs" variant="light" color="gray" tt="none">restored</Badge>}
                  {v.current && <Badge size="xs" variant="light" color="teal" tt="none">In use</Badge>}
                </Group>
                {!v.current && editable && !v.reset && (
                  <Button size="compact-xs" variant="subtle" onClick={() => setRestoring({ id: v.id, number: v.number })}>Restore</Button>
                )}
              </Group>
            }>
            <Text size="xs" c="dimmed">{when(v.at)}{v.by ? ` · ${v.by}` : ""}</Text>
            {v.reason && <Text size="sm" mt={4} style={{ fontStyle: "italic" }}>“{v.reason}”</Text>}
          </Timeline.Item>
        ))}
      </Timeline>
      <Modal opened={!!restoring} onClose={() => setRestoring(null)} radius="lg" title={<Text fw={700} fz={18}>Restore version {restoring?.number}?</Text>}>
        <Stack gap="md">
          <TextInput label="Why?" data-autofocus value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setRestoring(null)}>Cancel</Button>
            <Button disabled={!reason.trim()} onClick={restore}>Restore</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
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
