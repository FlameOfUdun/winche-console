import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Anchor, Badge, Button, Checkbox, Group, Loader, Paper, Stack, Stepper, Table, Text, TextInput } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconArrowRight, IconCheck, IconDownload } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorWithList } from "../../api/appAuth";
import type { PluginPackageInfo } from "../../api/functions";
import { secretProblem, secretTyped } from "../../api/secrets";
import { PageBand } from "../../components/NavPageHeader";
import { SecretInput } from "../../components/SecretInput";
import { Access, CatalogBadge, ID_RULE, PluginIcon, SettingsFields, holds, missingSettings, secretFor, shownSecrets, startValues, suggestId, toSend, type Values } from "./shared";
import { installedPath, packagePath } from "./PluginsPage";

/** Installing a package, step by step: what it does, its settings, its secrets, then install. */
export function InstallWizard() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const version = params.get("version");
  const pkg = useQuery({ queryKey: ["plugin-package", name, version], queryFn: () => api.pluginPackage(name, version), enabled: !!name });
  const installed = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  const back = <Anchor component={Link} to={packagePath(name, version)} size="sm"><Group gap={4}><IconArrowLeft size={14} />{name}</Group></Anchor>;
  if (pkg.isLoading || installed.isLoading) return <><PageBand title="Install a plugin">{back}</PageBand><Loader size="sm" /></>;
  if (pkg.isError || !pkg.data) return <><PageBand title="Install a plugin">{back}</PageBand><Alert color="red" style={{ whiteSpace: "pre-line" }}>{errorWithList(pkg.error)}</Alert></>;
  return <Wizard info={pkg.data} taken={(installed.data?.plugins ?? []).map((p) => p.id)} back={back} />;
}

