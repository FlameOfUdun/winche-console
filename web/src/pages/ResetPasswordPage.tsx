import { useState } from "react";
import { Anchor, Button, Card, Center, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

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
    catch { setError("This link is invalid or has expired."); }
    finally { setBusy(false); }
  };

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="sm" radius="md" p="xl" w={360}>
        <Stack>
          <Title order={3}>Set a new password</Title>
          {done ? (
            <>
              <Text size="sm">Your password has been set.</Text>
              <Anchor component={Link} to="/" size="sm">Continue to sign in</Anchor>
            </>
          ) : (
            <>
              <Text size="sm" c="dimmed">{email}</Text>
              <PasswordInput label="New password" value={password} onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
              {error && <Text c="red" size="sm">{error}</Text>}
              <Button onClick={submit} loading={busy} disabled={!email || !token}>Set password</Button>
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
