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
import { FlutterSteps, SdkPicker } from "../apps/AppsPage";
import { surface } from "../../theme";
import logoUrl from "../../assets/winche-logo.png";

type StepId = "account" | "secure" | "project" | "app" | "done";

/** Where a first run is, kept across the reload that signing in causes (cleared when it ends). */
export const ONBOARDING_KEY = "winche.onboarding";
const read = (): StepId | null => { try { return sessionStorage.getItem(ONBOARDING_KEY) as StepId | null; } catch { return null; } };
const write = (step: StepId | null) => {
  try { if (step) sessionStorage.setItem(ONBOARDING_KEY, step); else sessionStorage.removeItem(ONBOARDING_KEY); } catch { /* private mode */ }
};
/** Whether a first run is still going (the gate keeps showing it until it ends). */
export const onboardingInProgress = () => read() !== null;


/**
 * Setup, in three parts: console access (the first admin, then two-step sign-in), the project (name, id, products to
 * start; required), and a first app (skippable). `first-run` starts at the account; `create` starts at the project
 * (an admin signing in to a console whose project doesn't exist yet).
 */
export function Onboarding({ mode }: { mode: "first-run" | "create" }) {
  const { state, refresh } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStepState] = useState<StepId>(() => mode === "create" ? "project" : (!state?.initialized ? "account" : read() ?? "project"));
  const setStep = (s: StepId) => { if (mode === "first-run") write(s); setStepState(s); };

  // Account
  const [account, setAccount] = useState({ firstName: "", lastName: "", email: "", password: "" });
  // Project
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [created, setCreated] = useState(false);
  // App
  const [sdk, setSdk] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apps = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]), enabled: step === "app" });
  const project = useQuery({ queryKey: ["project"], queryFn: api.project, enabled: step !== "account" });

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

  const createAccount = () => run(async () => {
    await api.setup(account);
    write("secure");
    await api.login(account.email, account.password);
    setStepState("secure");
    await refresh();
  });

  // Every product starts off: each is set up from its own page.
  const createProject = () => run(async () => {
    await api.createProject({ name: name.trim(), id, products: [] });
    setCreated(true);
    await Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    setStep("app");
  });

  const finish = () => {
    write(null);
    navigate("/overview", { replace: true });
    void refresh();
  };

  const parts: { id: string; label: string; steps: StepId[] }[] = [
    ...(mode === "first-run" ? [{ id: "access", label: "Console access", steps: ["account", "secure"] as StepId[] }] : []),
    { id: "project", label: "Project", steps: ["project"] },
    { id: "app", label: "App", steps: ["app"] },
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
                  background: i < partIndex ? "#ECFDF3" : i === partIndex ? "var(--mantine-color-winche-6)" : surface.card,
                  color: i < partIndex ? "#067647" : i === partIndex ? "#FFFFFF" : surface.muted,
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
          {step === "account" && (
            <Screen title="Create your admin account" subtitle="You'll sign in to this console with it. You can invite your team later.">
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
            <Screen title="Protect your account" subtitle="This console can change who reads your data, so it asks for a code from your phone too.">
              <TwoFactorSetup forced onDone={async () => { await refresh(); setStep("project"); }} />
              <Group justify="flex-end">
                <Anchor size="sm" c="dimmed" onClick={() => setStep("project")}>Do it later</Anchor>
              </Group>
            </Screen>
          )}

          {step === "project" && (
            <Screen title="Name your project" subtitle="Your apps see its name and id. Products are set up later, each from its own page.">
              <TextInput label="Project name" size="lg" value={name} autoFocus onChange={(e) => setName(e.currentTarget.value)} />
              <TextInput label="Project id" size="md" ff="monospace" value={id} error={id && !isProjectId(id) ? "3 to 40 lower-case letters, digits and dashes, starting with a letter." : undefined}
                onChange={(e) => { setIdEdited(true); setId(e.currentTarget.value.toLowerCase()); }} />
              {/* The project is required: no skipping, no cancelling. */}
              <Nav onNext={createProject} nextLabel="Create project" busy={busy} disabled={!name.trim() || !isProjectId(id)} />
            </Screen>
          )}

          {step === "app" && (
            <Screen title="Add your first app" subtitle={sdk ? undefined : "What's it built with?"}>
              {!sdk && <SdkPicker onPick={setSdk} />}
              {sdk && (apps.data ? <FlutterSteps baseUrl={apps.data.setup.baseUrl} snippet={apps.data.snippet} /> : <Loader size="sm" />)}
              <Nav onBack={sdk ? () => setSdk(null) : undefined} onSkip={sdk ? undefined : () => setStep("done")} skipLabel="Skip for now"
                onNext={sdk ? () => setStep("done") : undefined} nextLabel="Done" />
            </Screen>
          )}

          {step === "done" && (
            <Stack gap="xl" align="flex-start" pt={24}>
              <div style={{ width: 64, height: 64, borderRadius: 999, background: "#ECFDF3", color: "#067647", display: "grid", placeItems: "center" }}>
                <IconCheck size={32} />
              </div>
              <div>
                <Title order={1} fz={34} style={{ letterSpacing: "-0.02em" }}>{project.data?.created ? `${project.data.name} is ready` : "You're set up"}</Title>
                <Text c={surface.muted} mt={10} fz={16} lh={1.55}>
                  Every product starts off: open Database, Storage, Authentication, Functions or Hooks and choose Get started when you need it.
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
