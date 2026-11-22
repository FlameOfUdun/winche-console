import { useState } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Menu, Modal, Paper, SegmentedControl, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconArrowRight, IconCloudLock, IconDots, IconFolder, IconKey, IconPackage, IconPlus, IconUsers, IconWebhook } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { secretTyped, writableSources, type SecretSource } from "../../api/secrets";
import type { FunctionSecret } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { EmptyState } from "../../components/EmptyState";
import { SecretInput, sourceTitle, storeTitle, useSecretSources } from "../../components/SecretInput";
import { SourceKeyDialog } from "./SecretSources";
import { ConfirmModal } from "../../components/ConfirmModal";

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Secrets: every API key and password of the project in two lists — the ones functions read (added, replaced, tested
 * and removed here) and those the products keep (the SMTP password, a sync's client secret, a bucket's key: changed
 * where they're used). Each is a value kept here, encrypted, or read from AWS by reference, with the project's own key.
 */
export function SecretsPage() {
  const { state } = useSession();
  const qc = useQueryClient();
  const functions = !!state?.capabilities?.functions;
  const fn = useQuery({ queryKey: ["function-secrets"], queryFn: api.functionSecrets, enabled: functions });
  const kept = useQuery({ queryKey: ["kept-secrets"], queryFn: api.keptSecrets });
  const sources = useSecretSources();
  const [editing, setEditing] = useState<FunctionSecret | "new" | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [tested, setTested] = useState<{ name: string; ok: boolean; problem: string | null } | null>(null);
  const [removing, setRemoving] = useState<FunctionSecret | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const key = sources.data?.keys[0];
  const writable = writableSources(sources.data?.sources ?? []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["function-secrets"] });
  const checkAgain = async () => {
    setChecking(true);
    try { qc.setQueryData(["secret-sources"], await api.secretSources(true)); }
    catch { /* the line keeps what it said */ }
    finally { setChecking(false); }
  };
  const remove = async (name: string) => { await api.removeFunctionSecret(name); await refresh(); };
  const test = async (name: string) => {
    setTested(null);
    try { setTested({ name, ...(await api.testFunctionSecret(name)) }); }
    catch (e) { setTested({ name, ok: false, problem: errorMessage(e) }); }
  };

  const loading = (functions && fn.isLoading) || kept.isLoading;
  const failed = (functions && fn.isError) || kept.isError;
  // The ones a function needs but can't read first.
  const own = [...(fn.data?.secrets ?? [])].sort((a, b) => Number(a.isSet) - Number(b.isSet) || a.name.localeCompare(b.name));
  const products = kept.data?.secrets ?? [];
  const available = (functions ? fn.data?.available : kept.data?.available) ?? true;

  return (
    <>
      <PageBand title="Secrets" description="API keys and passwords, encrypted here and never shown again, or read from AWS."
        actions={functions && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing("new")} disabled={!available}>Add a secret</Button>} />
      <Stack gap="xl" pb={28}>
        {!available && <Alert color="yellow">Secrets need the server's master key.</Alert>}
        {loading ? <Loader size="sm" /> : failed ? <Alert color="red">Couldn't load the secrets: {errorMessage(fn.error ?? kept.error)}</Alert> : (
          <>
            {functions && (
              <SecretGroup title="Read by functions" count={own.length}>
                {own.length === 0 ? (
                  <EmptyState icon={IconKey} title="No secrets yet" description="Add the API keys and passwords your functions read." />
                ) : own.map((s) => (
                  <SecretRow key={s.name} testId="function-secret" icon={s.reference ? IconCloudLock : IconKey} name={s.name} mono
                    used={s.usedBy.length ? `Used by ${s.usedBy.join(", ")}` : "Not used by a function"} changed={s.isSet ? updated(s.setAt!, s.setBy) : null}
                    status={<Kept s={s} isSet={s.isSet} />}
                    note={tested?.name === s.name ? <Text size="xs" c={tested.ok ? "teal" : "red"}>{tested.ok ? "Read just now: it works." : tested.problem}</Text> : null}
                    actions={<>
                      <Button size="xs" variant={s.isSet ? "default" : "filled"} onClick={() => setEditing(s)}>{s.isSet ? "Replace" : "Set"}</Button>
                      {s.isSet && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`More for ${s.name}`}><IconDots size={16} /></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            {s.reference && <Menu.Item onClick={() => test(s.name)}>Test</Menu.Item>}
                            {!s.reference && writable.length > 0 && <Menu.Item onClick={() => setMoving(s.name)}>Move to AWS</Menu.Item>}
                            <Menu.Item color="red" onClick={() => setRemoving(s)}>Remove</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </>} />
                ))}
              </SecretGroup>
            )}
            <SecretGroup title="Kept by the products" count={products.length}>
              {products.length === 0 ? (
                <Text size="sm" c="dimmed">None yet.</Text>
              ) : products.map((s) => (
                <SecretRow key={s.name} testId="kept-secret" icon={PRODUCT_ICON[s.product] ?? IconKey} name={s.title}
                  used={s.product} changed={updated(s.setAt, s.setBy)} status={<Kept s={s} isSet />}
                  actions={s.link && <Button size="xs" variant="subtle" component={Link} to={s.link} rightSection={<IconArrowRight size={14} />}>Open</Button>} />
              ))}
            </SecretGroup>
          </>
        )}
        {key && (
          <Stack gap={2}>
            <Text size="sm" c="dimmed" data-testid="aws-key-line">
              <IconCloudLock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Optional: {key.isSet ? <>the project's own {key.title} reads its AWS references ({when(key.setAt!)}). </> : <>an {key.title} of the project's own, to read secrets from AWS{sources.data?.appCredentials ? " (else the server's own credentials are used)" : ""}. </>}
              <Anchor component="button" size="sm" onClick={() => setKeyOpen(true)} data-testid="aws-key-button">{key.isSet ? "Change" : "Add one"}</Anchor>
            </Text>
            <AccessLine sources={sources.data?.sources ?? []} checking={checking} onCheck={checkAgain} />
          </Stack>
        )}
      </Stack>
      <SecretDialog opened={editing !== null} name={editing === "new" ? undefined : editing?.name}
        savedReference={editing && editing !== "new" ? editing.reference : null} isSet={editing !== "new" && !!editing?.isSet}
        onDone={async (saved) => { setEditing(null); if (saved) await refresh(); }} />
      <ConfirmModal opened={removing !== null} title={`Remove ${removing?.name ?? ""}?`} confirmLabel="Remove"
        message={removing?.managed ? "Functions that read it fail until it's set again. It's deleted in AWS too." : "Functions that read it fail until it's set again."}
        action={() => remove(removing!.name)} onCancel={() => setRemoving(null)} />
      <MoveDialog name={moving} stores={writable} onDone={async (moved) => { setMoving(null); if (moved) await refresh(); }} />
      {key && <SourceKeyDialog k={key} appCredentials={!!sources.data?.appCredentials} opened={keyOpen} onClose={() => setKeyOpen(false)} />}
    </>
  );
}

