import { useAuthApi } from "./authScope";
import { useState } from "react";
import { Alert, Badge, Button, Loader, Text } from "@mantine/core";
import { EditCard } from "../../components/EditCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../api/appAuth";
import { when } from "./UsersView";

/** Tokens and signing keys: what apps' tokens say, the keys that sign them, rotating now. */
export function AuthSettingsView() {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (config.isLoading) return <Loader size="sm" />;
  if (config.isError || !config.data) return <Alert color="red">Couldn't load the settings: {errorMessage(config.error)}</Alert>;
  const c = config.data;
  if (!c.tokens) return null;
  const tokens = c.tokens;

  const rotate = async () => {
    if (!window.confirm("Make a new signing key now? The current one keeps checking the tokens it signed until they expire.")) return;
    setRotating(true);
    setError(null);
    try {
      await authApi.rotateAppAuthKeys();
      await qc.invalidateQueries({ queryKey: ["app-auth-config"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRotating(false);
    }
  };

  return (
    <EditCard title="Tokens and signing keys" description={`What your apps' tokens say, and the keys that sign them: a new key every ${tokens.keyRotationDays} days; a retiring key still checks the tokens it signed.`}
      actions={<Button variant="subtle" loading={rotating} onClick={rotate}>Rotate now</Button>}
      rows={[
        { label: "Issuer", value: <Text span ff="monospace" fz="sm">{tokens.issuer}</Text> },
        { label: "Audience", value: <Text span ff="monospace" fz="sm">{tokens.audience}</Text> },
        { label: "Public keys", value: <Text span ff="monospace" fz="sm">/.well-known/jwks.json</Text> },
        ...c.keys.map((k) => ({
          label: <Text span ff="monospace" fz="sm">{k.kid}</Text>, hint: `ES256 · made ${when(k.createdAt)}${k.retiredAt ? ` · retired ${when(k.retiredAt)}` : ""}`, testId: "signing-key",
          value: <Badge color={k.retiredAt ? "yellow" : "teal"} variant="light">{k.retiredAt ? "Retiring" : "Signing"}</Badge>,
        })),
        { label: "Stored", value: tokens.keysEncrypted ? "Encrypted" : "Stored unencrypted: set KeyEncryptionSecret to encrypt them" },
      ]}>
      {error && <Alert color="red" mx={24} mb={16}>{error}</Alert>}
    </EditCard>
  );
}
