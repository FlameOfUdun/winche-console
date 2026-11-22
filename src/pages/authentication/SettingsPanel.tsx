import { useAuthApi } from "./authScope";
import { FieldRow } from "../../components/FieldRow";
import { SavedVersionContext, SectionTitle } from "../../components/SectionTitle";
import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Code, Group, Loader, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput, Textarea,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorMessage, errorWithList, newProvider, PROVIDER_KINDS, providerProblems, type ProviderCheckResult, type ProvidersSettings, type TokenTestResult,
  type TrustedProvider,
} from "../../api/appAuth";
import { when } from "./UsersView";
import { EmptyState } from "../../components/EmptyState";
import { CardsPage, EditCard, HistoryButton } from "../../components/EditCard";
import { versionLine } from "../settings/AreaSettings";
import { IconShieldCheck, IconHistory, IconPlus } from "@tabler/icons-react";

const kindLabel = (k: string) => PROVIDER_KINDS.find((x) => x.value === k)?.label ?? k;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Authentication → Trusted issuers: other systems whose tokens Database, Storage and your endpoints accept as they
 * are (a Keycloak realm your apps sign in to), and how their tokens map to request.auth. Unlike sign-in providers,
 * no Winche Auth user is made. One draft, saved together with a reason.
 */
export function TrustedIssuersView() {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["auth-providers"], queryFn: authApi.authProviders });
  const [draft, setDraft] = useState<ProvidersSettings | null>(null);
  const [mappingFor, setMappingFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data) setDraft(clone(saved.data.settings));
  }, [saved.data]);

  const dirty = useMemo(() => !!saved.data && !!draft && JSON.stringify(saved.data.settings) !== JSON.stringify(draft), [saved.data, draft]);
  const editable = !!saved.data?.editable;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const v = await authApi.saveAuthProviders(draft, reason.trim(), saved.data?.version?.number ?? 0);
      setReason("");
      setNotice(`Saved as version ${v.number}. It applies to every server within seconds.`);
      await qc.invalidateQueries({ queryKey: ["auth-providers"] });
      await qc.invalidateQueries({ queryKey: ["settings-history"] });
      await qc.invalidateQueries({ queryKey: ["app-auth-config"] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  if (saved.isLoading) return <Loader size="sm" />;
  if (saved.isError) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;

  return (
    <CardsPage intro={versionLine(saved.data)} history={<HistoryButton subtitle="Authentication settings"><HistorySection /></HistoryButton>}>
      {saved.data && !editable && <Alert color="gray">Read-only. {saved.data.whyReadOnly}</Alert>}
      <SavedVersionContext.Provider value={null}>
        {draft && (
          <>
            <ProvidersSection draft={draft} setDraft={setDraft} editable={editable} onMapping={(name) => setMappingFor(name)} />
            {draft.providers.length > 0 && <MappingSection draft={draft} setDraft={setDraft} editable={editable} selected={mappingFor} onSelect={setMappingFor} />}
          </>
        )}
      </SavedVersionContext.Provider>
      {editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="save-bar" style={{ borderColor: dirty ? "var(--w-accent)" : undefined, position: "sticky", bottom: 8 }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save changes</Button>
                <Button variant="subtle" disabled={busy} onClick={() => { setDraft(clone(saved.data!.settings)); setError(null); }}>Discard</Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
    </CardsPage>
  );
}

// ── Identity providers ────────────────────────────────────────────────────────

function ProvidersSection({ draft, setDraft, editable, onMapping }: {
  draft: ProvidersSettings; setDraft: (d: ProvidersSettings) => void; editable: boolean; onMapping: (name: string) => void;
}) {
  const authApi = useAuthApi();
  const [editing, setEditing] = useState<{ index: number | null; provider: TrustedProvider } | null>(null);
  const [checks, setChecks] = useState<Record<string, ProviderCheckResult | "checking">>({});

  const check = async (p: TrustedProvider) => {
    setChecks((c) => ({ ...c, [p.name]: "checking" }));
    try {
      const r = await authApi.checkAuthProvider(p.issuer, p.authority ?? null, p.requireHttps);
      setChecks((c) => ({ ...c, [p.name]: r }));
    } catch (e) {
      setChecks((c) => ({ ...c, [p.name]: { found: false, issuer: null, keys: 0, algorithms: [], error: errorMessage(e) } }));
    }
  };

  return (
    <Stack gap={20}>
      <EditCard title="Winche Auth"
        actions={
          <Switch label="Accept its tokens" labelPosition="left" aria-label="Accept tokens issued by Winche Auth" checked={draft.trustWincheAuth}
            disabled={!editable} onChange={(e) => setDraft({ ...draft, trustWincheAuth: e.currentTarget.checked })} />
        } />

      <Group justify="flex-end" align="center" wrap="wrap">
        {editable && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ index: null, provider: newProvider() })}>Add issuer</Button>}
      </Group>

      {draft.providers.length === 0 && (
        <EmptyState icon={IconShieldCheck} title="No other issuers" description="Accept tokens from another OpenID Connect provider." />
      )}

      {draft.providers.map((p, i) => {
        const c = checks[p.name];
        return (
          <EditCard key={`${p.name}-${i}`} testId="provider-card" title={p.displayName || p.name}
            description={kindLabel(p.kind)}
            actions={<>
              <Button variant="subtle" onClick={() => check(p)} loading={c === "checking"}>Check</Button>
              <Button variant="subtle" onClick={() => onMapping(p.name)}>Token mapping</Button>
              {editable && <Button variant="subtle" onClick={() => setEditing({ index: i, provider: clone(p) })}>Edit</Button>}
              {editable && (
                <Button variant="subtle" color="red" onClick={() => setDraft({ ...draft, providers: draft.providers.filter((_, j) => j !== i) })}>Remove</Button>
              )}
            </>}
            rows={[
              { label: "Address", value: <Text span ff="monospace" fz="sm">{p.issuer}</Text> },
              { label: "Audience", value: <Text span ff="monospace" fz="sm">{p.validateAudience ? p.audiences.join(", ") : "not checked"}</Text> },
              { label: "User id from", value: <Text span ff="monospace" fz="sm">{p.uidClaim}</Text> },
              ...(c && c !== "checking" ? [{ label: "Check", value: (
                <Group gap={8} wrap="nowrap">
                  <Badge color={c.found ? "teal" : "red"} variant="light">{c.found ? "Working" : "Not reachable"}</Badge>
                  <Text size="xs" c="var(--w-muted)">
                    {c.found ? `${c.keys} signing key${c.keys === 1 ? "" : "s"}${c.algorithms.length ? ` (${c.algorithms.join(", ")})` : ""}` : c.error}
                  </Text>
                </Group>
              ) }] : []),
            ]} />
        );
      })}

      <Modal opened={!!editing} onClose={() => setEditing(null)} size="xl" radius="lg"
        title={<Text fw={700} fz={18}>{editing?.index === null ? "Add an identity provider" : `Edit ${editing?.provider.displayName || editing?.provider.name || "provider"}`}</Text>}>
        {editing && (
          <ProviderForm initial={editing.provider} others={draft.providers.filter((_, j) => j !== editing.index)}
            onCancel={() => setEditing(null)}
            onDone={(p) => {
              const providers = [...draft.providers];
              if (editing.index === null) providers.push(p); else providers[editing.index] = p;
              setDraft({ ...draft, providers });
              setEditing(null);
            }} />
        )}
      </Modal>
    </Stack>
  );
}

