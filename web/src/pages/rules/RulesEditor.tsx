import { useMemo, useState } from "react";
import {
  Alert, Badge, Box, Button, Drawer, FileButton, Group, Loader, Menu, Modal, Stack, Table, Text,
  TextInput, Textarea,
} from "@mantine/core";
import {
  IconAlertTriangle, IconChevronDown, IconClipboard, IconDownload, IconFileImport, IconHistory, IconUpload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type {
  RuleSet, RuleSubsystem, RuleValidationError, RuleVersionDetail, RuleVersionSummary,
} from "../../api/rules";
import { ConfirmModal } from "../../components/ConfirmModal";
import { RuleSetEditor } from "./RuleSetEditor";
import { SimulatePanel } from "./SimulatePanel";

/** Pretty-prints rulesJson for editing; falls back to the raw text if it somehow isn't valid JSON. */
function prettyOrRaw(rulesJson: string): string {
  try { return JSON.stringify(JSON.parse(rulesJson), null, 2); }
  catch { return rulesJson; }
}

const liveKey = (sys: RuleSubsystem) => ["rules-live", sys] as const;
const versionsKey = (sys: RuleSubsystem) => ["rules-versions", sys] as const;
const subsystemsKey = ["rules-subsystems"] as const;

export function RulesEditor({ subsystem }: { subsystem: RuleSubsystem }) {
  const qc = useQueryClient();

  const live = useQuery({ queryKey: liveKey(subsystem), queryFn: () => api.rulesLive(subsystem) });
  const versions = useQuery({ queryKey: versionsKey(subsystem), queryFn: () => api.rulesVersions(subsystem) });
  const subsystems = useQuery({ queryKey: subsystemsKey, queryFn: api.rulesSubsystems });
  const status = subsystems.data?.find((s) => s.id === subsystem);

  const [draftJson, setDraftJson] = useState<string | null>(null);
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
  if (live.data && draftJson === null) {
    // Lazily seed the draft the first time live rules arrive. Deliberately NOT keyed to every
    // live.data change — background refetches must never clobber an in-progress edit.
    const pretty = prettyOrRaw(live.data.rulesJson);
    setDraftJson(pretty);
    setBaselineJson(pretty);
  }
  const dirty = draftJson !== null && draftJson !== baselineJson;

  const parsed = useMemo((): { value: RuleSet | null; error: string | null } => {
    if (draftJson === null) return { value: null, error: null };
    try { return { value: JSON.parse(draftJson) as RuleSet, error: null }; }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : "Invalid JSON" }; }
  }, [draftJson]);

  const [validationErrors, setValidationErrors] = useState<RuleValidationError[] | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [note, setNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<RuleValidationError[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RuleVersionSummary | null>(null);

  // Refetch live rules and reset the draft/baseline to match — used after save/revert/apply-head
  // (whose responses may not include the full rulesJson) and after a 409 conflict on save.
  const resyncDraftFromLive = async () => {
    const fresh = await qc.fetchQuery({ queryKey: liveKey(subsystem), queryFn: () => api.rulesLive(subsystem) });
    const pretty = prettyOrRaw(fresh.rulesJson);
    setDraftJson(pretty);
    setBaselineJson(pretty);
  };

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: liveKey(subsystem) }),
      qc.invalidateQueries({ queryKey: versionsKey(subsystem) }),
      qc.invalidateQueries({ queryKey: subsystemsKey }),
    ]);
  };

  const validateMutation = useMutation({
    mutationFn: (json: string) => api.rulesValidate(subsystem, json),
  });

  const activeVersion = versions.data?.find((v) => v.isActive)?.version;

  const saveMutation = useMutation({
    mutationFn: (body: { rulesJson: string; note?: string; expectedHeadVersion?: number }) => api.rulesSave(subsystem, body),
    onSuccess: async (detail: RuleVersionDetail) => {
      await invalidateAll();
      const pretty = prettyOrRaw(detail.rulesJson);
      setDraftJson(pretty);
      setBaselineJson(pretty);
      setNoteModalOpen(false);
      setNote("");
      notifications.show({ color: "green", message: `Saved as version ${detail.version} and applied live.` });
    },
    onError: async (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) {
        await invalidateAll();
        await resyncDraftFromLive();
        setNoteModalOpen(false);
        notifications.show({ color: "yellow", message: "Rules were changed by someone else — reloaded." });
      } else {
        notifications.show({ color: "red", message: e instanceof Error ? e.message : "Save failed." });
      }
    },
  });

  const revertMutation = useMutation({
    mutationFn: (version: number) => api.rulesRevert(subsystem, version),
    onSuccess: async (detail: RuleVersionDetail) => {
      await invalidateAll();
      const pretty = prettyOrRaw(detail.rulesJson);
      setDraftJson(pretty);
      setBaselineJson(pretty);
      setRevertTarget(null);
      notifications.show({ color: "green", message: `Reverted to version ${detail.version}.` });
    },
    onError: () => notifications.show({ color: "red", message: "Revert failed." }),
  });

  const applyHeadMutation = useMutation({
    mutationFn: () => api.rulesApplyHead(subsystem),
    onSuccess: async () => {
      await invalidateAll();
      await resyncDraftFromLive();
      notifications.show({ color: "green", message: "Applied the saved version live." });
    },
    onError: () => notifications.show({ color: "red", message: "Apply failed." }),
  });

  const viewVersionMutation = useMutation({
    mutationFn: (version: number) => api.rulesVersion(subsystem, version),
    onSuccess: (detail: RuleVersionDetail) => {
      // Loading an old version into the draft is a deliberate edit — baseline stays put so Save
      // (or discarding by navigating away) behaves correctly.
      setDraftJson(prettyOrRaw(detail.rulesJson));
      setHistoryOpen(false);
    },
    onError: () => notifications.show({ color: "red", message: "Could not load that version." }),
  });

  const onClickSave = async () => {
    if (draftJson === null || parsed.error) return;
    setValidationErrors(null);
    const result = await validateMutation.mutateAsync(draftJson);
    if (!result.ok) { setValidationErrors(result.errors); return; }
    setNoteModalOpen(true);
  };

  const confirmSave = () => {
    if (draftJson === null) return;
    saveMutation.mutate({ rulesJson: draftJson, note: note.trim() || undefined, expectedHeadVersion: activeVersion });
  };

  const onExportCopy = async () => {
    if (draftJson === null) return;
    await navigator.clipboard.writeText(draftJson);
    notifications.show({ color: "blue", message: "Copied rules JSON to clipboard." });
  };

  const onExportDownload = () => {
    if (draftJson === null) return;
    const blob = new Blob([draftJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${subsystem}-rules.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportOpen = () => { setImportText(draftJson ?? ""); setImportErrors(null); setImportOpen(true); };
  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setImportErrors(null);
    setImportText(await file.text());
  };
  const onImportConfirm = async () => {
    setImportErrors(null);
    const result = await validateMutation.mutateAsync(importText);
    if (!result.ok) { setImportErrors(result.errors); return; }
    setDraftJson(importText);
    setImportOpen(false);
  };

  if (live.isLoading) return <Group p="xl"><Loader size="sm" /><Text size="sm" c="dimmed">Loading rules…</Text></Group>;
  if (live.isError) return <Text size="sm" c="red" p="xl">Could not load rules for this subsystem.</Text>;

  return (
    <Stack gap="sm">
      {status && status.liveMatchesHead === false && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Live rules differ from the saved version">
          <Group justify="space-between" align="center">
            <Text size="sm">The running rules don't match the last saved version. Apply the saved version to bring them back in sync.</Text>
            <Button size="xs" color="yellow" loading={applyHeadMutation.isPending} onClick={() => applyHeadMutation.mutate()}>
              Apply saved version
            </Button>
          </Group>
        </Alert>
      )}

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button size="xs" onClick={onClickSave} disabled={draftJson === null || !!parsed.error}
            loading={validateMutation.isPending || saveMutation.isPending}>
            Save{dirty ? " *" : ""}
          </Button>
          <Button size="xs" variant="default" leftSection={<IconFileImport size={15} />} onClick={onImportOpen}>
            Import JSON
          </Button>
          <Menu withinPortal position="bottom-start">
            <Menu.Target>
              <Button size="xs" variant="default" rightSection={<IconChevronDown size={14} />}>Export JSON</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconClipboard size={15} />} onClick={onExportCopy}>Copy to clipboard</Menu.Item>
              <Menu.Item leftSection={<IconDownload size={15} />} onClick={onExportDownload}>Download file</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button size="xs" variant="default" leftSection={<IconHistory size={15} />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        </Group>
        {status && (
          <Badge variant="light" color={status.applyOnStartup ? "green" : "gray"}>
            Startup apply: {status.applyOnStartup ? "on" : "off"}
          </Badge>
        )}
      </Group>

      {parsed.error && <Text size="sm" c="red">Invalid JSON — fix it before saving: {parsed.error}</Text>}
      {validationErrors && validationErrors.length > 0 && (
        <Alert color="red" title="Rules failed validation">
          <Stack gap={4}>
            {validationErrors.map((e, i) => (
              <Text key={i} size="sm" ff="monospace">{e.path ? `${e.path}: ` : ""}{e.message}</Text>
            ))}
          </Stack>
        </Alert>
      )}

      <Box style={{ border: "1px solid #e0e0e0", borderRadius: 8, background: "#fff", padding: 12 }}>
        {draftJson !== null && (
          <RuleSetEditor value={parsed.value} json={draftJson} onChange={setDraftJson} />
        )}
      </Box>

      <SimulatePanel subsystem={subsystem} rulesJson={draftJson ?? ""} />

      {/* Save note prompt */}
      <Modal opened={noteModalOpen} onClose={() => setNoteModalOpen(false)} title="Save rules">
        <Stack>
          <Text size="sm" c="dimmed">Validation passed. Optionally add a note for this version.</Text>
          <TextInput label="Note (optional)" placeholder="e.g. tighten write access on orders/*"
            value={note} onChange={(e) => setNote(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setNoteModalOpen(false)}>Cancel</Button>
            <Button onClick={confirmSave} loading={saveMutation.isPending}>Save & apply</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Import JSON */}
      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import rules JSON" size="lg">
        <Stack>
          <Group gap="xs">
            <FileButton accept="application/json,.json" onChange={onImportFile}>
              {(props) => <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={15} />}>Choose .json file</Button>}
            </FileButton>
            <Text size="xs" c="dimmed">or paste the ruleset JSON below</Text>
          </Group>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
            autosize minRows={10} maxRows={22}
            placeholder='{"Matches":[]}'
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
          />
          {importErrors && importErrors.length > 0 && (
            <Alert color="red" title="Import failed validation">
              <Stack gap={4}>
                {importErrors.map((e, i) => (
                  <Text key={i} size="sm" ff="monospace">{e.path ? `${e.path}: ` : ""}{e.message}</Text>
                ))}
              </Stack>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={onImportConfirm} loading={validateMutation.isPending}>Import</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Version history */}
      <Drawer opened={historyOpen} onClose={() => setHistoryOpen(false)} title="Version history" position="right" size="lg">
        {versions.isLoading && <Text size="sm" c="dimmed">Loading…</Text>}
        {versions.data?.length === 0 && <Text size="sm" c="dimmed">No saved versions yet.</Text>}
        {versions.data && versions.data.length > 0 && (
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th><Table.Th>Date</Table.Th><Table.Th>Author</Table.Th>
                <Table.Th>Note</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {versions.data.map((v) => (
                <Table.Tr key={v.version}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm">#{v.version}</Text>
                      {v.isActive && <Badge size="xs" color="blue" variant="light">active</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{new Date(v.createdAtUtc).toLocaleString()}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{v.createdBy ?? "—"}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{v.note ?? "—"}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={6} justify="flex-end">
                      <Button size="xs" variant="subtle" loading={viewVersionMutation.isPending && viewVersionMutation.variables === v.version}
                        onClick={() => viewVersionMutation.mutate(v.version)}>View</Button>
                      {!v.isActive && (
                        <Button size="xs" variant="subtle" color="red" onClick={() => setRevertTarget(v)}>Revert</Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Drawer>

      <ConfirmModal
        opened={!!revertTarget}
        title="Revert rules"
        confirmLabel={`Revert to version ${revertTarget?.version ?? ""}`}
        loading={revertMutation.isPending}
        error={revertMutation.isError ? "Revert failed. Please try again." : null}
        message={<>Revert live rules to version <b>#{revertTarget?.version}</b>? This creates a new version and applies it immediately.</>}
        onConfirm={() => revertTarget && revertMutation.mutate(revertTarget.version)}
        onCancel={() => setRevertTarget(null)}
      />
    </Stack>
  );
}
