import { useState } from "react";
import { Alert, Button, Group, PasswordInput, Stack, TextInput } from "@mantine/core";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { AuthCard } from "../components/AuthCard";

/** First visit, no admin yet: create one. (The full setup wizard replaces this in the next step.) */
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
    <AuthCard title="Create your admin account" subtitle="This server has no admin yet. You'll sign in to the console with this account, and can invite others later." width={460}>
      <Stack gap="md">
        <Group grow>
          <TextInput label="First name" size="md" value={f.firstName} onChange={up("firstName")} />
          <TextInput label="Last name" size="md" value={f.lastName} onChange={up("lastName")} />
        </Group>
        <TextInput label="Email" size="md" type="email" autoComplete="username" value={f.email} onChange={up("email")} />
        <PasswordInput label="Password" size="md" autoComplete="new-password" value={f.password} onChange={up("password")}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Button size="md" onClick={submit} loading={busy}>Create admin</Button>
      </Stack>
    </AuthCard>
  );
}
