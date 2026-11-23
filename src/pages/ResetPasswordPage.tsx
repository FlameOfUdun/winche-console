import { useState } from "react";
import { Alert, Button, PasswordInput, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { AuthCard } from "../components/AuthCard";
import { Circle } from "./ForgotPasswordPage";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  // The console accounts' links: …/reset-password?mode=resetPassword&code=… (or mode=unlinkProvider: a sign-in method added)
  const code = params.get("code") ?? "";
  if (params.get("mode") === "unlinkProvider") return <RemoveSignInMethod code={code} />;
  return <ChooseNewPassword code={code} />;
}

/** A "sign-in method added" email's link: removes it, and every device is signed out. */
function RemoveSignInMethod({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true); setError(null);
    try { await api.removeSignInMethod(code); setDone(true); }
    catch { setError("This link isn't valid any more."); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <AuthCard title="It's removed" icon={<Circle><IconCheck size={24} /></Circle>}>
        <Text size="sm" ta="center">That sign-in method no longer signs in to your account, and every device has been signed out. If you didn't add it, change your password too.</Text>
        <Button size="md" component={Link} to="/">Continue to sign in</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Remove the sign-in method">
      <Stack gap="md">
        <Text size="sm">Remove the sign-in method just added to your console account? Every device will be signed out.</Text>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        {!code && <Text size="sm" c="red">This link is incomplete.</Text>}
        <Button size="md" color="red" onClick={remove} loading={busy} disabled={!code}>Remove it</Button>
      </Stack>
    </AuthCard>
  );
}

function ChooseNewPassword({ code }: { code: string }) {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.resetPassword(code, password); setDone(true); }
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
    <AuthCard title="Choose a new password">
      <Stack gap="md">
        <PasswordInput label="New password" size="md" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        {!code && <Text size="sm" c="red">This link is incomplete.</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={!code || !password}>Set password</Button>
      </Stack>
    </AuthCard>
  );
}
