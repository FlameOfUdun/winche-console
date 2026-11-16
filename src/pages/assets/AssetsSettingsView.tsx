import { useState } from "react";
import { Alert, Button, Group, Loader, Progress, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { AssetLimits } from "../../api/dataSettings";
import { bytes } from "../../api/assets";
import { UnitInput } from "../../components/SettingRows";
import { CardsPage, EditCard, EditRow, HistoryButton } from "../../components/EditCard";
import { AreaHistory, num, useAreaCards, versionLine } from "../settings/AreaSettings";
import { ChooseLocation } from "../settings/LocationSection";

const MB = 1024 * 1024;

/** Assets → Settings: where contents are kept, and the limits on releases. */
export function AssetsSettingsView() {
  const st = useAreaCards<AssetLimits>("assets");
  if (st.saved.isLoading) return <Loader size="sm" />;
  if (st.saved.isError || !st.settings) return <Alert color="red">Couldn't load the settings: {errorWithList(st.saved.error)}</Alert>;
  const s = st.settings;
  const d = st.draft;
  return (
    <CardsPage intro={versionLine(st.saved.data)}
      history={<HistoryButton subtitle="Assets settings"><AreaHistory area="assets" editable={st.editable} /></HistoryButton>}>
      {!st.editable && <Alert color="gray">Read-only. {st.saved.data?.whyReadOnly}</Alert>}
      <AssetLocationCard />

      <EditCard title="Releases" description="What a release may hold. Publishing anything larger is refused." {...st.card("limits")}
        rows={[
          { label: "Files in a release", value: `up to ${s.maxFilesPerRelease.toLocaleString()}` },
          { label: "Largest file", value: bytes(s.maxFileBytes) },
        ]}
        form={d && (
          <>
            <EditRow label="Files in a release">
              <UnitInput label="Files in a release" unit="files" min={1} max={100000} value={d.maxFilesPerRelease} onChange={(v) => st.setDraft({ ...d, maxFilesPerRelease: num(v) })} />
            </EditRow>
            <EditRow label="Largest file">
              <UnitInput label="Largest file" unit="MB" min={1} max={5120} value={Math.round(d.maxFileBytes / MB)}
                onChange={(v) => st.setDraft({ ...d, maxFileBytes: v === "" ? ("" as unknown as number) : Number(v) * MB })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Clean-up" description="Older releases no channel points at are deleted, then the contents nothing uses any more." {...st.card("keep")}
        rows={[{ label: "Keep", value: s.keepReleases === 0 ? "Every release" : `The newest ${s.keepReleases} releases` }]}
        form={d && (
          <EditRow label="Keep the newest" hint="0 keeps every release. Releases a channel points at are always kept.">
            <UnitInput label="Keep the newest" unit="releases" min={0} max={10000} value={d.keepReleases} onChange={(v) => st.setDraft({ ...d, keepReleases: num(v) })} />
          </EditRow>
        )} />
    </CardsPage>
  );
}

/** Where contents are kept: the project's own location or a bucket; a move copies everything, then switches. */
function AssetLocationCard() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["asset-location"], queryFn: api.assetLocation, refetchInterval: (q) => (q.state.data?.move && !q.state.data.move.error ? 2000 : false) });
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    for (const key of [["asset-location"], ["assets"], ["data-settings-history", "assets"]]) await qc.invalidateQueries({ queryKey: key });
  };
  if (state.isLoading) return <Loader size="sm" />;
  if (state.isError || !state.data) return <Alert color="red">Couldn't load where assets are kept: {errorMessage(state.error)}</Alert>;
  const s = state.data;
  const move = s.move;
  const cancel = async () => {
    setError(null);
    try { await api.cancelAssetMove(); await refresh(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <EditCard title="Where assets are kept" description="Each content once, whatever the releases using it." testId="asset-location-card"
      rows={[{ label: "Kept in", value: <span data-testid="asset-location-active">{s.activeLabel}</span> }]}
      actions={!move && !choosing && <Button variant="subtle" disabled={!s.editable} onClick={() => setChoosing(true)}>Move assets…</Button>}>
      {(move || choosing) && (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--w-subtle)" }}>
          {move ? (
            <Stack gap="xs">
              <Text size="sm">Copying to {move.to.kind === "code" ? "the app's own location" : move.to.s3?.bucket ?? move.to.kind}: {move.copied.toLocaleString()}{move.total ? ` of ${move.total.toLocaleString()}` : ""}. Apps keep reading from {s.activeLabel} until everything is there.</Text>
              {move.total > 0 && <Progress value={(move.copied / move.total) * 100} size="sm" />}
              {move.error && <Alert color="red" p="xs">{move.error}</Alert>}
              <Group gap="xs"><Button size="xs" variant="default" onClick={cancel}>Cancel the move</Button></Group>
              {error && <Alert color="red" p="xs">{error}</Alert>}
            </Stack>
          ) : (
            <ChooseLocation s={s} noun="assets" afterCopy="until everything is there, then switches by itself"
              test={api.testAssetLocation} start={api.startAssetMove}
              onDone={async () => { setChoosing(false); await refresh(); }} onCancel={() => setChoosing(false)} />
          )}
        </div>
      )}
    </EditCard>
  );
}
