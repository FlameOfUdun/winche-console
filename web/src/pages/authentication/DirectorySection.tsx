import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, PasswordInput, SegmentedControl, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList, type DirectoryTestResult, type UserDirectorySettings } from "../../api/appAuth";
import { when } from "./UsersView";

const EMPTY_KEYCLOAK = { serverUrl: "", realm: "", clientId: "", signInEvents: true };

function problems(s: UserDirectorySettings): string[] {
  if (s.kind !== "keycloak") return [];
  const k = s.keycloak ?? EMPTY_KEYCLOAK;
  const out: string[] = [];
  if (!/^https?:\/\/[^/]+/.test(k.serverUrl.trim())) out.push("The Keycloak address must be a full address, like https://auth.example.com.");
  if (!k.realm.trim()) out.push("Give the realm.");
  if (!k.clientId.trim()) out.push("Give the service account's client id.");
  return out;
}

/**
 * Settings → User directory: whose users the Users tab manages — Winche Auth's, or a Keycloak realm's through a
 * service account (its secret saved encrypted, never shown again) — with a connection test before saving.
 */
export function DirectorySection({ wincheAuth }: { wincheAuth: boolean }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["user-directory"], queryFn: api.userDirectory });
  const [draft, setDraft] = useState<UserDirectorySettings | null>(null);
  const [secret, setSecret] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [reason, setReason] = useState("");
  const [test, setTest] = useState<DirectoryTestResult | "testing" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data) setDraft(JSON.parse(JSON.stringify(saved.data.settings)));
  }, [saved.data]);

  const dirty = useMemo(() => !!saved.data && !!draft && (JSON.stringify(saved.data.settings) !== JSON.stringify(draft) || secret !== ""),
    [saved.data, draft, secret]);

  if (saved.isLoading || !draft) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the directory settings: {errorMessage(saved.error)}</Alert>;
  const d = saved.data;
  const editable = d.editable;
  const k = draft.keycloak ?? EMPTY_KEYCLOAK;
  const setK = (patch: Partial<typeof k>) => { setDraft({ ...draft, keycloak: { ...k, ...patch } }); setTest(null); };
  const issues = problems(draft);
  const needsSecret = draft.kind === "keycloak" && !d.secret && !secret;

  const runTest = async () => {
    setTest("testing");
    try { setTest(await api.testUserDirectory({ ...draft, keycloak: k }, secret || null)); }
    catch (e) { setTest({ connected: false, error: errorMessage(e), users: null, permissions: [] }); }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.saveUserDirectory(draft.kind === "keycloak" ? { ...draft, keycloak: k } : draft, secret || null, reason.trim());
      setReason(""); setSecret(""); setReplacing(false);
      setNotice(`Saved as version ${v.number}. The Users tab now follows it.`);
      for (const key of ["user-directory", "settings-history", "app-auth-config", "app-users"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  const kinds = [
    { value: "auto", label: wincheAuth ? "Winche Auth" : "None" },
    { value: "keycloak", label: "Keycloak" },
    ...(wincheAuth ? [{ value: "none", label: "None" }] : []),
  ];

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>User directory</Title>
        <Text size="sm" c="dimmed">Whose users the Users tab shows and manages. Changes made there happen in that system directly.</Text>
      </div>
      <Text size="xs" c="dimmed" data-testid="directory-source">
        {d.source === "console" && d.version
          ? `Saved in the console: version ${d.version.number}, ${when(d.version.at)}${d.version.by ? ` by ${d.version.by}` : ""}${d.version.reason ? ` — ${d.version.reason}` : ""}.`
          : "These are the starting values from the app's code."}
      </Text>
      {!editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}

      <SegmentedControl aria-label="Directory" w="fit-content" disabled={!editable} data={kinds}
        value={draft.kind === "wincheAuth" ? "auto" : draft.kind === "none" && !wincheAuth ? "auto" : draft.kind}
        onChange={(v) => { setDraft({ ...draft, kind: v as UserDirectorySettings["kind"], keycloak: v === "keycloak" ? k : draft.keycloak }); setTest(null); }} />

      {draft.kind !== "keycloak" && (
        <Text size="sm" c="dimmed">
          {wincheAuth && draft.kind !== "none" ? "The app's own users, kept by Winche Auth in its database." : "No Users tab: the app's users live somewhere the console doesn't manage."}
        </Text>
      )}

      {draft.kind === "keycloak" && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              The console signs in to Keycloak as a service account. In Keycloak, make a confidential client with “Service accounts” on, and give its
              service account these roles from <b>realm-management</b>: view-users, manage-users, query-groups, and view-events for sign-ins in Logs.
            </Text>
            <TextInput label="Keycloak address" placeholder="https://auth.example.com" disabled={!editable} value={k.serverUrl}
              onChange={(e) => setK({ serverUrl: e.currentTarget.value })} />
            <Group grow wrap="wrap">
              <TextInput label="Realm" placeholder="smartairway" disabled={!editable} value={k.realm} onChange={(e) => setK({ realm: e.currentTarget.value })} />
              <TextInput label="Client id" placeholder="winche-console" disabled={!editable} value={k.clientId} onChange={(e) => setK({ clientId: e.currentTarget.value })} />
            </Group>
            {d.secret && !replacing ? (
              <Group gap="xs" data-testid="secret-set">
                <Text size="sm">Client secret: <Badge variant="light" color="teal" tt="none">set</Badge></Text>
                <Text size="xs" c="dimmed">{when(d.secret.setAt)}{d.secret.setBy ? ` by ${d.secret.setBy}` : ""} · saved encrypted, never shown</Text>
                {editable && <Button size="xs" variant="subtle" onClick={() => setReplacing(true)}>Replace</Button>}
              </Group>
            ) : (
              <PasswordInput label="Client secret" description="From the client's Credentials tab in Keycloak. Saved encrypted; it can't be read back."
                disabled={!editable || !d.secretsAvailable} value={secret} onChange={(e) => { setSecret(e.currentTarget.value); setTest(null); }} />
            )}
            {!d.secretsAvailable && <Alert color="yellow">Secrets can't be saved: the app needs a master key (WincheConfigOptions.MasterKey).</Alert>}
            <Switch label="Show Keycloak sign-ins and failures in Logs" disabled={!editable} checked={k.signInEvents}
              onChange={(e) => setK({ signInEvents: e.currentTarget.checked })} />
            {issues.length > 0 && <Alert color="yellow" style={{ whiteSpace: "pre-line" }}>{issues.join("\n")}</Alert>}
            <Group gap="xs">
              <Button size="xs" variant="default" disabled={issues.length > 0 || needsSecret} loading={test === "testing"} onClick={runTest}>Test connection</Button>
              {needsSecret && <Text size="xs" c="dimmed">Add the client secret to test.</Text>}
            </Group>
            {test && test !== "testing" && <TestResult result={test} />}
          </Stack>
        </Paper>
      )}

      {editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="directory-save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim() || issues.length > 0 || needsSecret} onClick={save}>Save changes</Button>
                <Button variant="subtle" disabled={busy}
                  onClick={() => { setDraft(JSON.parse(JSON.stringify(d.settings))); setSecret(""); setReplacing(false); setError(null); setTest(null); }}>Discard</Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function TestResult({ result }: { result: DirectoryTestResult }) {
  if (!result.connected) return <Alert color="red" title="Couldn't connect">{result.error}</Alert>;
  const missing = result.permissions.filter((p) => !p.granted);
  return (
    <Stack gap="xs" data-testid="directory-test">
      <Alert color={missing.length || result.error ? "yellow" : "teal"} title="Connected">
        {result.users != null ? `The realm has ${result.users} user${result.users === 1 ? "" : "s"}.` : result.error}
        {missing.length > 0 && " Some roles are missing: add them to the service account in Keycloak (Service account roles → realm-management)."}
      </Alert>
      <Table fz="sm" verticalSpacing={4}>
        <Table.Tbody>
          {result.permissions.map((p) => (
            <Table.Tr key={p.role}>
              <Table.Td w={30}>{p.granted ? "✓" : "✗"}</Table.Td>
              <Table.Td><Text size="sm" ff="monospace">{p.role}</Text></Table.Td>
              <Table.Td><Text size="xs" c={p.granted ? "dimmed" : "red"}>{p.for}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
