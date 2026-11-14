import { useEffect, useState, type ReactNode } from "react";
import {
  Alert, Button, Code, Group, Loader, Modal, NumberInput, PasswordInput, SegmentedControl, SimpleGrid, Stack, Stepper, Switch, Text, TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, type WincheAuthSettings } from "../../api/appAuth";
import type { ArchiveLocation, StorageSettings } from "../../api/dataSettings";
import { testModeRules, type ProductId, type RulesMode } from "../../api/project";
import { surface } from "../../theme";

const NAMES: Record<ProductId, string> = {
  database: "Database", storage: "Storage", authentication: "Authentication", functions: "Functions", hooks: "Hooks",
};

/** A choice drawn as a card (rules mode, where files live). */
function Choice({ selected, title, about, onClick }: { selected: boolean; title: string; about: string; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick} aria-pressed={selected}
      style={{ border: `1px solid ${selected ? "var(--mantine-color-winche-6)" : surface.border}`, borderRadius: 12, padding: 16,
        background: selected ? "#F5F7FF" : surface.card }}>
      <Text fw={600}>{title}</Text>
      <Text size="sm" c={surface.muted} mt={4}>{about}</Text>
    </UnstyledButton>
  );
}

function RulesStep({ mode, setMode }: { mode: RulesMode; setMode: (m: RulesMode) => void }) {
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Choice selected={mode === "locked"} title="Locked" about="Nothing can be read or written until you publish rules. Right for real data." onClick={() => setMode("locked")} />
        <Choice selected={mode === "test"} title="Test mode" about="Everything allowed for 30 days, then locked. For trying things out." onClick={() => setMode("test")} />
      </SimpleGrid>
      {mode === "test" && <Alert color="yellow" p="sm">Anyone with your app's address can read and change everything for 30 days. Not for real data.</Alert>}
    </Stack>
  );
}

async function publishTestRules(sys: "database" | "storage") {
  const parsed = await api.rulesParseText(testModeRules(sys, new Date(Date.now() + 30 * 24 * 3600 * 1000)));
  if (parsed.ok && parsed.rulesJson) await api.rulesSave(sys, { rulesJson: parsed.rulesJson, note: "Test mode: open for 30 days" });
}

