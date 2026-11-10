import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Box, Button, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertTriangle, IconHistory } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type {
  RuleSet, RuleSubsystem, RuleValidationError, RuleVersionDetail, RuleVersionSummary,
} from "../../api/rules";
import { ConfirmModal } from "../../components/ConfirmModal";
import { RuleSetEditor, type RuleSetEditorHandle } from "./RuleSetEditor";
import { SimulatePanel } from "./SimulatePanel";
import { VersionHistory } from "./VersionHistory";

/** Pretty-prints rulesJson for editing; falls back to the raw text if it somehow isn't valid JSON. */
function prettyOrRaw(rulesJson: string): string {
  try { return JSON.stringify(JSON.parse(rulesJson), null, 2); }
  catch { return rulesJson; }
}

const SAVE_KEYS = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S";

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
  // The editor checks its text lazily (on blur / Save); `textEdited` = it has changes not checked yet.
  const editor = useRef<RuleSetEditorHandle>(null);
  const [textEdited, setTextEdited] = useState(false);
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
  if (live.data && draftJson === null) {
    // Lazily seed the draft the first time live rules arrive. Deliberately NOT keyed to every
    // live.data change — background refetches must never clobber an in-progress edit.
    const pretty = prettyOrRaw(live.data.rulesJson);
    setDraftJson(pretty);
    setBaselineJson(pretty);
  }
  const dirty = (draftJson !== null && draftJson !== baselineJson) || textEdited;

  const parsed = useMemo((): { value: RuleSet | null; error: string | null } => {
    if (draftJson === null) return { value: null, error: null };
    try { return { value: JSON.parse(draftJson) as RuleSet, error: null }; }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : "Invalid JSON" }; }
  }, [draftJson]);

  const [validationErrors, setValidationErrors] = useState<RuleValidationError[] | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [note, setNote] = useState("");
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
      setHistoryOpen(false);
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
      notifications.show({ color: "blue", message: `Version ${detail.version} is in the editor — Save to make it live.` });
    },
    onError: () => notifications.show({ color: "red", message: "Could not load that version." }),
  });

  const onClickSave = async () => {
    if (draftJson === null) return;
    setValidationErrors(null);
    const checked = await editor.current?.check();   // the text, checked now; shows its error otherwise
    if (!checked) return;
    const result = await validateMutation.mutateAsync(checked);
    if (!result.ok) { setValidationErrors(result.errors); return; }
    setNoteModalOpen(true);
  };

  const confirmSave = () => {
    if (draftJson === null) return;
    saveMutation.mutate({ rulesJson: draftJson, note: note.trim() || undefined, expectedHeadVersion: activeVersion });
  };


  // ⌘S / Ctrl+S anywhere on the page saves (and, with the note dialog open, confirms it) instead of the
  // browser's "save page". Latest handlers via a ref so the listener is added once.
  const shortcut = useRef({ onClickSave, confirmSave, noteModalOpen, busy: true });
  shortcut.current = { onClickSave, confirmSave, noteModalOpen, busy: validateMutation.isPending || saveMutation.isPending || !dirty };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      const { onClickSave: save, confirmSave: confirm, noteModalOpen: confirming, busy } = shortcut.current;
      if (busy) return;
      if (confirming) confirm(); else void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <Button size="xs" onClick={onClickSave} disabled={draftJson === null || !dirty}
            loading={validateMutation.isPending || saveMutation.isPending}>
            Save{dirty ? " *" : ""}
            <Text span size="xs" ml={6} fw={400} visibleFrom="sm" style={{ opacity: 0.7 }}>{SAVE_KEYS}</Text>
          </Button>
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
          <RuleSetEditor ref={editor} subsystem={subsystem} json={draftJson} onChange={setDraftJson} onEditedChange={setTextEdited} />
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



      <VersionHistory
        subsystem={subsystem}
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        versions={versions.data}
        onOpenInEditor={(version) => viewVersionMutation.mutate(version)}
        onRevert={(v) => setRevertTarget(v)} />

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
