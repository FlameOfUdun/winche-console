import { useState } from "react";
import { Alert, Button, PasswordInput, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { AuthCard } from "../components/AuthCard";
import { Circle } from "./ForgotPasswordPage";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.resetPassword(email, token, password); setDone(true); }
    catch { setError("This link isn't valid any more: ask for a new one."); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <AuthCard title="Password changed" icon={<Circle><IconCheck size={24} /></Circle>}>
        <Button size="md" component={Link} to="/">Continue to sign in</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle={email}>
      <Stack gap="md">
        <PasswordInput label="New password" size="md" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        {(!email || !token) && <Text size="sm" c="red">This link is incomplete.</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={!email || !token || !password}>Set password</Button>
      </Stack>
    </AuthCard>
  );
}