/** Moves storage to a bucket on a server that has no files yet: start, wait until copied, switch, finish. */
async function moveToBucket(location: ArchiveLocation, secret: string) {
  const reason = "Setup: files kept in a bucket";
  await api.startStorageMove(location, secret, reason);
  for (let i = 0; i < 60; i++) {
    const s = await api.storageLocation();
    if (s.move?.phase === "ready") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await api.storageMoveStep("switch", reason);
  await api.storageMoveStep("finish", reason);
}

/**
 * Setting up one product, in a few steps (each only what that product needs), then starting it. Opened from the
 * product's Get started page.
 */
export function ProductWizard({ product, opened, onClose }: { product: ProductId; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Database, Storage
  const [rules, setRules] = useState<RulesMode>("locked");
  // Storage
  const [where, setWhere] = useState<"disk" | "bucket">("disk");
  const [bucket, setBucket] = useState({ bucket: "", region: "auto", serviceUrl: "", accessKey: "", secret: "" });
  const [bucketTest, setBucketTest] = useState<string | null>(null);
  const [maxMb, setMaxMb] = useState<number | "">(25);
  const storage = useQuery({ queryKey: ["data-settings", "storage"], queryFn: () => api.dataSettings<StorageSettings>("storage"), enabled: opened && product === "storage" });
  // Authentication
  const signIn = useQuery({ queryKey: ["signin-settings"], queryFn: api.signInSettings, enabled: opened && product === "authentication" });
  const [auth, setAuth] = useState<WincheAuthSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  // Functions
  const fns = useQuery({ queryKey: ["functions"], queryFn: api.functions, enabled: opened && product === "functions" });

  useEffect(() => { if (signIn.data?.available && !auth) setAuth(signIn.data.settings); }, [signIn.data]);
  useEffect(() => { if (storage.data?.settings.maxFileSizeMb) setMaxMb(storage.data.settings.maxFileSizeMb); }, [storage.data]);

  const location = (): ArchiveLocation => ({
    kind: "s3", s3: { bucket: bucket.bucket.trim(), region: bucket.region.trim() || "auto", serviceUrl: bucket.serviceUrl.trim() || null, accessKey: bucket.accessKey.trim() || null, forcePathStyle: true },
  });
  const testBucket = async () => {
    setBucketTest("testing");
    try {
      const r = await api.testStorageLocation(location(), bucket.secret || null);
      setBucketTest(r.ok ? "ok" : r.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`).join("; "));
    } catch (e) { setBucketTest(errorMessage(e)); }
  };

  const setA = (patch: Partial<WincheAuthSettings>) => setAuth((a) => (a ? { ...a, ...patch } : a));

  const steps: { label: string; content: ReactNode; ready?: boolean }[] = (() => {
    switch (product) {
      case "database":
        return [{ label: "Starting rules", content: <RulesStep mode={rules} setMode={setRules} /> }];
      case "storage":
        return [
          { label: "Where files live", ready: where === "disk" || bucketTest === "ok", content: (
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Choice selected={where === "disk"} title="This server's disk" about="Simplest. Back up its data folder with the database." onClick={() => setWhere("disk")} />
                <Choice selected={where === "bucket"} title="A bucket" about="S3, Cloudflare R2, MinIO or any S3-compatible storage." onClick={() => setWhere("bucket")} />
              </SimpleGrid>
              {where === "bucket" && (
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <TextInput label="Bucket" value={bucket.bucket} onChange={(e) => { setBucket({ ...bucket, bucket: e.currentTarget.value }); setBucketTest(null); }} />
                    <TextInput label="Region" value={bucket.region} onChange={(e) => { setBucket({ ...bucket, region: e.currentTarget.value }); setBucketTest(null); }} />
                  </SimpleGrid>
                  <TextInput label="Endpoint" description="Blank for Amazon S3" placeholder="https://…r2.cloudflarestorage.com" value={bucket.serviceUrl}
                    onChange={(e) => { setBucket({ ...bucket, serviceUrl: e.currentTarget.value }); setBucketTest(null); }} />
                  <SimpleGrid cols={2} spacing="xs">
                    <TextInput label="Access key" value={bucket.accessKey} onChange={(e) => { setBucket({ ...bucket, accessKey: e.currentTarget.value }); setBucketTest(null); }} />
                    <PasswordInput label="Secret key" value={bucket.secret} onChange={(e) => { setBucket({ ...bucket, secret: e.currentTarget.value }); setBucketTest(null); }} />
                  </SimpleGrid>
                  <Group gap="xs">
                    <Button variant="default" size="xs" onClick={testBucket} loading={bucketTest === "testing"} disabled={!bucket.bucket.trim()}>Test the bucket</Button>
                    {bucketTest === "ok" && <Text size="sm" c="teal.8">It works.</Text>}
                    {bucketTest && bucketTest !== "ok" && bucketTest !== "testing" && <Text size="sm" c="red">{bucketTest}</Text>}
                  </Group>
                </Stack>
              )}
            </Stack>
          ) },
          { label: "Starting rules", content: <RulesStep mode={rules} setMode={setRules} /> },
          { label: "File size", content: (
            <NumberInput label="Largest file (MB)" description="Uploads bigger than this are refused. Change it any time in Storage → Settings."
              min={1} max={10240} value={maxMb} onChange={(v) => setMaxMb(typeof v === "number" ? v : "")} w={260} />
          ) },
        ];
      case "authentication":
        if (!signIn.data) return [{ label: "Sign-in methods", content: <Loader size="sm" /> }];
        if (!signIn.data.available || !auth) return [{ label: "Sign-in methods", content: <Alert color="gray">{signIn.data.available ? "" : signIn.data.whyReadOnly}</Alert> }];
        return [
          { label: "Sign-in methods", content: (
            <Stack gap="md">
              <Switch label="Email and password" checked={auth.emailPassword.enabled} onChange={(e) => setA({ emailPassword: { ...auth.emailPassword, enabled: e.currentTarget.checked } })} />
              {auth.emailPassword.enabled && (
                <Group gap="md" pl={52} wrap="wrap">
                  <NumberInput label="Shortest password" min={6} max={128} w={160} value={auth.emailPassword.minLength}
                    onChange={(v) => setA({ emailPassword: { ...auth.emailPassword, minLength: Number(v) || 10 } })} />
                  <Switch label="Verified email required" mt={24} checked={auth.emailPassword.requireVerifiedEmail}
                    onChange={(e) => setA({ emailPassword: { ...auth.emailPassword, requireVerifiedEmail: e.currentTarget.checked } })} />
                </Group>
              )}
              <Switch label="Anonymous (guests, upgraded later)" checked={auth.anonymous} onChange={(e) => setA({ anonymous: e.currentTarget.checked })} />
              <Switch label="Email link (no password)" checked={auth.emailLink.enabled} onChange={(e) => setA({ emailLink: { ...auth.emailLink, enabled: e.currentTarget.checked } })} />
              {auth.emailLink.enabled && (
                <TextInput pl={52} label="Where the link opens" placeholder="https://app.example.com/finish-sign-in" value={auth.emailLink.linkUrl}
                  onChange={(e) => setA({ emailLink: { ...auth.emailLink, linkUrl: e.currentTarget.value } })} />
              )}
              <Text size="sm" c={surface.faint}>Google, Apple and your own identity providers: in Sign-in methods, once started.</Text>
            </Stack>
          ) },
          { label: "Email", content: (
            <Stack gap="md">
              <SegmentedControl value={auth.email.sender === "smtp" ? "smtp" : "logLinks"}
                onChange={(v) => setA({ email: { ...auth.email, enabled: true, sender: v as "smtp" | "logLinks", smtp: v === "smtp" ? auth.email.smtp ?? { host: "", port: 587, security: "startTls", username: null, fromAddress: "", fromName: null } : auth.email.smtp } })}
                data={[{ value: "logLinks", label: "Not yet: log the links" }, { value: "smtp", label: "Send with SMTP" }]} />
              {auth.email.sender === "smtp" && auth.email.smtp && (
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <TextInput label="SMTP server" value={auth.email.smtp.host} onChange={(e) => setA({ email: { ...auth.email, smtp: { ...auth.email.smtp!, host: e.currentTarget.value } } })} />
                    <NumberInput label="Port" value={auth.email.smtp.port} onChange={(v) => setA({ email: { ...auth.email, smtp: { ...auth.email.smtp!, port: Number(v) || 587 } } })} />
                  </SimpleGrid>
                  <SimpleGrid cols={2} spacing="xs">
                    <TextInput label="User" value={auth.email.smtp.username ?? ""} onChange={(e) => setA({ email: { ...auth.email, smtp: { ...auth.email.smtp!, username: e.currentTarget.value || null } } })} />
                    <PasswordInput label="Password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.currentTarget.value)} />
                  </SimpleGrid>
                  <TextInput label="From address" placeholder="no-reply@example.com" value={auth.email.smtp.fromAddress}
                    onChange={(e) => setA({ email: { ...auth.email, smtp: { ...auth.email.smtp!, fromAddress: e.currentTarget.value } } })} />
                </Stack>
              )}
              {auth.email.sender !== "smtp" && <Text size="sm" c={surface.muted}>Verification and reset links go to the server's logs until you set up sending, in Authentication → Settings.</Text>}
            </Stack>
          ) },
          { label: "Two-step sign-in", content: (
            <Stack gap="sm">
              <Switch label="Let users add an authenticator app" description="Then every sign-in also asks for its code. Their tokens carry mfa: true."
                checked={auth.twoStep.enabled} onChange={(e) => setA({ twoStep: { ...auth.twoStep, enabled: e.currentTarget.checked } })} />
            </Stack>
          ) },
        ];
      case "functions":
        return [{ label: "Your editor", content: (
          <Stack gap="sm">
            {fns.isLoading ? <Loader size="sm" /> : fns.data?.runtimeProblem
              ? <Alert color="red" title="This server can't run functions yet">{fns.data.runtimeProblem}</Alert>
              : <Alert color="teal" p="sm">This server can run functions.</Alert>}
            <Text size="sm" c={surface.muted}>Functions are written in your editor and deployed from your terminal or CI:</Text>
            <Code block>{`winche functions init     # a functions/ folder with types for VS Code
winche login              # once
winche functions deploy`}</Code>
          </Stack>
        ) }];
      case "hooks":
        return [{ label: "Hooks", content: (
          <Text size="sm" c={surface.muted}>Once started, add hooks on the Hooks page: when documents, files or users change, call an address of yours or run a ready-made action. Each delivery is retried and logged.</Text>
        ) }];
    }
  })();

  const last = active === steps.length - 1;
  const finish = async () => {
    setBusy(true); setError(null);
    try {
      if (product === "storage" && where === "bucket") await moveToBucket(location(), bucket.secret);
      await api.startProduct(product);
      if ((product === "database" || product === "storage") && rules === "test") await publishTestRules(product);
      if (product === "storage" && storage.data && typeof maxMb === "number")
        await api.saveDataSettings<StorageSettings>("storage", { ...storage.data.settings, maxFileSizeMb: maxMb }, "Setup: largest file");
      if (product === "authentication" && auth) await api.saveSignInSettings(auth, smtpPassword || null, "Setup: sign-in methods");
      await Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Text fw={700} fz={18}>Set up {NAMES[product].toLowerCase()}</Text>}>
      <Stack gap="lg">
        {steps.length > 1 ? (
          <Stepper active={active} onStepClick={setActive} size="sm" allowNextStepsSelect={false}>
            {steps.map((s) => <Stepper.Step key={s.label} label={s.label}>{s.content}</Stepper.Step>)}
          </Stepper>
        ) : steps[0].content}
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="space-between">
          {active > 0 ? <Button variant="subtle" color="gray" onClick={() => setActive(active - 1)}>Back</Button> : <Button variant="default" onClick={onClose}>Cancel</Button>}
          {last
            ? <Button onClick={finish} loading={busy} disabled={steps[active].ready === false}>Start {NAMES[product].toLowerCase()}</Button>
            : <Button onClick={() => setActive(active + 1)} disabled={steps[active].ready === false}>Continue</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
