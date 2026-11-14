import { useState } from "react";
import { Stack, Switch, TextInput, Title } from "@mantine/core";
import { IconClockHour4, IconFile, IconFolder, IconHourglass, IconListDetails, IconPercentage, IconRepeat, IconRuler, IconTrash } from "@tabler/icons-react";
import { SettingRow, SettingsCard, UnitInput } from "../../components/SettingRows";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { SettingsLayout } from "../../components/SettingsLayout";
import type { StorageSettings } from "../../api/dataSettings";
import { AreaHistory, AreaSettingsView, num } from "./AreaSettings";
import { LocationSection } from "./LocationSection";

type StorageSection = "location" | "size" | "logging" | "cleanup" | "changes";
const STORAGE_SECTIONS: { id: StorageSection; label: string }[] = [
  { id: "location", label: "Where files are kept" }, { id: "size", label: "File size" }, { id: "logging", label: "Logging" },
  { id: "cleanup", label: "Clean-up" }, { id: "changes", label: "Change history" },
];

/** Storage → Settings: its sections listed on the left, the chosen one on the right. */
export function StorageSettingsView() {
  const [section, setSection] = useState<StorageSection>("location");
  const saved = useQuery({ queryKey: ["data-settings", "storage"], queryFn: () => api.dataSettings<StorageSettings>("storage") });
  const label = STORAGE_SECTIONS.find((s) => s.id === section)!.label;
  return (
    <SettingsLayout sections={STORAGE_SECTIONS} active={section} onChange={setSection}>
      {section === "location" ? <LocationSection /> : section === "changes" ? (
        <Stack gap="md"><Title order={4}>Change history</Title><AreaHistory area="storage" editable={saved.data?.editable ?? false} /></Stack>
      ) : (
    <AreaSettingsView<StorageSettings> area="storage" title={label} history={false}>
      {(draft, set, editable) => (
        <Stack gap="md">
          {section === "size" && (
            <SettingsCard>
              <SettingRow icon={IconRuler} label="Limit file size">
                <Switch aria-label="Limit file size" disabled={!editable} checked={draft.maxFileSizeMb != null}
                  onChange={(e) => set({ ...draft, maxFileSizeMb: e.currentTarget.checked ? 25 : null })} />
              </SettingRow>
              <SettingRow icon={IconFile} label="Largest file" dimmed={draft.maxFileSizeMb == null}>
                <UnitInput label="Largest file" unit="MB" min={0.001} decimalScale={3} disabled={!editable || draft.maxFileSizeMb == null}
                  value={draft.maxFileSizeMb ?? 25} onChange={(v) => set({ ...draft, maxFileSizeMb: num(v) })} />
              </SettingRow>
            </SettingsCard>
          )}
          {section === "logging" && (
            <SettingsCard>
              <SettingRow icon={IconListDetails} label="Log requests">
                <Switch aria-label="Log requests" disabled={!editable} checked={draft.requestLog.enabled}
                  onChange={(e) => set({ ...draft, requestLog: { ...draft.requestLog, enabled: e.currentTarget.checked } })} />
              </SettingRow>
              <SettingRow icon={IconPercentage} label="Successful requests logged" dimmed={!draft.requestLog.enabled}>
                <UnitInput label="Successful requests logged" unit="%" min={0} max={100} disabled={!editable || !draft.requestLog.enabled}
                  value={Math.round(draft.requestLog.sampleRate * 100)}
                  onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
              </SettingRow>
              <SettingRow icon={IconClockHour4} label="Slow after" dimmed={!draft.requestLog.enabled}>
                <UnitInput label="Slow after" unit="ms" min={1} disabled={!editable || !draft.requestLog.enabled} value={draft.requestLog.slowMs}
                  onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, slowMs: num(v) } })} />
              </SettingRow>
            </SettingsCard>
          )}
          {section === "cleanup" && (
            <SettingsCard>
              <SettingRow icon={IconTrash} label="Regularly delete stored files no file record points to">
                <Switch aria-label="Regularly delete stored files no file record points to" disabled={!editable} checked={draft.orphanSweep.enabled}
                  onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, enabled: e.currentTarget.checked } })} />
              </SettingRow>
              <SettingRow icon={IconRepeat} label="Every" dimmed={!draft.orphanSweep.enabled}>
                <UnitInput label="Every" unit="hours" min={0.25} decimalScale={2} disabled={!editable || !draft.orphanSweep.enabled} value={draft.orphanSweep.intervalHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, intervalHours: num(v) } })} />
              </SettingRow>
              <SettingRow icon={IconHourglass} label="Once older than" dimmed={!draft.orphanSweep.enabled}>
                <UnitInput label="Once older than" unit="hours" min={1} disabled={!editable || !draft.orphanSweep.enabled} value={draft.orphanSweep.graceHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, graceHours: num(v) } })} />
              </SettingRow>
              <SettingRow icon={IconFolder} label="Only under" dimmed={!draft.orphanSweep.enabled}>
                <TextInput aria-label="Only under" w={150} placeholder="everywhere" disabled={!editable || !draft.orphanSweep.enabled} value={draft.orphanSweep.prefix ?? ""}
                  styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                  onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, prefix: e.currentTarget.value || null } })} />
              </SettingRow>
            </SettingsCard>
          )}
        </Stack>
      )}
    </AreaSettingsView>
      )}
    </SettingsLayout>
  );
}
