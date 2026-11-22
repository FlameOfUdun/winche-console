import { useState } from "react";
import { Button, Group, PasswordInput, SegmentedControl, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { REFERENCE, isKeep, isReference, keepOf, keepValue, readableSources, referenceOf, writableSources, type SecretTest } from "../api/secrets";

/** Where secrets can be read from here (none: only values). Shared by every secret field. */
export function useSecretSources() {
  return useQuery({ queryKey: ["secret-sources"], queryFn: () => api.secretSources(), staleTime: 60_000, retry: false });
}

/** "Secrets Manager" for "AWS Secrets Manager": the store's own name, where AWS is already said. */
export const storeTitle = (title: string) => title.replace(/^AWS\s+/, "");

type Mode = "value" | "reference" | "keep";

/** "AWS Parameter Store" for "aws-ssm:/x", else the reference as written. */
export function sourceTitle(reference: string, sources: { name: string; title: string }[] | undefined) {
  const name = reference.slice(0, reference.indexOf(":"));
  return sources?.find((s) => s.name === name)?.title ?? name;
}

/**
 * A secret to type in: its value (a password field), or, where the app can read secrets from elsewhere (AWS Secrets
 * Manager, Parameter Store), a reference to it, with a Test that reads it now and says whether it works (never the
 * value), or, where the caller may write there, a value Winche keeps in AWS itself. Holds any of these in one string (see
 * secrets): forms keep it like a password.
 */
export function SecretInput({ label, description, value, onChange, disabled, placeholder, savedReference, autoComplete = "new-password", style, multiline }: {
  label: string; description?: React.ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
  /** The saved secret's reference, when it is one: shown, and the form starts on Reference. */
  savedReference?: string | null; autoComplete?: string; style?: React.CSSProperties;
  /** A value of several lines (a PEM key): typed in a text box, kept out of the page's autofill. */
  multiline?: boolean;
}) {
  const sources = useSecretSources();
  const all = sources.data?.sources ?? [];
  const list = readableSources(all);
  const writable = writableSources(all);
  const [chosen, setChosen] = useState<Mode | null>(null);
  const [test, setTest] = useState<SecretTest | null>(null);
  const [testing, setTesting] = useState(false);
  const mode: Mode = isReference(value) ? "reference" : isKeep(value) ? "keep"
    : chosen ?? (savedReference && !value && list.length > 0 ? "reference" : "value");
  const valueBox = (labelled: boolean) => multiline
    ? <Textarea label={labelled ? label : undefined} aria-label={labelled ? undefined : label} description={description} value={value}
        onChange={(e) => onChange(e.currentTarget.value)} disabled={disabled} placeholder={placeholder} autosize minRows={4} maxRows={10}
        ff="monospace" autoComplete="off" spellCheck={false} style={labelled ? style : undefined} />
    : null;
  if (list.length === 0 && writable.length === 0 && !isReference(value) && !isKeep(value))
    return valueBox(true) ?? <PasswordInput label={label} description={description} value={value} onChange={(e) => onChange(e.currentTarget.value)}
      disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} style={style} />;

  const modes = [{ label: "Value", value: "value" }];
  if (list.length > 0 || mode === "reference") modes.push({ label: "Reference", value: "reference" });
  if (writable.length > 0 || mode === "keep") modes.push({ label: "In AWS", value: "keep" });
  const kept = isKeep(value) ? keepOf(value) : null;
  const store = kept?.store || writable[0]?.name || "";
  const pick = (m: Mode) => {
    setChosen(m); setTest(null);
    onChange(m === "reference" ? REFERENCE : m === "keep" ? keepValue(writable[0]?.name ?? "", "") : "");
  };
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
          data={modes} onChange={(m) => pick(m as Mode)} />
      </Group>
      {mode === "value" ? (
        valueBox(false) ?? <PasswordInput aria-label={label} description={description} value={value} onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} />
      ) : mode === "keep" ? (
        <>
          <SegmentedControl size="xs" disabled={disabled} data-testid="secret-store" style={{ alignSelf: "flex-start" }}
            value={store}
            data={(writable.length ? writable : all.filter((s) => s.name === store)).map((s) => ({ label: storeTitle(s.title), value: s.name }))}
            onChange={(store) => onChange(keepValue(store, kept?.value ?? ""))} />
          {multiline
            ? <Textarea aria-label={label} description={description} value={kept?.value ?? ""} disabled={disabled} placeholder={placeholder}
                onChange={(e) => onChange(keepValue(store, e.currentTarget.value))} autosize minRows={4} maxRows={10}
                ff="monospace" autoComplete="off" spellCheck={false} />
            : <PasswordInput aria-label={label} description={description} value={kept?.value ?? ""} disabled={disabled} placeholder={placeholder}
                onChange={(e) => onChange(keepValue(store, e.currentTarget.value))} autoComplete={autoComplete} />}
        </>
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
