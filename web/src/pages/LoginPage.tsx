import { useState } from "react";
import { Alert, Anchor, Button, Group, PasswordInput, PinInput, Stack, TextInput } from "@mantine/core";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { AuthCard } from "../components/AuthCard";

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
    } catch { setError("That email and password don't match."); }
    finally { setBusy(false); }
  };

  const submitTwoFactor = async (value = code) => {
    setBusy(true); setError(null);
    try {
      if (useRecovery) await api.loginRecovery(value); else await api.loginTwoFactor(value);
      await refresh();
    } catch { setError(useRecovery ? "That recovery code isn't right." : "That code isn't right. Codes change every 30 seconds."); }
    finally { setBusy(false); }
  };

  if (stage === "twoFactor") {
    return (
      <AuthCard title={useRecovery ? "Use a recovery code" : "Enter your code"}
        subtitle={useRecovery ? "One of the codes you saved when you set up two-step sign-in." : "From the authenticator app on your phone."}>
        <Stack gap="md">
          {useRecovery
            ? <TextInput label="Recovery code" size="md" value={code} autoFocus
                onChange={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submitTwoFactor()} />
            : <Group justify="center">
                <PinInput length={6} type="number" size="lg" oneTimeCode autoFocus aria-label="Authentication code" value={code}
                  onChange={setCode} onComplete={(v) => submitTwoFactor(v)} />
              </Group>}
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Button size="md" onClick={() => submitTwoFactor()} loading={busy}>Verify</Button>
          <Group justify="space-between">
            <Anchor size="sm" c="dimmed" onClick={() => { setStage("password"); setCode(""); setError(null); }}>← Back</Anchor>
            <Anchor size="sm" fw={600} onClick={() => { setUseRecovery(!useRecovery); setError(null); setCode(""); }}>
              {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
            </Anchor>
          </Group>
        </Stack>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in to the console" subtitle="Use your console account."
      footer={<>This is for the people who run the project. Your apps' users sign in in the apps.</>}>
      <Stack gap="md">
        <TextInput label="Email" size="md" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <Stack gap={4}>
          <PasswordInput label="Password" size="md" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
          {state?.selfServiceResetEnabled && (
            <Anchor component={Link} to="/forgot-password" size="sm" fw={600} ta="right">Forgot your password?</Anchor>
          )}
        </Stack>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Button size="md" onClick={submitPassword} loading={busy}>Sign in</Button>
      </Stack>
    </AuthCard>
  );
}

