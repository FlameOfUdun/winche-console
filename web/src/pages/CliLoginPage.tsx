import { useState } from "react";
import { Alert, Button, Card, Center, Code, Group, Stack, Text } from "@mantine/core";
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

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="md" radius="lg" p="xl" w={460}>
        <Stack gap="sm">
          <Group gap="sm">
            <img src={logoUrl} alt="" width={40} height={40} style={{ borderRadius: 10, display: "block" }} />
            <Text fw={600} size="lg">Allow the Winche CLI?</Text>
          </Group>
          {!valid ? (
            <Alert color="red">This sign-in link isn't complete. Run <Code>winche login</Code> again.</Alert>
          ) : done ? (
            <Text size="sm">{done === "allowed" ? "Allowed. You can go back to your terminal." : "Cancelled."}</Text>
          ) : (
            <>
              <Text size="sm">
                <b>{name}</b> wants to use this console as you ({user?.email ?? "you"}, {user?.role ?? "your role"}) for 90 days:
                deploying functions and rules, and anything else your role can do.
              </Text>
              <Text size="sm" c="dimmed">Only allow it if you just ran <Code>winche login</Code>. You can end it any time with <Code>winche logout</Code>, or an admin can under Access → CI tokens.</Text>
              {error && <Alert color="red">{error}</Alert>}
              <Group justify="flex-end" mt="xs">
                <Button variant="default" onClick={cancel} disabled={busy}>Cancel</Button>
                <Button onClick={allow} loading={busy}>Allow</Button>
              </Group>
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
