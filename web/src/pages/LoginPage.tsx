import { useState } from "react";
import { Anchor, Button, Card, Center, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";

export function LoginPage() {
  const { state, refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"password" | "twoFactor">("password");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.login(email, password);
      if (res.requiresTwoFactor) setStage("twoFactor");
      else await refresh();
    } catch { setError("Invalid email or password."); }
    finally { setBusy(false); }
  };

  const submitTwoFactor = async () => {
    setBusy(true); setError(null);
    try {
      if (useRecovery) await api.loginRecovery(code); else await api.loginTwoFactor(code);
      await refresh();
    } catch { setError(useRecovery ? "Invalid recovery code." : "Invalid authentication code."); }
    finally { setBusy(false); }
  };

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="sm" radius="md" p="xl" w={360}>
        {stage === "password" ? (
          <Stack>
            <Title order={3}>Sign in</Title>
            <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Button onClick={submitPassword} loading={busy}>Sign in</Button>
            {state?.selfServiceResetEnabled && (
              <Anchor component={Link} to="/forgot-password" size="xs" ta="center">Forgot password?</Anchor>
            )}
          </Stack>
        ) : (
          <Stack>
            <Title order={3}>Two-factor</Title>
            <Text size="sm" c="dimmed">
              {useRecovery ? "Enter one of your recovery codes." : "Enter the code from your authenticator app."}
            </Text>
            <TextInput label={useRecovery ? "Recovery code" : "Authentication code"} value={code}
              onChange={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submitTwoFactor()} autoFocus />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Button onClick={submitTwoFactor} loading={busy}>Verify</Button>
            <Anchor size="xs" onClick={() => { setUseRecovery(!useRecovery); setError(null); setCode(""); }}>
              {useRecovery ? "Use an authenticator code instead" : "Use a recovery code"}
            </Anchor>
          </Stack>
        )}
      </Card>
    </Center>
  );
}