function Wizard({ info, taken, back }: { info: PluginPackageInfo; taken: string[]; back: React.ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = info.manifest;
  const curated = info.curated === true;
  const [step, setStep] = useState(0);
  const [trusted, setTrusted] = useState(curated);
  const [id, setId] = useState(() => {
    const base = suggestId(info.package);
    let n = 2, candidate = base;
    while (taken.includes(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  });
  const [values, setValues] = useState<Values>(() => startValues(m.settings));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number } | null>(null);
  const idProblem = !ID_RULE.test(id) ? "Lowercase letters, digits and -, starting with a letter (up to 30)."
    : taken.includes(id) ? "A plugin is already installed with this id." : null;
  const missing = missingSettings(m.settings, values);
  const asked = shownSecrets(m.secrets, values);
  const unset = asked.filter((s) => s.required && !secretTyped(secrets[s.name]));
  // Every typed secret is checked before anything is installed, so a bad one never leaves the plugin in without it.
  const badSecret = asked.some((s) => !!secretProblem(secrets[s.name]));

  const install = async () => {
    if (badSecret) return;
    setBusy(true); setError(null);
    try {
      const r = await api.installPlugin({ id, package: info.package, version: info.version, settings: toSend(values) });
      for (const s of asked) if (secretTyped(secrets[s.name])) await api.setFunctionSecret(secretFor(id, s.name), secrets[s.name]);
      await qc.invalidateQueries({ queryKey: ["plugins"] });
      await qc.invalidateQueries({ queryKey: ["functions"] });
      await qc.invalidateQueries({ queryKey: ["function-secrets"] });
      setDone({ version: r.version });
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };

  const nav = (canNext: boolean, nextLabel = "Next") => (
    <Group justify="space-between" mt="xl">
      <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={15} />} onClick={() => setStep((s) => s - 1)} disabled={step === 0}>Back</Button>
      <Button rightSection={<IconArrowRight size={15} />} onClick={() => setStep((s) => s + 1)} disabled={!canNext}>{nextLabel}</Button>
    </Group>
  );

  return (
    <>
      <PageBand title={<Group gap={12} wrap="nowrap"><PluginIcon size={40} /><span>Install {m.title}</span></Group>}>
        <Group gap="md" mt="sm">{back}<Text size="sm" ff="monospace" c="dimmed">{info.package} {info.version}</Text><CatalogBadge curated={curated} /></Group>
      </PageBand>
      <div style={{ paddingBottom: 28, maxWidth: 820 }}>
        <Stepper active={done ? 4 : step} onStepClick={(s) => !done && s < step && setStep(s)} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Review" description="What it does">
            <Stack gap="md" mt="lg">
              {m.description && <Text>{m.description}</Text>}
              <Access manifest={m} curated={curated} />
              {!curated && <Checkbox checked={trusted} onChange={(e) => setTrusted(e.currentTarget.checked)}
                label="I trust this package: its functions will act with the server's rights." />}
            </Stack>
            {nav(trusted)}
          </Stepper.Step>
          <Stepper.Step label="Configure" description="Its settings">
            <Stack gap="lg" mt="lg">
              <TextInput label="Install as" withAsterisk value={id} onChange={(e) => setId(e.currentTarget.value.trim())} error={id && idProblem}
                styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
                description="For a second copy, use another id." />
              <SettingsFields settings={m.settings} values={values} onChange={setValues} />
            </Stack>
            {nav(!idProblem && missing.length === 0)}
          </Stepper.Step>
          <Stepper.Step label="Secrets" description="Its keys">
            <Stack gap="md" mt="lg">
              {asked.length === 0 ? <Text size="sm" c="dimmed">It needs no secrets with these settings.</Text> : (
                <>
                  <Text size="sm" c="dimmed">You can also set them later.</Text>
                  {asked.map((s) => (
                    <SecretInput key={s.name} label={`${s.label}${s.required ? "" : " (optional)"} · ${secretFor(id, s.name)}`} description={s.description ?? undefined}
                      value={secrets[s.name] ?? ""} onChange={(v) => setSecrets((x) => ({ ...x, [s.name]: v }))} />
                  ))}
                </>
              )}
            </Stack>
            {nav(!badSecret)}
          </Stepper.Step>
          <Stepper.Step label="Install" description="Check and go">
            <Stack gap="md" mt="lg">
              <Paper withBorder radius="md" p="md">
                <Table withRowBorders={false} verticalSpacing={4}>
                  <Table.Tbody>
                    <Table.Tr><Table.Td c="dimmed" w={160}>Package</Table.Td><Table.Td ff="monospace">{info.package} {info.version}</Table.Td></Table.Tr>
                    <Table.Tr><Table.Td c="dimmed">Installed as</Table.Td><Table.Td><Badge variant="light" tt="none" ff="monospace">{id}</Badge></Table.Td></Table.Tr>
                    {m.settings.filter((s) => values[s.name] !== null && values[s.name] !== undefined && values[s.name] !== "" && holds(s.showIf, values)).map((s) => (
                      <Table.Tr key={s.name}><Table.Td c="dimmed">{s.label}</Table.Td><Table.Td>{typeof values[s.name] === "boolean" ? (values[s.name] ? "Yes" : "No") : String(values[s.name])}</Table.Td></Table.Tr>
                    ))}
                    {asked.length > 0 && <Table.Tr><Table.Td c="dimmed">Secrets</Table.Td><Table.Td>{asked.filter((s) => secretTyped(secrets[s.name])).length} of {asked.length} given</Table.Td></Table.Tr>}
                  </Table.Tbody>
                </Table>
              </Paper>
              {unset.length > 0 && <Alert color="orange" variant="light">Its functions that need {unset.map((s) => s.label).join(", ")} fail until {unset.length === 1 ? "it's" : "they're"} set.</Alert>}
              <Text size="sm" c="dimmed">Rolling back the functions version removes it again.</Text>
              {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            </Stack>
            <Group justify="space-between" mt="xl">
              <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={15} />} onClick={() => setStep(2)} disabled={busy}>Back</Button>
              <Button leftSection={<IconDownload size={15} />} onClick={install} loading={busy} disabled={badSecret}>Install {m.title}</Button>
            </Group>
          </Stepper.Step>
          <Stepper.Completed>
            {done && (
              <Stack gap="md" mt="lg" align="flex-start">
                <Alert color="teal" icon={<IconCheck size={16} />} title={`${m.title} is installed as ${id}`}>
                  Functions version {done.version}. Its page has what's left to do (its setup steps), its settings and secrets.
                </Alert>
                <Button rightSection={<IconArrowRight size={15} />} onClick={() => navigate(installedPath(id))}>Open {id}</Button>
              </Stack>
            )}
          </Stepper.Completed>
        </Stepper>
      </div>
    </>
  );
}
