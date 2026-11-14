import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconCheck, IconLock } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { InvitePreview } from "../api/types";
import { AuthCard } from "../components/AuthCard";
import { Circle } from "./ForgotPasswordPage";

const ROLE_MEANS: Record<string, string> = {
  Admin: "everything, including settings and who else can use the console",
  Member: "browse and edit data and files, but not change settings",
  Viewer: "look at data, files and logs, without changing them",
};

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError(true); return; }
    api.invitePreview(token)
      .then((p) => { setPreview(p); setFirstName(p.firstName ?? ""); setLastName(p.lastName ?? ""); })
      .catch(() => setLoadError(true));
  }, [token]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.acceptInvite({ token, password, firstName: firstName || undefined, lastName: lastName || undefined });
      setDone(true);
    } catch {
      setError("Couldn't finish: check the fields and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthCard title="This invite doesn't work" subtitle="It has expired, was used, or was withdrawn. Ask whoever invited you for a new one." icon={<Circle tone="red"><IconLock size={24} /></Circle>}>
        <Button size="md" variant="default" component={Link} to="/">Go to sign in</Button>
      </AuthCard>
    );
  }
  if (!preview) return <AuthCard title="Opening your invite…"><Group justify="center"><Loader /></Group></AuthCard>;
  if (done) {
    return (
      <AuthCard title="You're in" icon={<Circle><IconCheck size={24} /></Circle>}
        subtitle={preview.requireTwoFactor ? "Sign in, then set up two-step sign-in with your authenticator app." : "Sign in with your email and the password you chose."}>
        <Button size="md" component={Link} to="/">Continue to sign in</Button>
      </AuthCard>
    );
  }

  const role = preview.role ?? "Member";
  return (
    <AuthCard title="Join the console" width={440}
      subtitle={<>{preview.invitedBy ? <><b>{preview.invitedBy}</b> invited you</> : "You're invited"} as <b>{role}</b>: you can {ROLE_MEANS[role] ?? "use the console"}.</>}
      footer={preview.expiresAt ? `This invite works until ${new Date(preview.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.` : undefined}>
      <Stack gap="md">
        <TextInput label="Email" size="md" value={preview.email} readOnly variant="filled" />
        <Group grow>
          <TextInput label="First name" size="md" required={preview.requireName} value={firstName} onChange={(e) => setFirstName(e.currentTarget.value)} />
          <TextInput label="Last name" size="md" required={preview.requireName} value={lastName} onChange={(e) => setLastName(e.currentTarget.value)} />
        </Group>
        <PasswordInput label="Password" size="md" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {preview.requireTwoFactor && (
          <Alert color="winche" variant="light" p="sm" icon={<IconLock size={18} />}>
            <Text size="sm">This console asks for two-step sign-in: you'll set it up with an authenticator app when you first sign in.</Text>
          </Alert>
        )}
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Button size="md" onClick={submit} loading={busy}
          disabled={!password || (preview.requireName && (!firstName.trim() || !lastName.trim()))}>Set password and join</Button>
      </Stack>
    </AuthCard>
  );
}