const PRODUCT_ICON: Record<string, React.ElementType> = { Authentication: IconUsers, Storage: IconFolder, Assets: IconPackage, Webhooks: IconWebhook };

const updated = (at: string, by: string | null) => `Updated ${when(at)}${by ? ` by ${by}` : ""}`;

/** A titled group of secrets: a heading with a count, then its rows in one bordered list. */
function SecretGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Stack gap="sm">
      <Group gap={8}><Text fw={600}>{title}</Text>{count > 0 && <Badge size="sm" variant="light" color="gray" circle={count < 10}>{count}</Badge>}</Group>
      {count === 0 ? children : <Paper withBorder radius="md" style={{ overflow: "hidden" }}>{children}</Paper>}
    </Stack>
  );
}

/** One secret as a row: its name, where it's kept, who uses it, when it changed, then what can be done (wraps on a phone). */
function SecretRow({ icon: Icon, name, mono, used, changed, status, actions, note, testId }: {
  icon: React.ElementType; name: string; mono?: boolean; used: string; changed: string | null; status: React.ReactNode; actions?: React.ReactNode;
  note?: React.ReactNode; testId: string;
}) {
  return (
    <div className="w-secret-row" data-testid={testId}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <Icon size={18} color="var(--w-muted)" style={{ flexShrink: 0 }} />
        <Text fw={600} size="sm" ff={mono ? "monospace" : undefined} style={{ wordBreak: "break-word" }}>{name}</Text>
      </Group>
      <div>{status}</div>
      <div style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed" lineClamp={2}>{used}</Text>
        {note}
      </div>
      <Text size="xs" c="dimmed">{changed ?? "—"}</Text>
      <Group justify="flex-end" gap="xs" wrap="nowrap">{actions}</Group>
    </div>
  );
}

/**
 * Where it's kept: "Encrypted" (a value here), "In AWS Secrets Manager" (kept there by Winche), "From AWS Parameter
 * Store" (a reference set by hand; hover: the reference), or "Not set".
 */
