import { useState } from "react";
import { Anchor, Button, Stack, Text, TextInput } from "@mantine/core";
import { IconMail } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { AuthCard } from "../components/AuthCard";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await api.forgotPassword(email); } catch { /* always show the same result */ }
    finally { setBusy(false); setSent(true); }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email" icon={<Circle><IconMail size={24} /></Circle>}>
        <Stack gap="md">
          <Text size="sm" ta="center" c="dimmed">If <b>{email}</b> has a console account, a link to choose a new password is on its way.</Text>
          <Button size="md" variant="default" component={Link} to="/">Back to sign in</Button>
        </Stack>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <Stack gap="md">
        <TextInput label="Email" size="md" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        <Button size="md" onClick={submit} loading={busy} disabled={!email.trim()}>Send a reset link</Button>
        <Anchor component={Link} to="/" size="sm" c="dimmed" ta="center">← Back to sign in</Anchor>
      </Stack>
    </AuthCard>
  );
}

export function Circle({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "red" }) {
  const c = tone === "green" ? { bg: "#ECFDF3", fg: "#067647" } : { bg: "#FEF3F2", fg: "#B42318" };
  return <div style={{ width: 52, height: 52, borderRadius: 999, background: c.bg, color: c.fg, display: "grid", placeItems: "center" }}>{children}</div>;
}
