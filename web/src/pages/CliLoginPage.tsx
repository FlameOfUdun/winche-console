import { useState } from "react";
import { Alert, Button, Code, Group, Stack, Text } from "@mantine/core";
import { IconTerminal2 } from "@tabler/icons-react";
import { AuthCard } from "../components/AuthCard";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { useSession } from "../auth/session";
import logoUrl from "../assets/winche-logo.png";

/**
 * winche login, for a console with its own accounts: the CLI opened this page and waits on 127.0.0.1. Allowing it
 * sends the browser back to the CLI with a one-time code; the CLI then acts as this user for 90 days.
 */
export function CliLoginPage() {
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

  const icon = (
    <Group gap={12} justify="center" wrap="nowrap">
      <div style={{ width: 52, height: 52, borderRadius: 13, background: "#101828", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
        <IconTerminal2 size={26} />
      </div>
      <Text c="#98A2B3" aria-hidden>· · ·</Text>
      <img src={logoUrl} alt="" width={52} height={52} style={{ borderRadius: 13, display: "block" }} />
    </Group>
  );
  const row = (k: string, v: React.ReactNode) => (
    <Group justify="space-between" gap="md" py={10} wrap="nowrap" style={{ borderTop: "1px solid #F2F4F7" }}>
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
      subtitle={<><b>{name}</b> wants to use this console as you.</>}
      footer="You can end it any time in Project settings → CLI and CI.">
      <Stack gap="md">
        <div style={{ border: "1px solid #E4E7EC", borderRadius: 12, padding: "0 16px" }}>
          <div style={{ marginTop: -1 }}>{row("Signed in as", `${user?.email ?? "you"} · ${user?.role ?? ""}`)}</div>
          {row("It can", "Deploy functions and rules, and anything your role allows")}
          {row("For", <>90 days, or until <Code>winche logout</Code></>)}
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
