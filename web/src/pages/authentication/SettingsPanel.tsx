import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Code, Group, Loader, Paper, Select, Stack, Switch, Table, Text, TextInput, Textarea, Title, UnstyledButton,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  errorMessage, errorWithList, newProvider, PROVIDER_KINDS, providerProblems, type ProviderCheckResult, type ProvidersSettings, type TokenTestResult,
  type TrustedProvider,
} from "../../api/appAuth";
import { AuthSettingsView } from "./AuthSettingsView";
import { DirectorySection } from "./DirectorySection";
import { SignInSettings, useSignInDraft, type SignInPart } from "./SignInSettings";
import { when } from "./UsersView";
import { EmptyState } from "../../components/EmptyState";
import { IconShieldCheck } from "@tabler/icons-react";

type Section = "providers" | "mapping" | "directory" | "history" | "keys" | SignInPart;
const SIGN_IN: Section[] = ["methods", "security", "email"];
const kindLabel = (k: string) => PROVIDER_KINDS.find((x) => x.value === k)?.label ?? k;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Authentication → Settings: trusted identity providers and how their tokens map to request.auth (one draft, saved
 * together with a reason), the change history, and Winche Auth's token settings when it's installed.
 */
export function SettingsPanel({ wincheAuth, trustedProviders = true }: { wincheAuth: boolean; trustedProviders?: boolean }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["auth-providers"], queryFn: api.authProviders, enabled: trustedProviders });
  const [section, setSection] = useState<Section>(wincheAuth ? "methods" : trustedProviders ? "providers" : "directory");
  const signIn = useSignInDraft();
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
      const v = await api.saveAuthProviders(draft, reason.trim());
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

  const sections: { id: Section; label: string; hint: string }[] = [
    ...(wincheAuth ? [
      { id: "methods" as Section, label: "Sign-in methods", hint: "Winche Auth" },
      { id: "security" as Section, label: "Sessions and security", hint: "lifetimes, lockout, two-step" },
      { id: "email" as Section, label: "Email", hint: "how messages are sent" },
    ] : []),
    ...(trustedProviders ? [
      { id: "providers" as Section, label: "Identity providers", hint: draft ? `${draft.providers.length} provider${draft.providers.length === 1 ? "" : "s"}` : "" },
      { id: "mapping" as Section, label: "Token mapping", hint: "what the rules see" },
    ] : []),
    { id: "directory", label: "User directory", hint: "whose users the Users tab shows" },
    { id: "history", label: "Change history", hint: "who changed what" },
    ...(wincheAuth ? [{ id: "keys" as Section, label: "Tokens and keys", hint: "Winche Auth" }] : []),
  ];

  const needsProviders = section === "providers" || section === "mapping";

  return (
    <Group align="flex-start" gap="lg" wrap="wrap">
      <Stack gap={2} role="tablist" aria-label="Settings" style={{ flex: "1 1 200px", maxWidth: 240 }}>
        {sections.map((s) => (
          <UnstyledButton key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
            style={{ padding: "9px 12px", borderRadius: 8, background: section === s.id ? "var(--mantine-color-blue-0)" : undefined }}>
            <Text size="sm" fw={section === s.id ? 600 : 500} c={section === s.id ? "blue.8" : undefined}>{s.label}</Text>
            <Text size="xs" c="dimmed">{s.hint}</Text>
          </UnstyledButton>
        ))}
        <Text size="xs" c="dimmed" mt="sm">Saved changes apply to every server within seconds and are kept in Change history.</Text>
      </Stack>

      <Stack gap="md" style={{ flex: "999 1 600px", minWidth: 0 }}>
        {needsProviders && saved.isLoading && <Loader size="sm" />}
        {needsProviders && saved.isError && <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>}
        {needsProviders && saved.data && draft && (
          <Text size="xs" c="dimmed" data-testid="settings-source">
            {saved.data.source === "console" && saved.data.version
              ? `Saved in the console: version ${saved.data.version.number}, ${when(saved.data.version.at)}${saved.data.version.by ? ` by ${saved.data.version.by}` : ""}${saved.data.version.reason ? ` — ${saved.data.version.reason}` : ""}.`
              : "These are the starting values from the app's code."}
          </Text>
        )}
        {needsProviders && saved.data && !editable && <Alert color="gray">Read-only. {saved.data.whyReadOnly}</Alert>}

        {section === "providers" && draft && (
          <ProvidersSection draft={draft} setDraft={setDraft} editable={editable}
            onMapping={(name) => { setMappingFor(name); setSection("mapping"); }} />
        )}
        {section === "mapping" && draft && (
          <MappingSection draft={draft} setDraft={setDraft} editable={editable} selected={mappingFor} onSelect={setMappingFor} />
        )}
        {section === "directory" && <DirectorySection wincheAuth={wincheAuth} />}
        {SIGN_IN.includes(section) && <SignInSettings part={section as SignInPart} state={signIn} />}
        {section === "history" && <HistorySection />}
        {section === "keys" && <AuthSettingsView />}

        {(section === "providers" || section === "mapping") && editable && (dirty || error || notice) && (
          <Paper withBorder p="sm" data-testid="save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined }}>
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
      </Stack>
    </Group>
  );
}


// ── Identity providers ────────────────────────────────────────────────────────

function ProvidersSection({ draft, setDraft, editable, onMapping }: {
  draft: ProvidersSettings; setDraft: (d: ProvidersSettings) => void; editable: boolean; onMapping: (name: string) => void;
}) {
  const [editing, setEditing] = useState<{ index: number | null; provider: TrustedProvider } | null>(null);
  const [checks, setChecks] = useState<Record<string, ProviderCheckResult | "checking">>({});

  const check = async (p: TrustedProvider) => {
    setChecks((c) => ({ ...c, [p.name]: "checking" }));
    try {
      const r = await api.checkAuthProvider(p.issuer, p.authority ?? null, p.requireHttps);
      setChecks((c) => ({ ...c, [p.name]: r }));
    } catch (e) {
      setChecks((c) => ({ ...c, [p.name]: { found: false, issuer: null, keys: 0, algorithms: [], error: errorMessage(e) } }));
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={4}>Identity providers</Title>
          <Text size="sm" c="dimmed">Sign-in systems whose tokens the app accepts. Their users sign in there; Winche checks the token.</Text>
        </div>
        {editable && !editing && <Button onClick={() => setEditing({ index: null, provider: newProvider() })}>Add provider</Button>}
      </Group>

      <Paper withBorder p="md">
        <Switch label="Accept tokens issued by Winche Auth" description="The app's own users, when it uses Winche Auth."
          checked={draft.trustWincheAuth} disabled={!editable}
          onChange={(e) => setDraft({ ...draft, trustWincheAuth: e.currentTarget.checked })} />
      </Paper>

      {draft.providers.length === 0 && !editing && (
        <EmptyState compact icon={IconShieldCheck} title="No other identity providers" description="Accept tokens from Keycloak, Auth0, Microsoft Entra ID or any OpenID Connect provider." />
      )}

      {draft.providers.map((p, i) => {
        const c = checks[p.name];
        return (
          <Paper key={`${p.name}-${i}`} withBorder p="md" data-testid="provider-card">
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap">
                <div>
                  <Text fw={600}>{p.displayName || p.name}</Text>
                  <Text size="xs" c="dimmed">{kindLabel(p.kind)} · rules see <Code fz="xs">issuer == '{p.name}'</Code></Text>
                </div>
                {c && c !== "checking" && (
                  <Badge color={c.found ? "teal" : "red"} variant="light" tt="none">{c.found ? "Working" : "Not reachable"}</Badge>
                )}
              </Group>
              <Table fz="sm" withRowBorders={false} verticalSpacing={2}>
                <Table.Tbody>
                  <Table.Tr><Table.Td c="dimmed" w={130}>Address</Table.Td><Table.Td><Text size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>{p.issuer}</Text></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">Audience</Table.Td><Table.Td><Text size="xs" ff="monospace">{p.validateAudience ? p.audiences.join(", ") : "not checked"}</Text></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td c="dimmed">User id from</Table.Td><Table.Td><Text size="xs" ff="monospace">{p.uidClaim}</Text></Table.Td></Table.Tr>
                </Table.Tbody>
              </Table>
              {c === "checking" && <Loader size="xs" />}
              {c && c !== "checking" && (
                <Text size="xs" c={c.found ? "teal.8" : "red.8"}>
                  {c.found ? `Found it: ${c.keys} signing key${c.keys === 1 ? "" : "s"}${c.algorithms.length ? ` (${c.algorithms.join(", ")})` : ""}.` : c.error}
                </Text>
              )}
              <Group gap="xs">
                <Button size="xs" variant="default" onClick={() => check(p)}>Check</Button>
                <Button size="xs" variant="default" onClick={() => onMapping(p.name)}>Token mapping</Button>
                {editable && <Button size="xs" variant="default" onClick={() => setEditing({ index: i, provider: clone(p) })}>Edit</Button>}
                {editable && (
                  <Button size="xs" variant="subtle" color="red" onClick={() => setDraft({ ...draft, providers: draft.providers.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        );
      })}

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
    </Stack>
  );
}

function ProviderForm({ initial, others, onDone, onCancel }: {
  initial: TrustedProvider; others: TrustedProvider[]; onDone: (p: TrustedProvider) => void; onCancel: () => void;
}) {
  const [p, setP] = useState<TrustedProvider>(initial);
  const [check, setCheck] = useState<ProviderCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const problems = providerProblems(p, others);
  const isNew = !initial.issuer;

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await api.checkAuthProvider(p.issuer.trim(), p.authority || null, p.requireHttps);
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
    <Paper withBorder p="md" style={{ borderColor: "var(--mantine-color-blue-5)" }} aria-label="Provider">
      <Stack gap="sm">
        <Title order={5}>{isNew ? "Add a provider" : `Edit ${initial.displayName || initial.name}`}</Title>
        <Group grow align="flex-start" wrap="wrap">
          <Select label="Type" data={PROVIDER_KINDS} value={p.kind} allowDeselect={false} onChange={(v) => setP({ ...p, kind: v ?? "oidc" })} />
          <TextInput label="Name shown here" placeholder="TruCorp Keycloak" value={p.displayName ?? ""} onChange={(e) => setP({ ...p, displayName: e.currentTarget.value })} />
        </Group>
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
        <Group grow align="flex-start" wrap="wrap">
          <TextInput label="Audience" description="The app's client id at the provider (several: separate with commas)." ff="monospace"
            value={p.audiences.join(", ")} disabled={!p.validateAudience}
            onChange={(e) => setP({ ...p, audiences: e.currentTarget.value.split(",").map((a) => a.trim()).filter(Boolean) })} />
          <TextInput label="Short name" description="Rules see it as request.auth.token.issuer." ff="monospace"
            value={p.name} onChange={(e) => setP({ ...p, name: e.currentTarget.value.trim() })} />
        </Group>
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
  const index = Math.max(0, draft.providers.findIndex((p) => p.name === selected));
  const p = draft.providers[index];
  const [token, setToken] = useState("");
  const [result, setResult] = useState<TokenTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  if (!p) return <Text size="sm" c="dimmed">Add an identity provider first: its tokens are what the mapping applies to.</Text>;

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
      setResult(await api.testAuthToken(token, draft));
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
          <Title order={4}>Token mapping</Title>
          <Text size="sm" c="dimmed">How a sign-in becomes <Code>request.auth</Code> in your access rules.</Text>
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
              description="Rules see it as request.auth.uid. Usually sub; keep it if your data is already stored under it."
              onChange={(e) => update({ uidClaim: e.currentTarget.value.trim() })} />
            <Switch label="Pass every field as it is" checked={p.claims === null} disabled={!editable}
              description="Off: only the fields listed below (plus sub, email and name) reach the rules."
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
                <Text size="xs" c="dimmed">
                  A dotted path reads a nested field (<Code fz="xs">realm_access.roles</Code>); <Code fz="xs">given_name + family_name</Code> joins two.
                </Text>
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
                    <Code block fz="xs" data-testid="token-preview">{`request.auth = ${JSON.stringify(result.auth, null, 2)}`}</Code>
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

function HistorySection() {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["settings-history"], queryFn: () => api.settingsHistory() });
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
      if (acting.kind === "restore") await api.restoreSettings(acting.id, reason.trim());
      else await api.resetSettings(acting.area, reason.trim());
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
      <div>
        <Title order={4}>Change history</Title>
        <Text size="sm" c="dimmed">Every saved change to these settings. Restoring one makes a new change, so nothing is lost.</Text>
      </div>
      {versions.length === 0 ? (
        <Text size="sm" c="dimmed">Nothing changed yet: the app's code values apply.</Text>
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
                      {v.reset ? "Back to the app's code values" : v.restoredFrom ? `Version ${v.number}, restored` : `Version ${v.number}`}
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
        <Paper withBorder p="sm" style={{ borderColor: "var(--mantine-color-blue-5)" }}>
          <Stack gap="xs">
            <Text size="sm">
              {acting.kind === "restore" ? `Restore version ${acting.number} as a new change?` : `Put ${acting.title} back to the values in the app's code? Every console change stays in the history.`}
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
