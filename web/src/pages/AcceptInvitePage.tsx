import { useEffect, useState } from "react";
import { Anchor, Button, Card, Center, Loader, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { InvitePreview } from "../api/types";

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
      setError("Could not complete the invite. Check the required fields and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="sm" radius="md" p="xl" w={380}>
        <Stack>
          <Title order={3}>Accept your invite</Title>
          {loadError ? (
            <Text c="red" size="sm">This invite link is invalid or has expired.</Text>
          ) : !preview ? (
            <Center><Loader /></Center>
          ) : done ? (
            <>
              <Text size="sm">Your account is ready.</Text>
              {preview.requireTwoFactor && (
                <Text size="sm" c="dimmed">You'll set up two-factor authentication after signing in.</Text>
              )}
              <Anchor component={Link} to="/" size="sm">Continue to sign in</Anchor>
            </>
          ) : (
            <>
              <Text size="sm" c="dimmed">{preview.email}</Text>
              <TextInput label="First name" required={preview.requireName} value={firstName}
                onChange={(e) => setFirstName(e.currentTarget.value)} />
              <TextInput label="Last name" required={preview.requireName} value={lastName}
                onChange={(e) => setLastName(e.currentTarget.value)} />
              <PasswordInput label="Password" value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
              {preview.requireTwoFactor && (
                <Text size="xs" c="dimmed">Two-factor authentication will be required after you sign in.</Text>
              )}
              {error && <Text c="red" size="sm">{error}</Text>}
              <Button onClick={submit} loading={busy}
                disabled={!password || (preview.requireName && (!firstName.trim() || !lastName.trim()))}>Set password</Button>
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
