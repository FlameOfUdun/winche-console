import { useState } from "react";
import { Button, Group, PasswordInput, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { REFERENCE, isReference, referenceOf, type SecretTest } from "../api/secrets";

/** Where secrets can be read from here (none: only values). Shared by every secret field. */
export function useSecretSources() {
  return useQuery({ queryKey: ["secret-sources"], queryFn: api.secretSources, staleTime: 60_000, retry: false });
}

/** "AWS Parameter Store" for "aws-ssm:/x", else the reference as written. */
export function sourceTitle(reference: string, sources: { name: string; title: string }[] | undefined) {
  const name = reference.slice(0, reference.indexOf(":"));
  return sources?.find((s) => s.name === name)?.title ?? name;
}

/**
 * A secret to type in: its value (a password field), or, where the app can read secrets from elsewhere (AWS Secrets
 * Manager, Parameter Store), a reference to it, with a Test that reads it now and says whether it works (never the
 * value). Holds either in one string (see secrets): forms keep it like a password.
 */
export function SecretInput({ label, description, value, onChange, disabled, placeholder, savedReference, autoComplete = "new-password", style }: {
  label: string; description?: React.ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
  /** The saved secret's reference, when it is one: shown, and the form starts on Reference. */
  savedReference?: string | null; autoComplete?: string; style?: React.CSSProperties;
}) {
  const sources = useSecretSources();
  const list = sources.data?.sources ?? [];
  const [chosen, setChosen] = useState<"value" | "reference" | null>(null);
  const [test, setTest] = useState<SecretTest | null>(null);
  const [testing, setTesting] = useState(false);
  const mode = isReference(value) ? "reference" : chosen ?? (savedReference && !value ? "reference" : "value");
  if (list.length === 0 && !isReference(value))
    return <PasswordInput label={label} description={description} value={value} onChange={(e) => onChange(e.currentTarget.value)}
      disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} style={style} />;

  const typed = isReference(value) ? referenceOf(value) : "";
  const run = async () => {
    setTesting(true); setTest(null);
    try { setTest(await api.testSecretReference(typed)); }
    catch (e) { setTest({ ok: false, problem: errorMessage(e), code: null }); }
    finally { setTesting(false); }
  };
  return (
    <Stack gap={4} style={style}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" fw={500}>{label}</Text>
        <SegmentedControl size="xs" value={mode} disabled={disabled} data-testid="secret-mode"
          data={[{ label: "Value", value: "value" }, { label: "Reference", value: "reference" }]}
          onChange={(m) => { setChosen(m as "value" | "reference"); setTest(null); onChange(m === "reference" ? REFERENCE : ""); }} />
      </Group>
      {mode === "value" ? (
        <PasswordInput aria-label={label} description={description} value={value} onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} />
      ) : (
        <>
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <TextInput aria-label={`${label} (reference)`} ff="monospace" style={{ flex: 1 }} disabled={disabled}
              placeholder={savedReference ?? `${list[0]?.name ?? "aws-ssm"}:…`} value={typed}
              onChange={(e) => { setTest(null); onChange(REFERENCE + e.currentTarget.value); }}
              description={savedReference && !typed
                ? `Read from ${sourceTitle(savedReference, list)}: ${savedReference}. Type another to change it.`
                : <>Where it's kept: {list.map((s, i) => <span key={s.name}>{i > 0 && "; "}<b>{s.name}:</b> {s.hint}</span>)}. Add <b>#field</b> for one field of a JSON secret.</>} />
            <Button variant="default" onClick={run} loading={testing} disabled={!typed || disabled}>Test</Button>
          </Group>
          {test && <Text size="xs" c={test.ok ? "teal" : "red"} data-testid="secret-test">{test.ok ? "Read just now: it works." : test.problem}</Text>}
          {sources.data && !sources.data.appCredentials && (
            <Text size="xs" c="dimmed">Read with the project's own key for that place (Settings → Secrets); the server's own credentials are for its admins.</Text>
          )}
        </>
      )}
    </Stack>
  );
}
