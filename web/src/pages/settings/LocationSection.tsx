import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, PasswordInput, Progress, SegmentedControl, Stack, Stepper, Switch, Text, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { ArchiveLocation, LocationTest, StorageLocationState } from "../../api/dataSettings";
import { when } from "../authentication/UsersView";

type Preset = "aws" | "r2" | "other";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "aws", label: "Amazon S3" }, { value: "r2", label: "Cloudflare R2" }, { value: "other", label: "Other S3-compatible" },
];
const EMPTY = { bucket: "", region: "", serviceUrl: "", accessKey: "", forcePathStyle: false };

const size = (bytes: number) => bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Storage → Settings → Where files are kept: moving files to another place as guided steps. The app keeps working
 * throughout: copy (old place in use), switch (new place in use, reads fall back), finish.
 */
export function LocationSection() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["storage-location"], queryFn: api.storageLocation,
    refetchInterval: (q) => (q.state.data?.move ? 2000 : false),
  });
  const [choosing, setChoosing] = useState(false);
  const refresh = async () => {
    for (const key of [["storage-location"], ["data-settings-history", "storage"]]) await qc.invalidateQueries({ queryKey: key });
  };

  if (state.isLoading) return <Loader size="sm" />;
  if (state.isError || !state.data) return <Alert color="red">Couldn't load where files are kept: {errorMessage(state.error)}</Alert>;
  const s = state.data;

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <div>
          <Title order={5}>Where files are kept</Title>
          <Text size="sm" data-testid="location-active">In use: <b>{s.activeLabel}</b></Text>
        </div>
        {s.move ? <MoveSteps s={s} onChange={refresh} />
          : choosing ? <ChooseLocation s={s} onDone={async () => { setChoosing(false); await refresh(); }} onCancel={() => setChoosing(false)} />
          : (
            <Group gap="xs">
              <Button size="xs" variant="default" disabled={!s.editable || (s.kinds.length === 0 && !s.active)} onClick={() => setChoosing(true)}>Move files…</Button>
              {s.kinds.length === 0 && !s.active && <Text size="xs" c="dimmed">This app can't move files yet: it needs the Winche.Storage.S3 package (AllowS3Locations()).</Text>}
            </Group>
          )}
      </Stack>
    </Paper>
  );
}

