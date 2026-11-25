import { useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { errorWithList } from "../../api/appAuth";
import type { RealtimeSettings } from "../../api/realtime";
import { CardsPage, EditCard, EditRow, HistoryButton, OnOff } from "../../components/EditCard";
import { UnitInput } from "../../components/SettingRows";
import { AreaHistory, num, useAreaCards, versionLine } from "../settings/AreaSettings";

const ARCHIVE_NOTE = "Each closed list is kept as one file in the project's Storage before it's deleted. Needs Storage started.";

/** Realtime → Settings: when lists close and how long closed ones are kept, and the limits on items and lists. Edited in a dialog. */
export function RealtimeSettingsView() {
  const st = useAreaCards<RealtimeSettings>("realtime");
  if (st.saved.isLoading) return <Loader size="sm" />;
  if (st.saved.isError || !st.settings) return <Alert color="red">Couldn't load the settings: {errorWithList(st.saved.error)}</Alert>;
  const s = st.settings;
  const d = st.draft;
  const edit = (id: string) => st.editable && (
    <Button variant="subtle" size="sm" leftSection={<IconPencil size={15} />} onClick={() => st.edit(id)}>Edit</Button>
  );
  return (
    <CardsPage intro={versionLine(st.saved.data)}
      history={<HistoryButton subtitle="Realtime settings"><AreaHistory area="realtime" editable={st.editable} /></HistoryButton>}>
      {!st.editable && <Alert color="gray">Read-only. {st.saved.data?.whyReadOnly}</Alert>}

      <EditCard title="Lifecycle" description="When open lists close, and how long closed ones are kept." testId="realtime-lifecycle" actions={edit("lifecycle")}
        rows={[
          { label: "Close idle lists", value: s.idleCloseHours == null ? "Never" : `After ${s.idleCloseHours} hours without a new item` },
          { label: "Keep closed lists", value: `${s.retainClosedDays} days` },
          { label: "Archive closed lists", value: <OnOff on={s.archiveClosedLists} />, hint: ARCHIVE_NOTE },
        ]} />

      <EditCard title="Limits" description="Anything larger is refused." testId="realtime-limits" actions={edit("limits")}
        rows={[
          { label: "Largest item", value: `${s.maxItemKb} KB` },
          { label: "Items in a list", value: `up to ${s.maxListItems.toLocaleString()}` },
          { label: "Largest list", value: `${s.maxListMb} MB` },
        ]} />

      <SettingsDialog opened={st.editing === "lifecycle"} title="Lifecycle" onClose={st.cancel} onSave={st.save}>
        {d && (
          <>
            <EditRow label="Close idle lists" hint="With no new item for this long.">
              <Group gap="sm" wrap="nowrap">
                <Switch aria-label="Close idle lists" checked={d.idleCloseHours != null}
                  onChange={(e) => st.setDraft({ ...d, idleCloseHours: e.currentTarget.checked ? s.idleCloseHours ?? 24 : null })} />
                {d.idleCloseHours != null && (
                  <UnitInput label="Close after" unit="hours" min={1} max={8760} value={d.idleCloseHours} onChange={(v) => st.setDraft({ ...d, idleCloseHours: num(v) })} />
                )}
              </Group>
            </EditRow>
            <EditRow label="Keep closed lists" hint="Closed lists still read, then are deleted.">
              <UnitInput label="Keep closed lists" unit="days" min={1} max={3650} value={d.retainClosedDays} onChange={(v) => st.setDraft({ ...d, retainClosedDays: num(v) })} />
            </EditRow>
            <EditRow label="Archive closed lists" hint={ARCHIVE_NOTE}>
              <Switch aria-label="Archive closed lists" checked={d.archiveClosedLists} onChange={(e) => st.setDraft({ ...d, archiveClosedLists: e.currentTarget.checked })} />
            </EditRow>
          </>
        )}
      </SettingsDialog>

      <SettingsDialog opened={st.editing === "limits"} title="Limits" onClose={st.cancel} onSave={st.save}>
        {d && (
          <>
            <EditRow label="Largest item">
              <UnitInput label="Largest item" unit="KB" min={1} max={1024} value={d.maxItemKb} onChange={(v) => st.setDraft({ ...d, maxItemKb: num(v) })} />
            </EditRow>
            <EditRow label="Items in a list">
              <UnitInput label="Items in a list" unit="items" min={1} max={100_000_000} value={d.maxListItems} onChange={(v) => st.setDraft({ ...d, maxListItems: num(v) })} />
            </EditRow>
            <EditRow label="Largest list">
              <UnitInput label="Largest list" unit="MB" min={1} max={102400} value={d.maxListMb} onChange={(v) => st.setDraft({ ...d, maxListMb: num(v) })} />
            </EditRow>
          </>
        )}
      </SettingsDialog>
    </CardsPage>
  );
}

/** A card's fields in a dialog, saved with a reason. */
function SettingsDialog({ opened, title, onClose, onSave, children }: {
  opened: boolean; title: string; onClose: () => void; onSave: (reason: string) => Promise<unknown>; children: React.ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setReason(""); setError(null); onClose(); };
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(reason.trim()); setReason(""); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={() => { if (!busy) close(); }} title={<Text fw={700} fz={18}>{title}</Text>} size="lg" radius="lg">
      <Stack gap="sm">
        <div>{children}</div>
        <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {error && <Alert color="red" p="xs" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!reason.trim()}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