function Kept({ s, isSet }: { s: { reference?: string | null; managed?: boolean }; isSet: boolean }) {
  const sources = useSecretSources();
  if (!isSet) return <Badge color="red" variant="light" tt="none">Not set</Badge>;
  if (s.reference && s.managed) return <Tooltip label={s.reference}><Badge color="blue" variant="light" tt="none">In {sourceTitle(s.reference, sources.data?.sources)}</Badge></Tooltip>;
  if (s.reference) return <Tooltip label={s.reference}><Badge color="blue" variant="light" tt="none">From {sourceTitle(s.reference, sources.data?.sources)}</Badge></Tooltip>;
  return <Badge color="gray" variant="light" tt="none">Encrypted</Badge>;
}

/** Adding a secret (its name and value), or setting or replacing one (its value): a value, or where it's read from. */
function SecretDialog({ opened, name: fixed, isSet, savedReference, onDone }: {
  opened: boolean; name?: string; isSet: boolean; savedReference?: string | null; onDone: (saved: boolean) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = fixed ?? name;
  const badName = !fixed && name !== "" && !SECRET_NAME.test(name);
  const finish = async (saved: boolean) => { setName(""); setValue(""); setError(null); await onDone(saved); };
  const save = async () => {
    setError(null);
    setBusy(true);
    try { await api.setFunctionSecret(target, value); await finish(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={() => finish(false)} radius="lg" size="lg"
      title={<Text fw={700} fz={18}>{!fixed ? "Add a secret" : isSet ? `Replace ${fixed}` : `Set ${fixed}`}</Text>}>
      <Stack gap="md" data-testid="secret-dialog">
        {!fixed && (
          <TextInput label="Name" placeholder="MAIL_API_KEY" ff="monospace" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value.toUpperCase())}
            error={badName ? "Capitals, digits and underscores, starting with a letter" : undefined} />
        )}
        <SecretInput label={fixed ? `New value of ${fixed}` : "Value"} value={value} onChange={setValue} autoComplete="off" savedReference={savedReference}
          description="Never shown again." />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => finish(false)}>Cancel</Button>
          <Button loading={busy} disabled={!target || badName || !secretTyped(value)} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}


/** What the AWS key may do, per store ("Read and write in Secrets Manager · read only in Parameter Store"), or what's wrong. */
export function accessSummary(sources: SecretSource[]): string | null {
  const known = sources.filter((s) => s.access);
  if (known.length === 0) return null;
  const problem = known.find((s) => s.access!.problem)?.access!.problem;
  if (problem) return problem;
  const missing = [...new Set(known.flatMap((s) => s.access!.missing))];
  if (missing.length) return `Missing: ${missing.join(", ")}`;
  const can = (a: NonNullable<SecretSource["access"]>) =>
    a.read && a.write ? "read and write" : a.read ? "read only" : a.write ? "write only" : "no access";
  const text = known.map((s) => `${can(s.access!)} in ${storeTitle(s.title)}`).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One line under the key: what it may do in each store, and a check that asks AWS again. */
function AccessLine({ sources, checking, onCheck }: { sources: SecretSource[]; checking: boolean; onCheck: () => void }) {
  const summary = accessSummary(sources);
  if (!summary) return null;
  const bad = sources.some((s) => s.access && (s.access.problem || s.access.missing.length));
  return (
    <Group gap="xs" wrap="nowrap" pl={20} data-testid="aws-access-line">
      <Text size="sm" c={bad ? "var(--mantine-color-red-text)" : "dimmed"} truncate="end" style={{ minWidth: 0 }} title={summary}>{summary}</Text>
      <Anchor component="button" size="sm" onClick={onCheck} disabled={checking} style={{ flexShrink: 0 }}>{checking ? "Checking…" : "Check again"}</Anchor>
    </Group>
  );
}

/** Moving a value kept here into AWS: which store (of those the caller may write in), then moved. */
function MoveDialog({ name, stores, onDone }: { name: string | null; stores: SecretSource[]; onDone: (moved: boolean) => void | Promise<void> }) {
  const [store, setStore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = store && stores.some((s) => s.name === store) ? store : stores[0]?.name ?? "";
  const finish = async (moved: boolean) => { setStore(null); setError(null); await onDone(moved); };
  const move = async () => {
    setBusy(true); setError(null);
    try { await api.moveFunctionSecret(name!, chosen); await finish(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={name !== null} onClose={() => { if (!busy) finish(false); }} radius="lg" title={<Text fw={700} fz={18}>Move {name} to AWS</Text>}>
      <Stack gap="md" data-testid="move-dialog">
        <SegmentedControl value={chosen} onChange={setStore} data={stores.map((s) => ({ label: storeTitle(s.title), value: s.name }))} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => finish(false)} disabled={busy}>Cancel</Button>
          <Button loading={busy} disabled={!chosen} onClick={move}>Move</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
