import { useEffect, useState } from "react";
import { Button, Center, Code, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api/client";
import { useSession } from "./session";

/// Two-factor enrollment: shows a QR + manual key, verifies a code, then displays one-time recovery codes.
export function TwoFactorSetup({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const { refresh } = useSession();
  const [info, setInfo] = useState<{ sharedKey: string; authenticatorUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.twoFactorSetup().then(setInfo).catch(() => setError("Could not start setup.")); }, []);

  const enable = async () => {
    setBusy(true); setError(null);
    try { const r = await api.twoFactorEnable(code); setRecovery(r.recoveryCodes); await refresh(); }
    catch { setError("Invalid code. Try again."); }
    finally { setBusy(false); }
  };

  if (recovery) {
    return (
      <Stack>
        <Title order={4}>Save your recovery codes</Title>
        <Text size="sm" c="dimmed">Store these somewhere safe — each can be used once if you lose your authenticator.</Text>
        <Code block>{recovery.join("\n")}</Code>
        <Button onClick={onDone}>Done</Button>
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={4}>Set up two-factor authentication</Title>
      <Text size="sm" c="dimmed">
        {forced ? "Your administrator requires two-factor authentication. " : ""}
        Scan this QR code with an authenticator app, then enter the 6-digit code.
      </Text>
      {info && (
        <>
          <Center><QRCodeSVG value={info.authenticatorUri} size={176} /></Center>
          <Text size="xs" c="dimmed" ta="center">Or enter this key manually: <Code>{info.sharedKey}</Code></Text>
        </>
      )}
      <TextInput label="Authentication code" placeholder="123456" value={code}
        onChange={(e) => setCode(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && enable()} />
      {error && <Text c="red" size="sm">{error}</Text>}
      <Group>
        <Button onClick={enable} loading={busy}>Enable</Button>
        {!forced && <Button variant="default" onClick={onDone}>Cancel</Button>}
      </Group>
    </Stack>
  );
}
