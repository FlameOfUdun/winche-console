import { useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Badge, Button, Code, Group, Loader, Paper, Stack, Text, TextInput, Textarea, Title, UnstyledButton } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, fillTemplate, PLACEHOLDERS, type EmailTemplateInfo } from "../../api/appAuth";
import { when } from "./UsersView";

const BUTTON: Record<string, string> = { verifyEmail: "Verify email", resetPassword: "Choose a new password", signIn: "Sign in", emailChanged: "Undo this change" };

/** The messages Winche Auth sends: edit, preview, send yourself a test, or go back to the default. */
export function EmailTemplatesView() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  const list = useQuery({ queryKey: ["app-email-templates"], queryFn: api.appEmailTemplates, enabled: !!config.data?.email });
  const [kind, setKind] = useState<EmailTemplateInfo["kind"]>("verifyEmail");
  const current = list.data?.templates.find((t) => t.kind === kind);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The form follows the saved template; messages clear only when another email is picked.
  useEffect(() => {
    if (current) {
      setSubject(current.subject);
      setBody(current.body);
    }
  }, [current]);
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [kind]);

  const appName = config.data?.email?.appName ?? "the app";
  const preview = useMemo(() => fillTemplate(body, appName, kind).split("\n\n"), [body, appName, kind]);
  const changed = !!current && (subject !== current.subject || body !== current.body);

  if (config.isLoading) return <Loader size="sm" />;
  if (!config.data?.email)
    return (
      <Alert color="gray" title="Email isn't set up">
        Turn it on in Settings → Email to send verify, reset and sign-in links.
      </Alert>
    );
  if (list.isLoading || !list.data) return <Loader size="sm" />;

  const act = async <T,>(f: () => Promise<T>, done: (result: T) => string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await f();
      await qc.invalidateQueries({ queryKey: ["app-email-templates"] });
      setNotice(done(result));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      {config.data.email.logLinksOnly && (
        <Alert color="yellow">Messages aren't sent: they're written to the log (<Code>LogLinks()</Code>). Fine locally; not in production.</Alert>
      )}
      <Group align="flex-start" gap="md" wrap="wrap">
        <Paper withBorder p={6} style={{ flex: "1 1 200px", maxWidth: 260 }}>
          <Stack gap={2} role="tablist" aria-label="Emails">
            {list.data.templates.map((t) => (
              <UnstyledButton key={t.kind} role="tab" aria-selected={t.kind === kind} onClick={() => setKind(t.kind)}
                style={{ padding: "9px 12px", borderRadius: 8, background: t.kind === kind ? "var(--mantine-color-blue-0)" : undefined }}>
                <Group justify="space-between" wrap="nowrap" gap={6}>
                  <Text size="sm" fw={t.kind === kind ? 600 : 400} c={t.kind === kind ? "blue.8" : undefined}>{t.name}</Text>
                  {t.isCustom && <Badge size="xs" variant="light" tt="none">Edited</Badge>}
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </Paper>

        {current && (
          <Group align="flex-start" gap="md" wrap="wrap" style={{ flex: "999 1 420px", minWidth: 0 }}>
            <Paper withBorder p="md" style={{ flex: "1 1 340px", minWidth: 0 }}>
              <Stack gap="sm">
                <Title order={5}>{current.name}</Title>
                <TextInput label="Subject" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
                <Textarea label="Message" autosize minRows={8} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
                <Text size="xs" c="dimmed">
                  Placeholders: {PLACEHOLDERS.join(" · ")}. A line with only %LINK% becomes a button. The link works for {current.linkLifetime}.
                </Text>
                {current.isCustom && current.updatedAt && (
                  <Text size="xs" c="dimmed">Edited {when(current.updatedAt)}{current.updatedBy ? ` by ${current.updatedBy}` : ""}.</Text>
                )}
                {error && <Alert color="red">{error}</Alert>}
                {notice && <Alert color="teal">{notice}</Alert>}
                <Group gap="xs">
                  <Button size="xs" loading={busy} disabled={!changed} onClick={() => act(() => api.saveAppEmailTemplate(kind, subject, body), () => "Saved: the next message uses it.")}>Save</Button>
                  <Button size="xs" variant="default" disabled={busy || changed}
                    onClick={() => act(() => api.testAppEmailTemplate(kind), (r) => `Sent to ${r.sentTo}.`)}>
                    Send me a test
                  </Button>
                  {current.isCustom && (
                    <Anchor component="button" size="xs" disabled={busy}
                      onClick={() => window.confirm("Go back to the built-in message?") && act(() => api.resetAppEmailTemplate(kind), () => "Back to the built-in message.")}>
                      Reset to default
                    </Anchor>
                  )}
                </Group>
              </Stack>
            </Paper>

            <Paper withBorder p="md" bg="gray.0" style={{ flex: "1 1 300px", minWidth: 0, borderStyle: "dashed" }} aria-label="Preview">
              <Stack gap="xs">
                <Text size="xs" c="dimmed">Preview, for anna.k@example.com</Text>
                <Paper withBorder p="md">
                  <Stack gap="sm">
                    <Text fw={600} size="sm" data-testid="preview-subject">{fillTemplate(subject, appName, kind)}</Text>
                    {preview.map((p, i) =>
                      p.trim() === "%LINK%" ? (
                        <Button key={i} size="xs" w="fit-content" component="span">{BUTTON[kind]}</Button>
                      ) : (
                        <Text key={i} size="sm" style={{ whiteSpace: "pre-line" }}>{p.replace(/%LINK%/g, "https://…")}</Text>
                      ),
                    )}
                  </Stack>
                </Paper>
                <Text size="xs" c="dimmed">
                  {config.data.email.sender ? `Sent with ${config.data.email.sender}` : config.data.email.logLinksOnly ? "Written to the log" : "No sender registered"} · links open {config.data.email.actionUrl}
                </Text>
              </Stack>
            </Paper>
          </Group>
        )}
      </Group>
    </Stack>
  );
}
