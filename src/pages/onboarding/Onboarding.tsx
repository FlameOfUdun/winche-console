import { useEffect, useState, type ReactNode } from "react";
import {
  Alert, Anchor, Box, Button, Group, Loader, PasswordInput, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { isProjectId, projectIdFrom } from "../../api/project";
import { useSession } from "../../auth/session";
import { TwoFactorSetup } from "../../auth/TwoFactorSetup";
import { AddAppDialog } from "../integrity/IntegrityPage";
import { NEW_PROVIDER, type ConsoleSignIn } from "../../api/server";
import { ProviderEditor, saveProvider } from "../server/ConsoleProviders";
import { surface } from "../../theme";
import logoUrl from "../../assets/winche-logo.png";

type StepId = "code" | "account" | "secure" | "providers" | "project" | "app" | "done";

/** Where a first run is, kept across the reload that signing in causes (cleared when it ends). */
export const ONBOARDING_KEY = "winche.onboarding";
const read = (): StepId | null => { try { return sessionStorage.getItem(ONBOARDING_KEY) as StepId | null; } catch { return null; } };
const write = (step: StepId | null) => {
  try { if (step) sessionStorage.setItem(ONBOARDING_KEY, step); else sessionStorage.removeItem(ONBOARDING_KEY); } catch { /* private mode */ }
};
/** The setup code, kept for this tab while setting up (a reload would ask for it again otherwise). */
const CODE_KEY = "winche.onboarding.code";
const readCode = () => { try { return sessionStorage.getItem(CODE_KEY); } catch { return null; } };
const writeCode = (code: string | null) => {
  try { if (code) sessionStorage.setItem(CODE_KEY, code); else sessionStorage.removeItem(CODE_KEY); } catch { /* private mode */ }
};

/** Whether a first run is still going (the gate keeps showing it until it ends). */
export const onboardingInProgress = () => read() !== null;


/**
 * Setup, in three parts: console access (the setup code, the first admin with a password, two-step sign-in, then the
 * team's identity provider if they have one), the project (name, id, products to
 * start; required), and a first app (skippable). `first-run` starts at the account; `create` starts at the project
 * (an admin signing in to a console whose project doesn't exist yet).
 */
export function Onboarding({ mode }: { mode: "first-run" | "create" }) {
  const { state, refresh } = useSession();
  // The server's own console sets up sign-in only: projects are made on its Projects page afterwards.
  const serverConsole = state?.server === true;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [setupCode, setSetupCode] = useState<string>(() => readCode() ?? "");
  const firstStep = (): StepId => {
    if (mode === "create") return "project";
    if (state?.initialized) return read() ?? "project";
    if (state?.setup?.code && !readCode()) return "code";
    return "account";
  };
  const [step, setStepState] = useState<StepId>(firstStep);
  const setStep = (s: StepId) => { if (mode === "first-run") write(s); setStepState(s); };
  const [codeInput, setCodeInput] = useState("");
  // The team's identity provider (optional)
  const [provider, setProvider] = useState<ConsoleSignIn>({ ...NEW_PROVIDER, trustProviderTwoStep: true });
  const [providerSecret, setProviderSecret] = useState("");

  // Account
  const [account, setAccount] = useState({ firstName: "", lastName: "", email: "", password: "" });
  // Project
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [created, setCreated] = useState(false);
  // App
  const [addingApp, setAddingApp] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = useQuery({ queryKey: ["project"], queryFn: api.project, enabled: !serverConsole && !["code", "account"].includes(step) });
  const server = useQuery({ queryKey: ["server-settings"], queryFn: api.serverSettings, enabled: step === "providers", retry: false });
  const afterSecure = () => setStep("providers");
  // No server settings here (a console on its own, not in Winche Server): no providers to add.
  useEffect(() => { if (step === "providers" && server.isError) afterAccess(); }, [step, server.isError]);

  useEffect(() => { if (!idEdited) setId(projectIdFrom(name)); }, [name, idEdited]);
  // No project setup on this console (a library host): nothing more to set up after the account.
  useEffect(() => { if (project.data && !project.data.setup && step === "project") finish(); }, [project.data?.setup, step]);
  // A project made elsewhere (another tab, an earlier run): go past the project steps.
  useEffect(() => {
    if (project.data?.created && step === "project" && !created) setStep(mode === "create" ? "done" : "app");
  }, [project.data?.created]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const checkCode = () => run(async () => {
    await api.checkSetupCode(codeInput.trim());
    setSetupCode(codeInput.trim());
    writeCode(codeInput.trim());
    setStep("account");
  });

  const addProvider = () => run(async () => {
    await saveProvider(server.data!.settings, provider, providerSecret, "Set up with the server");
    await qc.invalidateQueries({ queryKey: ["server-settings"] });
    afterAccess();
  });

  // Sign-in is set up: on to the project (a console of its own), or done (the server's: projects come next, there).
  function afterAccess() { if (serverConsole) finish(); else setStep("project"); }

  const createAccount = () => run(async () => {
    await api.setup({ ...account, setupCode: setupCode || null });
    writeCode(null);
    write("secure");
    await api.login(account.email, account.password);
    setStepState("secure");
    await refresh();
  });

  // Every product starts off: each is set up from its own page.
  const createProject = () => run(async () => {
    await api.createProject({ name: name.trim(), id, products: [], database: null });
    setCreated(true);
    await Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    setStep("app");
  });

  const finish = () => {
    write(null);
    navigate(serverConsole ? "/projects" : "/overview", { replace: true });
    void refresh();
  };

  const parts: { id: string; label: string; steps: StepId[] }[] = [
    ...(mode === "first-run" ? [{ id: "access", label: "Sign-in", steps: ["code", "account", "secure", "providers"] as StepId[] }] : []),
    ...(serverConsole ? [] : [{ id: "project", label: "Project", steps: ["project"] as StepId[] }, { id: "app", label: "App", steps: ["app"] as StepId[] }]),
  ];
  const partIndex = parts.findIndex((p) => p.steps.includes(step));

  return (
    <Box mih="100vh" bg={surface.card} style={{ display: "flex", flexDirection: "column" }}>
      <Group component="header" px={32} py={18} gap="md" style={{ borderBottom: `1px solid ${surface.subtle}` }} wrap="wrap">
        <Group gap={10}>
          <img src={logoUrl} alt="" width={32} height={32} style={{ borderRadius: 8, display: "block" }} />
          <Text fw={600}>{mode === "create" ? "Create your project" : "Set up Winche"}</Text>
        </Group>
        <div style={{ flex: 1 }} />
        {step !== "done" && (
          <Group gap="lg" aria-label="Progress">
            {parts.map((p, i) => (
              <Group key={p.id} gap={8} wrap="nowrap">
                <span style={{
                  width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
                  background: i < partIndex ? "var(--w-pill-on-bg)" : i === partIndex ? "var(--mantine-color-winche-6)" : surface.card,
                  color: i < partIndex ? "var(--w-pill-on-fg)" : i === partIndex ? "#FFFFFF" : surface.muted,
                  border: i > partIndex ? `1px solid ${surface.border}` : undefined,
                }}>{i < partIndex ? <IconCheck size={14} /> : i + 1}</span>
                <Text size="sm" fw={i === partIndex ? 600 : 500} c={i === partIndex ? surface.text : surface.muted}>{p.label}</Text>
              </Group>
            ))}
          </Group>
        )}
      </Group>

      <Box style={{ flex: 1, display: "flex", justifyContent: "center" }} px="md" py={56}>
        <Stack gap={28} w="100%" maw={620}>
          {step === "code" && (
            <Screen title="Enter the setup code" subtitle="It's in the server's log: Setup code: …">
              <TextInput label="Setup code" size="lg" placeholder="XXXX-XXXX-XXXX" autoFocus value={codeInput} autoComplete="off"
                styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", letterSpacing: "0.08em" } }}
                onChange={(e) => setCodeInput(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && codeInput.trim() && checkCode()} />
              {error && <Alert color="red" p="xs">{error}</Alert>}
              <Nav onNext={checkCode} busy={busy} disabled={!codeInput.trim()} />
            </Screen>
          )}

          {step === "account" && (
            <Screen title="Create your admin account" subtitle="A server admin with a password.">
              <Group grow>
                <TextInput label="First name" size="md" value={account.firstName} onChange={(e) => setAccount({ ...account, firstName: e.currentTarget.value })} />
                <TextInput label="Last name" size="md" value={account.lastName} onChange={(e) => setAccount({ ...account, lastName: e.currentTarget.value })} />
              </Group>
              <TextInput label="Email" size="md" type="email" autoComplete="username" value={account.email} onChange={(e) => setAccount({ ...account, email: e.currentTarget.value })} />
              <PasswordInput label="Password" size="md" autoComplete="new-password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.currentTarget.value })}
                onKeyDown={(e) => e.key === "Enter" && createAccount()} />
              {error && <Alert color="red" p="xs">{error}</Alert>}
              <Nav onNext={createAccount} nextLabel="Create account" busy={busy} disabled={!account.email.trim() || !account.password} />
            </Screen>
          )}

          {step === "secure" && (
            <Screen title="Protect your account" subtitle="Add a code from your phone.">
              <TwoFactorSetup forced onDone={async () => { await refresh(); afterSecure(); }} />
              <Group justify="flex-end">
                <Anchor size="sm" c="dimmed" onClick={afterSecure}>Do it later</Anchor>
              </Group>
            </Screen>
          )}

          {step === "providers" && (
            <Screen title="Add your company sign-in?" subtitle="You can also do it later in Server settings.">
              {!server.data ? <Loader size="sm" /> : (
                <ProviderEditor value={provider} onChange={setProvider} secret={providerSecret} onSecret={setProviderSecret} page={server.data} />
              )}
              {error && <Alert color="red" p="xs" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
              <Nav onBack={() => setStep("secure")} backLabel="Two-step sign-in" onSkip={afterAccess} skipLabel="Skip for now" onNext={addProvider} nextLabel="Add provider" busy={busy}
                disabled={!server.data || !provider.issuer || !provider.clientId} />
            </Screen>
          )}

          {step === "project" && (
            <Screen title="Name your project">
              <TextInput label="Project name" size="lg" value={name} autoFocus onChange={(e) => setName(e.currentTarget.value)} />
              <TextInput label="Project id" size="md" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} value={id} error={id && !isProjectId(id) ? "3 to 40 lower-case letters, digits and dashes, starting with a letter." : undefined}
                onChange={(e) => { setIdEdited(true); setId(e.currentTarget.value.toLowerCase()); }} />
              {/* The project is required: no skipping, no cancelling. */}
              <Nav onNext={createProject} nextLabel="Create project" busy={busy} disabled={!name.trim() || !isProjectId(id)} />
            </Screen>
          )}

          {step === "app" && (
            <Screen title="Add your first app" subtitle="You can add apps later under Integrity.">
              <AddAppDialog opened={addingApp}
                onClose={async () => {
                  setAddingApp(false);
                  // Added one: on to the end. Closed without: stay, to add or skip.
                  const integrity = await qc.fetchQuery({ queryKey: ["integrity"], queryFn: api.integrity, staleTime: 0 });
                  if (integrity.apps.length > 0) setStep("done");
                }} />
              <Nav onSkip={() => setStep("done")} skipLabel="Skip for now" onNext={() => setAddingApp(true)} nextLabel="Add an app" />
            </Screen>
          )}

          {step === "done" && (
            <Stack gap="xl" align="flex-start" pt={24}>
              <div style={{ width: 64, height: 64, borderRadius: 999, background: "var(--w-pill-on-bg)", color: "var(--w-pill-on-fg)", display: "grid", placeItems: "center" }}>
                <IconCheck size={32} />
              </div>
              <div>
                <Title order={1} fz={34} style={{ letterSpacing: "-0.02em" }}>{project.data?.created ? `${project.data.name} is ready` : "You're set up"}</Title>
                <Text c={surface.muted} mt={10} fz={16} lh={1.55}>
                  Every product starts off until you choose Get started on its page.
                </Text>
              </div>
              <Button size="lg" onClick={finish}>Go to the console</Button>
            </Stack>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={1} fz={30} style={{ letterSpacing: "-0.01em" }}>{title}</Title>
        {subtitle && <Text c={surface.muted} mt={8} fz={15} lh={1.5}>{subtitle}</Text>}
      </div>
      {children}
    </Stack>
  );
}

function Nav({ onBack, backLabel = "Back", onSkip, skipLabel, onNext, nextLabel = "Continue", busy, disabled }: {
  onBack?: () => void; backLabel?: string; onSkip?: () => void; skipLabel?: string; onNext?: () => void; nextLabel?: string; busy?: boolean; disabled?: boolean;
}) {
  return (
    <Group justify="space-between" pt="sm">
      {onBack ? <Button variant="subtle" color="gray" size="md" onClick={onBack}>{backLabel}</Button> : <span />}
      <Group gap="sm">
        {onSkip && <Button variant="default" size="md" onClick={onSkip}>{skipLabel}</Button>}
        {onNext && <Button size="md" onClick={onNext} loading={busy} disabled={disabled}>{nextLabel}</Button>}
      </Group>
    </Group>
  );
}
