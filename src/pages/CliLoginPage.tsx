import { useState } from "react";
import { Alert, Button, Code, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconTerminal2 } from "@tabler/icons-react";
import { AuthCard } from "../components/AuthCard";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { useSession } from "../auth/session";
import logoUrl from "../assets/winche-logo.png";

/**
 * winche login: the CLI opened this page and waits on 127.0.0.1. Allowing it sends the browser back to the CLI with a
 * one-time code, which it trades for a session of this account. With ?user_code= (or none of the CLI's parameters),
 * it's winche login --no-browser: the CLI shows a code, typed or opened here on any device, and polls until allowed.
 */
export function CliLoginPage() {
  const [params] = useSearchParams();
  if (params.has("user_code") || !params.has("port")) return <DeviceLogin initial={params.get("user_code") ?? ""} />;
  return <LoopbackLogin />;
}

function CliIcon() {
  return (
    <Group gap={12} justify="center" wrap="nowrap">
      <div style={{ width: 52, height: 52, borderRadius: 13, background: "#101828", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
        <IconTerminal2 size={26} />
      </div>
      <Text c="var(--w-faint)" aria-hidden>· · ·</Text>
      <img src={logoUrl} alt="" width={52} height={52} style={{ borderRadius: 13, display: "block" }} />
    </Group>
  );
}

/** winche login --no-browser: check (or type) the code the terminal shows, then allow. */
function DeviceLogin({ initial }: { initial: string }) {
  const { user } = useSession();
  const [code, setCode] = useState(initial.toUpperCase());
  const [found, setFound] = useState<{ name: string; userCode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const look = async () => {
    setBusy(true);
    setError(null);
    try { setFound(await api.cliDevice(code.trim())); }
    catch { setError("That code isn't right or has expired: check the one in your terminal."); }
    finally { setBusy(false); }
  };
  const allow = async () => {
    setBusy(true);
    setError(null);
    try { await api.approveCliDevice(found!.userCode); setDone(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (done) {
    return <AuthCard title="Allowed" icon={<CliIcon />} subtitle="You can go back to your terminal."><></></AuthCard>;
  }
  if (!found) {
    return (
      <AuthCard title="Sign in the Winche CLI" icon={<CliIcon />} width={460}
        subtitle={<>Enter the code <Code>winche login --no-browser</Code> shows in your terminal.</>}>
        <Stack gap="md">
          <TextInput label="Code" placeholder="BCDF-GHJK" value={code} onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", letterSpacing: 2 } }} />
          {error && <Alert color="red">{error}</Alert>}
          <Button size="md" onClick={look} loading={busy} disabled={code.replace(/[^A-Za-z]/g, "").length !== 8}>Continue</Button>
        </Stack>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Allow the Winche CLI?" icon={<CliIcon />} width={460}
      subtitle={<><b>{found.name}</b> wants to use this server as you.</>}
      footer="It's one of your sessions: signing out everywhere ends it too.">
      <Stack gap="md">
        <Text size="sm">Check that your terminal shows <Code fz="md" fw={700}>{found.userCode}</Code>.</Text>
        <Text size="sm" c="dimmed">Signed in as {user?.email ?? "you"}. It can do, in every project you're in, what your role there allows.</Text>
        <Alert color="yellow" p="sm">Only allow this if you just ran <Code>winche login</Code> yourself.</Alert>
        {error && <Alert color="red">{error}</Alert>}
        <Group grow>
          <Button size="md" variant="default" onClick={() => setFound(null)} disabled={busy}>Cancel</Button>
          <Button size="md" onClick={allow} loading={busy}>Allow</Button>
        </Group>
      </Stack>
    </AuthCard>
  );
}

/** winche login: the CLI waits on 127.0.0.1 for the browser to come back with a code. */
function LoopbackLogin() {
  const [params] = useSearchParams();
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"allowed" | "cancelled" | null>(null);
  const port = Number(params.get("port"));
  const state = params.get("state") ?? "";
  const challenge = params.get("challenge") ?? "";
  const name = params.get("name") ?? "winche CLI";
  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && state.length > 0 && challenge.length === 43;
  const back = `http://127.0.0.1:${port}/callback`;

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const { redirect } = await api.approveCliLogin({ challenge, port, state, name });
      setDone("allowed");
      window.location.href = redirect;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const cancel = () => {
    setDone("cancelled");
    window.location.href = `${back}?error=access_denied&error_description=${encodeURIComponent("Cancelled in the browser")}&state=${encodeURIComponent(state)}`;
  };

  const icon = <CliIcon />;
  const row = (k: string, v: React.ReactNode) => (
    <Group justify="space-between" gap="md" py={10} wrap="nowrap" style={{ borderTop: "1px solid var(--w-subtle)" }}>
      <Text size="sm" c="dimmed">{k}</Text>
      <Text size="sm" fw={600} ta="right">{v}</Text>
    </Group>
  );

  if (!valid) {
    return (
      <AuthCard title="Allow the Winche CLI?" icon={icon}>
        <Alert color="red">This sign-in link isn't complete. Run <Code>winche login</Code> again.</Alert>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title={done === "allowed" ? "Allowed" : "Cancelled"} icon={icon}
        subtitle={done === "allowed" ? "You can go back to your terminal." : "Nothing was shared with the CLI."}>
        <></>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Allow the Winche CLI?" icon={icon} width={460}
      subtitle={<><b>{name}</b> wants to use this server as you.</>}
      footer="It's one of your sessions: signing out everywhere ends it too.">
      <Stack gap="md">
        <div style={{ border: "1px solid var(--w-border)", borderRadius: 12, padding: "0 16px" }}>
          <div style={{ marginTop: -1 }}>{row("Signed in as", user?.email ?? "you")}</div>
          {row("It can", "In every project you're in, what your role there allows")}
          {row("Until", <><Code>winche logout</Code>, or you sign out everywhere</>)}
        </div>
        <Alert color="yellow" p="sm">Only allow this if you just ran <Code>winche login</Code> yourself.</Alert>
        {error && <Alert color="red">{error}</Alert>}
        <Group grow>
          <Button size="md" variant="default" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button size="md" onClick={allow} loading={busy}>Allow</Button>
        </Group>
      </Stack>
    </AuthCard>
  );
}