function ProviderForm({ initial, others, onDone, onCancel }: {
  initial: TrustedProvider; others: TrustedProvider[]; onDone: (p: TrustedProvider) => void; onCancel: () => void;
}) {
  const authApi = useAuthApi();
  const [p, setP] = useState<TrustedProvider>(initial);
  const [check, setCheck] = useState<ProviderCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const problems = providerProblems(p, others);
  const isNew = !initial.issuer;

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await authApi.checkAuthProvider(p.issuer.trim(), p.authority || null, p.requireHttps);
      setCheck(r);
      if (r.found && !p.name) {
        const guess = p.kind === "oidc" ? new URL(p.issuer).hostname.split(".")[0] : p.kind;
        setP((x) => ({ ...x, name: guess.toLowerCase().replace(/[^a-z0-9_-]/g, "") }));
      }
    } catch (e) {
      setCheck({ found: false, issuer: null, keys: 0, algorithms: [], error: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Paper p={0} aria-label="Provider">
      <Stack gap="sm">
        {/* The dialog's title names it. */}
        <FieldRow>
          <Select label="Type" data={PROVIDER_KINDS} value={p.kind} allowDeselect={false} onChange={(v) => setP({ ...p, kind: v ?? "oidc" })} />
          <TextInput label="Name shown here" placeholder="Company Keycloak" value={p.displayName ?? ""} onChange={(e) => setP({ ...p, displayName: e.currentTarget.value })} />
        </FieldRow>
        <TextInput label="Address (issuer)" placeholder="https://auth.example.com/realms/app" ff="monospace"
          description={p.kind === "keycloak" ? "Keycloak: https://<server>/realms/<realm>" : p.kind === "entra" ? "Entra ID: https://login.microsoftonline.com/<tenant id>/v2.0" : undefined}
          value={p.issuer} onChange={(e) => { setP({ ...p, issuer: e.currentTarget.value }); setCheck(null); }} />
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Button variant="default" onClick={runCheck} loading={checking} disabled={!p.issuer.trim()}>Check address</Button>
          <Switch label="Require https" checked={p.requireHttps} onChange={(e) => setP({ ...p, requireHttps: e.currentTarget.checked })} />
        </Group>
        {check && (
          <Alert color={check.found ? "teal" : "red"} data-testid="provider-check">
            {check.found
              ? `Found it: ${check.issuer}, ${check.keys} signing key${check.keys === 1 ? "" : "s"}${check.algorithms.length ? ` (${check.algorithms.join(", ")})` : ""}.`
              : check.error}
          </Alert>
        )}
        <FieldRow>
          <TextInput label="Audience" description="The app's client id; separate several with commas" ff="monospace"
            value={p.audiences.join(", ")} disabled={!p.validateAudience}
            onChange={(e) => setP({ ...p, audiences: e.currentTarget.value.split(",").map((a) => a.trim()).filter(Boolean) })} />
          <TextInput label="Short name" ff="monospace"
            value={p.name} onChange={(e) => setP({ ...p, name: e.currentTarget.value.trim() })} />
        </FieldRow>
        <Switch label="Check the audience" checked={p.validateAudience} onChange={(e) => setP({ ...p, validateAudience: e.currentTarget.checked })} />
        {problems.length > 0 && <Text size="xs" c="red.8">{problems.join(" ")}</Text>}
        <Group gap="xs">
          <Button disabled={problems.length > 0} onClick={() => onDone({ ...p, issuer: p.issuer.trim() })}>{isNew ? "Add to the list" : "Done"}</Button>
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          <Text size="xs" c="dimmed">Nothing is saved until you save the changes below.</Text>
        </Group>
      </Stack>
    </Paper>
  );
}

// ── Token mapping ─────────────────────────────────────────────────────────────

function MappingSection({ draft, setDraft, editable, selected, onSelect }: {
  draft: ProvidersSettings; setDraft: (d: ProvidersSettings) => void; editable: boolean; selected: string | null; onSelect: (n: string) => void;
}) {
  const authApi = useAuthApi();
  const index = Math.max(0, draft.providers.findIndex((p) => p.name === selected));
  const p = draft.providers[index];
  const [token, setToken] = useState("");
  const [result, setResult] = useState<TokenTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  if (!p) return <Text size="sm" c="dimmed">Add an identity provider first.</Text>;

  const update = (next: Partial<TrustedProvider>) => {
    const providers = [...draft.providers];
    providers[index] = { ...p, ...next };
    setDraft({ ...draft, providers });
  };
  const claims = p.claims ?? [];
  const setClaim = (i: number, c: { from?: string; to?: string }) => update({ claims: claims.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  const test = async () => {
    setTesting(true);
    setTestError(null);
    try {
      setResult(await authApi.testAuthToken(token, draft));
    } catch (e) {
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <SectionTitle>Token mapping</SectionTitle>
        </div>
        {draft.providers.length > 1 && (
          <Select aria-label="Provider" w={240} data={draft.providers.map((x) => ({ value: x.name, label: x.displayName || x.name }))}
            value={p.name} allowDeselect={false} onChange={(v) => v && onSelect(v)} />
        )}
      </Group>

      <Group align="flex-start" gap="md" wrap="wrap">
        <Paper withBorder p="md" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <Stack gap="sm">
            <TextInput label="The user's id comes from" ff="monospace" value={p.uidClaim} disabled={!editable}
              description="Usually sub"
              onChange={(e) => update({ uidClaim: e.currentTarget.value.trim() })} />
            <Switch label="Pass every field as it is" checked={p.claims === null} disabled={!editable}
              description="Off: only the fields below, plus sub, email and name"
              onChange={(e) => update({ claims: e.currentTarget.checked ? null : [] })} />
            {p.claims !== null && (
              <Stack gap={6}>
                <Text size="sm" fw={600}>Fields the rules can use</Text>
                {claims.length === 0 && <Text size="xs" c="dimmed">None yet.</Text>}
                {claims.map((c, i) => (
                  <Group key={i} gap={6} wrap="nowrap" data-testid="mapping-row">
                    <TextInput size="xs" ff="monospace" aria-label="Field in the token" placeholder="realm_access.roles" style={{ flex: 1 }}
                      value={c.from} disabled={!editable} onChange={(e) => setClaim(i, { from: e.currentTarget.value })} />
                    <Text size="xs" c="dimmed">→</Text>
                    <TextInput size="xs" ff="monospace" aria-label="Name in the rules" placeholder="roles" style={{ flex: 1 }}
                      value={c.to} disabled={!editable} onChange={(e) => setClaim(i, { to: e.currentTarget.value.trim() })} />
                    {editable && (
                      <Button size="xs" variant="subtle" color="red" aria-label={`Remove ${c.to || "field"}`}
                        onClick={() => update({ claims: claims.filter((_, j) => j !== i) })}>Remove</Button>
                    )}
                  </Group>
                ))}
                {editable && (
                  <Button size="xs" variant="default" w="fit-content" onClick={() => update({ claims: [...claims, { from: "", to: "" }] })}>Add a field</Button>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="md" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <Stack gap="sm">
            <Text size="sm" fw={600}>Try it with a real token</Text>
            <Textarea label="Paste a token from a signed-in user" autosize minRows={3} maxRows={6} ff="monospace" fz="xs"
              value={token} onChange={(e) => setToken(e.currentTarget.value)} />
            <Button size="xs" w="fit-content" onClick={test} loading={testing} disabled={!token.trim()}>Test with these settings</Button>
            {testError && <Alert color="red">{testError}</Alert>}
            {result && (
              <Stack gap={4} data-testid="token-test">
                {result.checks.map((c, i) => (
                  <Text key={i} size="xs" c={c.outcome === "ok" ? "teal.8" : c.outcome === "warning" ? "orange.8" : "red.8"}>
                    {c.outcome === "ok" ? "✓" : c.outcome === "warning" ? "!" : "✗"} {c.text}
                  </Text>
                ))}
                {result.auth && (
                  <>
                    <Text size="xs" c="dimmed" mt={4}>What your rules will see</Text>
                    <Code block fz="xs" data-testid="token-preview">{JSON.stringify(result.auth, null, 2)}</Code>
                  </>
                )}
              </Stack>
            )}
            <Text size="xs" c="dimmed">The test uses the settings on this page, saved or not.</Text>
          </Stack>
        </Paper>
      </Group>
    </Stack>
  );
}

// ── Change history ────────────────────────────────────────────────────────────

export function HistorySection() {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["settings-history"], queryFn: () => authApi.settingsHistory() });
  const [acting, setActing] = useState<{ kind: "restore"; id: number; number: number } | { kind: "reset"; area: string; title: string } | null>(null);
  const editable = !!history.data?.editable;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!acting) return;
    setBusy(true);
    setError(null);
    try {
      if (acting.kind === "restore") await authApi.restoreSettings(acting.id, reason.trim());
      else await authApi.resetSettings(acting.area, reason.trim());
      setActing(null);
      setReason("");
      for (const key of ["settings-history", "auth-providers", "app-auth-config", "user-directory", "app-users"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  if (history.isLoading) return <Loader size="sm" />;
  const versions = history.data?.versions ?? [];
  return (
    <Stack gap="md">
      {versions.length === 0 ? (
        <EmptyState icon={IconHistory} title="No changes yet" description="Saved changes show up here." />
      ) : (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table verticalSpacing={8} fz="sm" miw={640}>
            <Table.Thead>
              <Table.Tr><Table.Th>When</Table.Th><Table.Th>What</Table.Th><Table.Th>Who</Table.Th><Table.Th>Why</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {versions.map((v) => (
                <Table.Tr key={v.id} data-testid="history-version">
                  <Table.Td><Text size="xs">{when(v.at)}</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>{v.areaTitle}</Text>
                    <Text size="xs" c="dimmed">
                      {v.reset ? "Back to the defaults" : v.restoredFrom ? `Version ${v.number}, restored` : `Version ${v.number}`}
                    </Text>
                  </Table.Td>
                  <Table.Td><Text size="xs">{v.by ?? "—"}</Text></Table.Td>
                  <Table.Td><Text size="xs">{v.reason ?? "—"}</Text></Table.Td>
                  <Table.Td ta="right">
                    {v.current ? (
                      <Group gap={6} justify="flex-end" wrap="nowrap">
                        <Badge color="teal" variant="light" tt="none">In use</Badge>
                        {editable && !v.reset && (
                          <Button size="xs" variant="subtle" color="red" aria-label={`Reset ${v.areaTitle}`}
                            onClick={() => { setActing({ kind: "reset", area: v.area, title: v.areaTitle }); setError(null); }}>Reset</Button>
                        )}
                      </Group>
                    ) : editable && !v.reset ? (
                      <Button size="xs" variant="default" onClick={() => { setActing({ kind: "restore", id: v.id, number: v.number }); setError(null); }}>Restore</Button>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {acting && (
        <Paper withBorder p="sm" style={{ borderColor: "var(--w-accent)" }}>
          <Stack gap="xs">
            <Text size="sm">
              {acting.kind === "restore" ? `Restore version ${acting.number} as a new change?` : `Put ${acting.title} back to the defaults? Every change stays in the history.`}
            </Text>
            <Group gap="xs" wrap="wrap">
              <TextInput placeholder="Why?" aria-label="Reason" style={{ flex: "1 1 260px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              <Button loading={busy} disabled={!reason.trim()} onClick={confirm}>{acting.kind === "restore" ? "Restore" : "Reset"}</Button>
              <Button variant="subtle" onClick={() => setActing(null)}>Cancel</Button>
            </Group>
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
