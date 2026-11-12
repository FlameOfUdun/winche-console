import { Group, NumberInput, Stack, Switch, TextInput } from "@mantine/core";
import type { StorageSettings } from "../../api/dataSettings";
import { AreaSettingsView, num, Section } from "./AreaSettings";
import { LocationSection } from "./LocationSection";

/** Storage → Settings: the size limit, request logging and the orphan sweep. */
export function StorageSettingsView() {
  return (
    <AreaSettingsView<StorageSettings> area="storage" title="Storage settings" about="Limits and housekeeping for stored files.">
      {(draft, set, editable) => (
        <Stack gap="md">
          <LocationSection />
          <Section title="File size" hint="Uploads larger than this are refused before any bytes are sent.">
            <Group align="flex-end" wrap="wrap">
              <Switch label="Limit file size" disabled={!editable} checked={draft.maxFileSizeMb != null}
                onChange={(e) => set({ ...draft, maxFileSizeMb: e.currentTarget.checked ? 25 : null })} />
              {draft.maxFileSizeMb != null && (
                <NumberInput label="Largest file (MB)" w={180} min={0.001} decimalScale={3} disabled={!editable} value={draft.maxFileSizeMb}
                  onChange={(v) => set({ ...draft, maxFileSizeMb: num(v) })} />
              )}
            </Group>
          </Section>
          <Section title="Logging" hint="Requests appear in Logs; denied and slow ones always, a share of the rest.">
            <Group align="flex-end" wrap="wrap">
              <Switch label="Log requests" disabled={!editable} checked={draft.requestLog.enabled}
                onChange={(e) => set({ ...draft, requestLog: { ...draft.requestLog, enabled: e.currentTarget.checked } })} />
              {draft.requestLog.enabled && (
                <>
                  <NumberInput label="Successful requests logged (%)" w={220} min={0} max={100} disabled={!editable}
                    value={Math.round(draft.requestLog.sampleRate * 100)}
                    onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
                  <NumberInput label="Slow after (ms)" w={160} min={1} disabled={!editable} value={draft.requestLog.slowMs}
                    onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, slowMs: num(v) } })} />
                </>
              )}
            </Group>
          </Section>
          <Section title="Clean up unreferenced files"
            hint="Deletes stored files no file record points to (left by interrupted uploads). Only one server sweeps at a time.">
            <Switch label="Clean up regularly" disabled={!editable} checked={draft.orphanSweep.enabled}
              onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, enabled: e.currentTarget.checked } })} />
            {draft.orphanSweep.enabled && (
              <Group wrap="wrap">
                <NumberInput label="Every (hours)" w={150} min={0.25} decimalScale={2} disabled={!editable} value={draft.orphanSweep.intervalHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, intervalHours: num(v) } })} />
                <NumberInput label="Once older than (hours)" w={190} min={1} disabled={!editable} value={draft.orphanSweep.graceHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, graceHours: num(v) } })} />
                <TextInput label="Only under (optional)" placeholder="uploads/" disabled={!editable} value={draft.orphanSweep.prefix ?? ""}
                  onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, prefix: e.currentTarget.value || null } })} />
              </Group>
            )}
          </Section>
        </Stack>
      )}
    </AreaSettingsView>
  );
}
