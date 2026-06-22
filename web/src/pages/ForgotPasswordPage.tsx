import { useState } from "react";
import { Anchor, Button, Card, Center, Stack, Text, TextInput, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await api.forgotPassword(email); } catch { /* always show the same result */ }
    finally { setBusy(false); setSent(true); }
  };

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="sm" radius="md" p="xl" w={360}>
        <Stack>
          <Title order={3}>Reset password</Title>
          {sent ? (
            <>
              <Text size="sm">If an account exists for <b>{email}</b>, a reset link has been sent.</Text>
              <Anchor component={Link} to="/" size="sm">Back to sign in</Anchor>
            </>
          ) : (
            <>
              <Text size="sm" c="dimmed">Enter your email and we'll send you a reset link.</Text>
              <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
              <Button onClick={submit} loading={busy}>Send reset link</Button>
              <Anchor component={Link} to="/" size="xs">Back to sign in</Anchor>
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
