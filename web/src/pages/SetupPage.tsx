import { useState } from "react";
import { Button, Card, Center, Group, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { api } from "../api/client";
import { useSession } from "../auth/session";

export function SetupPage() {
  const { refresh } = useSession();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.currentTarget.value });

  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.setup(f); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Setup failed."); }
    finally { setBusy(false); }
  };

  return (
    <Center h="100vh" bg="#f6f8fb">
      <Card withBorder shadow="sm" radius="md" p="xl" w={400}>
        <Stack>
          <Title order={3}>Create the first admin</Title>
          <Group grow>
            <TextInput label="First name" value={f.firstName} onChange={up("firstName")} />
            <TextInput label="Last name" value={f.lastName} onChange={up("lastName")} />
          </Group>
          <TextInput label="Email" value={f.email} onChange={up("email")} />
          <PasswordInput label="Password" value={f.password} onChange={up("password")} />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Button onClick={submit} loading={busy}>Create admin</Button>
        </Stack>
      </Card>
    </Center>
  );
}
