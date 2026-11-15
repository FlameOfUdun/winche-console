import { Alert, Loader, Switch, TextInput } from "@mantine/core";
import { errorWithList } from "../../api/appAuth";
import type { StorageSettings } from "../../api/dataSettings";
import { UnitInput } from "../../components/SettingRows";
import { CardsPage, EditCard, EditRow, HistoryButton, OnOff } from "../../components/EditCard";
import { AreaHistory, num, useAreaCards, versionLine } from "./AreaSettings";
import { LocationSection } from "./LocationSection";

/** Storage → Settings: where files are kept, uploads, logging and clean-up, each a card edited in place. */
export function StorageSettingsView() {
  const st = useAreaCards<StorageSettings>("storage");
  if (st.saved.isLoading) return <Loader size="sm" />;
  if (st.saved.isError || !st.settings) return <Alert color="red">Couldn't load the settings: {errorWithList(st.saved.error)}</Alert>;
  const s = st.settings;
  const d = st.draft;
  const sweep = (patch: Partial<StorageSettings["orphanSweep"]>) => st.setDraft({ ...d, orphanSweep: { ...d.orphanSweep, ...patch } });
  const log = (patch: Partial<StorageSettings["requestLog"]>) => st.setDraft({ ...d, requestLog: { ...d.requestLog, ...patch } });
  return (
    <CardsPage intro={versionLine(st.saved.data)}
      history={<HistoryButton subtitle="Storage settings"><AreaHistory area="storage" editable={st.editable} /></HistoryButton>}>
      {!st.editable && <Alert color="gray">Read-only. {st.saved.data?.whyReadOnly}</Alert>}
      <LocationSection />

      <EditCard title="Uploads" description="What apps may upload. Your rules can be stricter." {...st.card("size")}
        rows={[{ label: "Largest file", value: s.maxFileSizeMb != null ? `${s.maxFileSizeMb} MB` : <OnOff on={false} offLabel="No limit" /> }]}
        form={d && (
          <>
            <EditRow label="Limit file size">
              <Switch aria-label="Limit file size" checked={d.maxFileSizeMb != null} onChange={(e) => st.setDraft({ ...d, maxFileSizeMb: e.currentTarget.checked ? 25 : null })} />
            </EditRow>
            <EditRow label="Largest file">
              <UnitInput label="Largest file" unit="MB" min={0.001} decimalScale={3} disabled={d.maxFileSizeMb == null} value={d.maxFileSizeMb ?? 25}
                onChange={(v) => st.setDraft({ ...d, maxFileSizeMb: num(v) })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Logging" description="Which uploads and downloads show in Logs. Failures are always logged." {...st.card("logging")}
        rows={[{ label: "Log requests", value: <OnOff on={s.requestLog.enabled} /> },
          ...(s.requestLog.enabled ? [{ label: "Successful reads logged", value: `${Math.round(s.requestLog.sampleRate * 100)}%` },
            { label: "Slow after", value: `${s.requestLog.slowMs.toLocaleString()} ms` }] : [])]}
        form={d && (
          <>
            <EditRow label="Log requests">
              <Switch aria-label="Log requests" checked={d.requestLog.enabled} onChange={(e) => log({ enabled: e.currentTarget.checked })} />
            </EditRow>
            <EditRow label="Successful reads logged" hint="A sample, to keep Logs small.">
              <UnitInput label="Successful reads logged" unit="%" min={0} max={100} disabled={!d.requestLog.enabled} value={Math.round(d.requestLog.sampleRate * 100)}
                onChange={(v) => log({ sampleRate: v === "" ? 0 : Number(v) / 100 })} />
            </EditRow>
            <EditRow label="Slow after">
              <UnitInput label="Slow after" unit="ms" min={1} disabled={!d.requestLog.enabled} value={d.requestLog.slowMs} onChange={(v) => log({ slowMs: num(v) })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Clean-up" description="Stored files no record points to any more: an upload that never finished, a deleted record." {...st.card("cleanup")}
        rows={[{ label: "Delete them", value: <OnOff on={s.orphanSweep.enabled} /> },
          ...(s.orphanSweep.enabled ? [{ label: "Check every", value: `${s.orphanSweep.intervalHours} hours` },
            { label: "Once older than", value: `${s.orphanSweep.graceHours} hours` },
            { label: "Only under", value: s.orphanSweep.prefix ? <code>{s.orphanSweep.prefix}</code> : "Everywhere" }] : [])]}
        form={d && (
          <>
            <EditRow label="Regularly delete stored files no file record points to">
              <Switch aria-label="Regularly delete stored files no file record points to" checked={d.orphanSweep.enabled} onChange={(e) => sweep({ enabled: e.currentTarget.checked })} />
            </EditRow>
            <EditRow label="Every">
              <UnitInput label="Every" unit="hours" min={0.25} decimalScale={2} disabled={!d.orphanSweep.enabled} value={d.orphanSweep.intervalHours}
                onChange={(v) => sweep({ intervalHours: num(v) })} />
            </EditRow>
            <EditRow label="Once older than">
              <UnitInput label="Once older than" unit="hours" min={1} disabled={!d.orphanSweep.enabled} value={d.orphanSweep.graceHours} onChange={(v) => sweep({ graceHours: num(v) })} />
            </EditRow>
            <EditRow label="Only under" hint="A folder; empty: everywhere.">
              <TextInput aria-label="Only under" w={200} placeholder="everywhere" disabled={!d.orphanSweep.enabled} value={d.orphanSweep.prefix ?? ""}
                styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} onChange={(e) => sweep({ prefix: e.currentTarget.value || null })} />
            </EditRow>
          </>
        )} />
    </CardsPage>
  );
}
