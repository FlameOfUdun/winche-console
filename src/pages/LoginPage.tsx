import { useState } from "react";
import { Alert, Anchor, Button, Divider, Group, PasswordInput, PinInput, Stack, TextInput } from "@mantine/core";
import { IconId } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { AuthCard } from "../components/AuthCard";

export function LoginPage() {
  const { state, refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Back from an identity provider for their console two-step (?secondStep=1): the code, straight away.
  const [stage, setStage] = useState<"password" | "twoFactor">(() => new URLSearchParams(window.location.search).get("secondStep") ? "twoFactor" : "password");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  // Back from the identity provider with a reason it didn't work.
  const [error, setError] = useState<string | null>(() => new URLSearchParams(window.location.search).get("signInError"));
  const [busy, setBusy] = useState(false);
  const oidc = state?.oidc ?? null;
  const [showPassword, setShowPassword] = useState(!oidc?.passwordsOnlyForAdmins);
  const viaProvider = (id: string) => {
    const here = new URL(document.baseURI).pathname;
    window.location.href = new URL(`/console/v1/session/oidc/start?provider=${encodeURIComponent(id)}&returnUrl=${encodeURIComponent(here)}`, document.baseURI).toString();
  };

  const submitPassword = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.login(email, password);
      if (res.requiresTwoFactor) setStage("twoFactor");
      else await refresh();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 403 && oidc
        ? `Use ${oidc.providers.map((p) => `“${p.label}”`).join(" or ")}: passwords are for server admins.`
        : "That email and password don't match.");
    }
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
    <AuthCard title="Sign in to the console" subtitle={oidc ? undefined : "Use your console account."}
      footer={<>This is for the people who run the project. Your apps' users sign in in the apps.</>}>
      <Stack gap="md">
        {oidc && (
          <>
            {oidc.providers.map((p, i) => (
              <Button key={p.id} size="md" variant={i === 0 ? "filled" : "default"} leftSection={<IconId size={18} />} onClick={() => viaProvider(p.id)}>{p.label}</Button>
            ))}
            {!showPassword && error && <Alert color="red" p="xs">{error}</Alert>}
            {showPassword
              ? <Divider label="or with a password" labelPosition="center" />
              : <Anchor size="sm" c="dimmed" ta="center" onClick={() => setShowPassword(true)}>Server admin? Sign in with a password</Anchor>}
          </>
        )}
        {showPassword && <>
        <TextInput label="Email" size="md" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <Stack gap={4}>
          <PasswordInput label="Password" size="md" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
          {/* Always there: without email, the page says who can help. */}
          <Anchor component={Link} to="/forgot-password" size="sm" fw={600} ta="right">Forgot your password?</Anchor>
        </Stack>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Button size="md" variant={oidc ? "default" : "filled"} onClick={submitPassword} loading={busy}>Sign in</Button>
        </>}
      </Stack>
    </AuthCard>
  );
}

