import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, NumberInput, Progress, Stack, Table, Text, TextInput } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { AssetLimits } from "../../api/dataSettings";
import { bytes, type AssetCdn, type AssetCdnTest } from "../../api/assets";
import { secretTyped } from "../../api/secrets";
import { SecretInput } from "../../components/SecretInput";
import { EmptyState } from "../../components/EmptyState";
import { IconCloud } from "@tabler/icons-react";
import { UnitInput } from "../../components/SettingRows";
import { CardsPage, EditCard, EditRow, HistoryButton } from "../../components/EditCard";
import { AreaHistory, num, useAreaCards, versionLine } from "../settings/AreaSettings";
import { ChooseLocation } from "../settings/LocationSection";
import { ConfirmModal } from "../../components/ConfirmModal";

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
      <AssetCdnsCard />

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

type CdnForm = { id: string; baseUrl: string; keyPairId: string; linkMinutes: number | string; privateKey: string; reason: string; isNew: boolean };

/**
 * Assets → Settings → CDNs: where releases may name files instead of storing them. Apps never see these addresses:
 * each read gets a link the CDN accepts for a few minutes (CloudFront signed URLs).
 */
export function AssetCdnsCard() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["asset-cdns"], queryFn: api.assetCdns });
  const [form, setForm] = useState<CdnForm | null>(null);
  const [testing, setTesting] = useState<{ cdn: AssetCdn; url: string; result: AssetCdnTest | null; busy: boolean } | null>(null);
  const [removing, setRemoving] = useState<AssetCdn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["asset-cdns"] });
  if (state.isLoading) return <Loader size="sm" />;
  if (state.isError || !state.data) return <Alert color="red">Couldn't load the CDNs: {errorMessage(state.error)}</Alert>;
  const s = state.data;

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    try {
      await api.saveAssetCdn(form.id.trim(), { baseUrl: form.baseUrl.trim(), keyPairId: form.keyPairId.trim(), linkMinutes: Number(form.linkMinutes) || 10 },
        secretTyped(form.privateKey) ? form.privateKey : null, form.reason.trim());
      setForm(null);
      await refresh();
    } catch (e) { setError(errorWithList(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true); setError(null);
    try { await api.removeAssetCdn(removing.id, `Removed the CDN ${removing.id}`); setRemoving(null); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const runTest = async () => {
    if (!testing) return;
    setTesting({ ...testing, busy: true, result: null });
    try { setTesting({ ...testing, busy: false, result: await api.testAssetCdn(testing.cdn.id, testing.url.trim()) }); }
    catch (e) { setTesting({ ...testing, busy: false, result: { ok: false, status: 0, message: errorMessage(e) } }); }
  };
  const editable = s.editable && s.secretsAvailable;
  const ready = form && form.id.trim() && form.baseUrl.trim() && form.keyPairId.trim() && form.reason.trim() && (!form.isNew || secretTyped(form.privateKey));

  return (
    <EditCard title="CDNs" testId="asset-cdns-card"
      description="Files a release names on a CDN instead of storing them. Apps never see these addresses: each read gets a link the CDN accepts for a few minutes."
      actions={<Button variant="subtle" disabled={!editable} onClick={() => { setError(null); setForm({ id: "", baseUrl: "", keyPairId: "", linkMinutes: 10, privateKey: "", reason: "", isNew: true }); }}>Add a CDN</Button>}>
      <div style={{ padding: "0 24px 16px" }}>
        {s.cdns.length === 0 ? (
          <EmptyState icon={IconCloud} title="No CDNs"
            description="Keep large files such as videos on CloudFront: list them in assets.cdn.json and winche assets deploy publishes them without uploading." />
        ) : (
          <Table fz="sm" verticalSpacing={6} data-testid="asset-cdns">
            <Table.Tbody>
              {s.cdns.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td><Text size="sm" fw={500}>{c.id}</Text><Text size="xs" c="dimmed" ff="monospace">{c.baseUrl}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">Key pair {c.keyPairId} · links work {c.linkMinutes} min</Text>
                    {c.key ? <Badge size="xs" variant="light" color={c.key.reference ? "blue" : "gray"}>{c.key.reference ? `Key from ${c.key.reference}` : "Key saved"}</Badge>
                      : <Badge size="xs" color="red" variant="light">No key</Badge>}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="xs" variant="subtle" onClick={() => setTesting({ cdn: c, url: c.baseUrl, result: null, busy: false })}>Test</Button>
                      <Button size="xs" variant="subtle" disabled={!editable} onClick={() => { setError(null); setForm({ id: c.id, baseUrl: c.baseUrl, keyPairId: c.keyPairId, linkMinutes: c.linkMinutes, privateKey: "", reason: "", isNew: false }); }}>Edit</Button>
                      <Button size="xs" variant="subtle" color="red" disabled={!editable} onClick={() => { setError(null); setRemoving(c); }}>Remove</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {!s.secretsAvailable && <Alert color="gray" mt="xs">CDNs need the server's master key to keep their private keys.</Alert>}
      </div>

      <Modal opened={form !== null} onClose={() => setForm(null)} title={form?.isNew ? "Add a CDN" : `Edit ${form?.id}`} size="lg">
        {form && (
          <Stack gap="sm">
            <TextInput label="Name" description="Letters, digits and -." value={form.id} disabled={!form.isNew} onChange={(e) => setForm({ ...form, id: e.currentTarget.value })} />
            <TextInput label="Base address" description="The files' addresses start with it." placeholder="https://cdn.example.com/app/" value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.currentTarget.value })} />
            <TextInput label="Key pair id" description="The CloudFront public key's id, in a key group the distribution trusts." value={form.keyPairId}
              onChange={(e) => setForm({ ...form, keyPairId: e.currentTarget.value })} />
            <NumberInput label="Links work for" suffix=" minutes" min={1} max={60} value={form.linkMinutes} onChange={(v) => setForm({ ...form, linkMinutes: v })} />
            <SecretInput label="Private key" multiline value={form.privateKey} onChange={(v) => setForm({ ...form, privateKey: v })}
              savedReference={s.cdns.find((c) => c.id === form.id)?.key?.reference}
              placeholder={form.isNew ? "-----BEGIN PRIVATE KEY-----" : "Leave empty to keep the saved key"}
              description="The RSA key CloudFront checks links with: best as a reference to AWS, so it's never kept here." />
            <TextInput label="Why" placeholder="Videos on CloudFront" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.currentTarget.value })} />
            {error && <Alert color="red" p="xs">{error}</Alert>}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setForm(null)}>Cancel</Button>
              <Button loading={busy} disabled={!ready} onClick={save}>Save</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={testing !== null} onClose={() => setTesting(null)} title={`Test ${testing?.cdn.id}`}>
        {testing && (
          <Stack gap="sm">
            <TextInput label="A file on it" description="Asked for through a link signed now." value={testing.url} onChange={(e) => setTesting({ ...testing, url: e.currentTarget.value, result: null })} />
            {testing.result && <Alert color={testing.result.ok ? "green" : "red"} p="xs" data-testid="asset-cdn-test">{testing.result.message}</Alert>}
            <Group justify="flex-end"><Button loading={testing.busy} onClick={runTest}>Test</Button></Group>
          </Stack>
        )}
      </Modal>

      <ConfirmModal opened={removing !== null} title={`Remove ${removing?.id}?`} confirmLabel="Remove" loading={busy} error={error}
        message="Its private key is deleted too. A channel's release that still names files on it can't be read, so it's refused until none does."
        onConfirm={remove} onCancel={() => setRemoving(null)} />
    </EditCard>
  );
}