function ChooseLocation({ s, onDone, onCancel }: { s: StorageLocationState; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState<"s3" | "code">(s.active ? "code" : "s3");
  const [preset, setPreset] = useState<Preset>("aws");
  const [b, setB] = useState(EMPTY);
  const [secret, setSecret] = useState("");
  const [test, setTest] = useState<LocationTest | "testing" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location: ArchiveLocation = target === "code" ? { kind: "code" } : {
    kind: "s3",
    s3: {
      bucket: b.bucket.trim(), region: preset === "r2" ? "auto" : b.region.trim(),
      serviceUrl: preset === "aws" ? null : b.serviceUrl.trim() || null, accessKey: b.accessKey.trim() || null,
      forcePathStyle: preset === "other" ? b.forcePathStyle : false,
    },
  };
  const filled = target === "code" || (!!location.s3!.bucket && !!location.s3!.region && (preset === "aws" || !!location.s3!.serviceUrl) && !!secret);
  const set = (patch: Partial<typeof EMPTY>) => { setB({ ...b, ...patch }); setTest(null); };

  const runTest = async () => {
    setTest("testing");
    try { setTest(await api.testStorageLocation(location, secret || null)); }
    catch (e) { setTest({ ok: false, steps: [{ name: "Test", ok: false, error: errorMessage(e) }] }); }
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try { await api.startStorageMove(location, secret || null, reason.trim()); onDone(); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };

  return (
    <Stack gap="sm">
      {s.active && (
        <SegmentedControl size="xs" w="fit-content" aria-label="Move to" value={target} onChange={(v) => { setTarget(v as "s3" | "code"); setTest(null); }}
          data={[{ value: "code", label: "Back to the app's own location" }, { value: "s3", label: "Another bucket" }]} />
      )}
      {target === "code" ? (
        <Text size="sm">Files will move back to {s.codeLabel}.</Text>
      ) : (
        <>
          <SegmentedControl size="xs" w="fit-content" aria-label="Provider" value={preset} data={PRESETS} onChange={(v) => { setPreset(v as Preset); setTest(null); }} />
          <Group grow wrap="wrap" align="flex-end">
            <TextInput label="Bucket" placeholder="my-app-files" value={b.bucket} onChange={(e) => set({ bucket: e.currentTarget.value })} />
            {preset !== "r2" && <TextInput label="Region" placeholder="eu-west-2" value={b.region} onChange={(e) => set({ region: e.currentTarget.value })} />}
          </Group>
          {preset !== "aws" && (
            <TextInput label="Service address" placeholder={preset === "r2" ? "https://<account id>.r2.cloudflarestorage.com" : "https://minio.example.com"}
              value={b.serviceUrl} onChange={(e) => set({ serviceUrl: e.currentTarget.value })} />
          )}
          <Group grow wrap="wrap" align="flex-end">
            <TextInput label="Access key id" value={b.accessKey} onChange={(e) => set({ accessKey: e.currentTarget.value })} />
            <PasswordInput label="Secret access key" description="Saved encrypted; it can't be read back." disabled={!s.secretsAvailable}
              value={secret} onChange={(e) => { setSecret(e.currentTarget.value); setTest(null); }} />
          </Group>
          {preset === "other" && <Switch label="Path-style addresses (MinIO and most self-hosted services)" checked={b.forcePathStyle} onChange={(e) => set({ forcePathStyle: e.currentTarget.checked })} />}
          {!s.secretsAvailable && <Alert color="yellow">Secrets can't be saved: the app needs a master key (WincheConfigOptions.MasterKey).</Alert>}
          <Text size="xs" c="dimmed">The bucket needs CORS allowing PUT and GET from your apps, as uploads and downloads go to it directly.</Text>
        </>
      )}
      <Group gap="xs">
        {target === "s3" && <Button size="xs" variant="default" disabled={!filled} loading={test === "testing"} onClick={runTest}>Test</Button>}
        <Button size="xs" variant="subtle" onClick={onCancel}>Cancel</Button>
      </Group>
      {test && test !== "testing" && (
        <Stack gap={2} data-testid="location-test">
          {test.steps.map((st) => <Text key={st.name} size="sm" c={st.ok ? undefined : "red"}>{st.ok ? "✓" : "✗"} {st.name}{st.error ? `: ${st.error}` : ""}</Text>)}
        </Stack>
      )}
      {(target === "code" || (test && test !== "testing" && test.ok)) && (
        <Paper withBorder p="sm" style={{ borderColor: "var(--mantine-color-blue-5)" }}>
          <Stack gap="xs">
            <Text size="sm">Every file is copied in the background. The app keeps using {s.activeLabel} until you switch.</Text>
            <Group gap="xs" wrap="wrap">
              <TextInput placeholder="Why are you moving the files?" aria-label="Reason for the move" style={{ flex: "1 1 260px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              <Button loading={busy} disabled={!reason.trim()} onClick={start}>Start copying</Button>
            </Group>
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function MoveSteps({ s, onChange }: { s: StorageLocationState; onChange: () => Promise<void> }) {
  const m = s.move!;
  const p = s.progress;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = m.phase === "copying" ? 0 : m.phase === "ready" ? 1 : 2;
  const done = p ? p.copied + p.alreadyThere : 0;
  const cleanCatchUp = m.phase === "switched" && !!p?.passFinishedAt && p.failed === 0;

  const step = async (name: "switch" | "finish" | "cancel") => {
    setBusy(name);
    setError(null);
    try { await api.storageMoveStep(name, reason.trim()); setReason(""); await onChange(); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(null); }
  };

  return (
    <Stack gap="sm" data-testid="move-steps">
      <Text size="sm">Moving files from <b>{m.fromLabel}</b> to <b>{m.toLabel}</b> · started {when(m.startedAt)}</Text>
      <Stepper active={active} size="xs">
        <Stepper.Step label="Copy" description={m.phase === "copying" ? "under way" : "done"} />
        <Stepper.Step label="Switch" description="new uploads go to the new place" />
        <Stepper.Step label="Finish" description="stop reading the old place" />
      </Stepper>
      {p && (
        <Stack gap={4}>
          {p.total > 0 && <Progress value={(done / p.total) * 100} aria-label="Copied" />}
          <Text size="xs" c="dimmed" data-testid="move-progress">
            {done} of {p.total} files there ({p.copied} copied this pass, {size(p.bytes)}){p.failed ? ` · ${p.failed} failed` : ""} · pass {p.passes}
            {p.passFinishedAt ? `, finished ${when(p.passFinishedAt)}` : p.passStartedAt ? ", running" : ""}
          </Text>
          {p.lastError && <Alert color="red" p="xs">Last problem: {p.lastError}</Alert>}
        </Stack>
      )}
      {m.phase === "copying" && <Text size="sm">The app keeps using {m.fromLabel} while files are copied. Deleted files are removed from both places.</Text>}
      {m.phase === "ready" && (
        <Alert color="teal" title="Every file is copied">
          Switching sends new uploads to {m.toLabel}. Files that reach {m.fromLabel} meanwhile are copied over afterwards, and read from there until then.
        </Alert>
      )}
      {m.phase === "switched" && (
        <Alert color="blue" title="Switched">
          {m.toLabel} is in use. Catch-up passes copy anything that still arrived at {m.fromLabel}.
          {cleanCatchUp ? " The last pass was clean: you can finish." : " Finish once a pass completes with no failures."} Files in {m.fromLabel} are left there to delete yourself.
        </Alert>
      )}
      {s.editable && (
        <Group gap="xs" wrap="wrap">
          <TextInput placeholder="Why?" aria-label="Reason for this step" style={{ flex: "1 1 220px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          {m.phase === "ready" && <Button size="xs" loading={busy === "switch"} disabled={!reason.trim()} onClick={() => step("switch")}>Switch to the new place</Button>}
          {m.phase === "switched" && <Button size="xs" loading={busy === "finish"} disabled={!reason.trim() || !cleanCatchUp} onClick={() => step("finish")}>Finish</Button>}
          {m.phase !== "switched" && <Button size="xs" variant="subtle" color="red" loading={busy === "cancel"} disabled={!reason.trim()} onClick={() => step("cancel")}>Cancel the move</Button>}
          {m.phase === "copying" && <Badge variant="light" tt="none">Switching unlocks when every file is copied</Badge>}
        </Group>
      )}
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
    </Stack>
  );
}
