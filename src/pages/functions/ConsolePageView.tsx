import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text, useComputedColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { PageBand } from "../../components/NavPageHeader";

/** What the page's bridge can ask for (window.winche in the frame). */
type Ask =
  | { op: "call"; id: number; name: string; data: unknown }
  | { op: "confirm"; id: number; text: string; danger?: boolean; confirmLabel?: string | null }
  | { op: "toast"; text: string; kind?: string }
  | { op: "navigate"; path: string }
  | { op: "title"; text: string };

const TOKENS = ["page", "card", "border", "subtle", "hover", "text", "muted", "faint", "accent", "accent-soft", "code-bg"];

/** The console's colours and font, for pages that want to look like it (CSS variables --winche-* in the frame). */
function themeOf(scheme: "light" | "dark") {
  const css = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(`--w-${t}`).trim()]).filter(([, v]) => v));
  return { scheme, colors, font: getComputedStyle(document.body).fontFamily };
}

/** An error from the console's API as the page sees it: { code, message, details }. */
function bridgeError(e: unknown) {
  try {
    const body = JSON.parse((e as Error).message);
    if (body?.error && typeof body.error === "object") return { code: body.error.code ?? "internal", message: body.error.message ?? "", details: body.error.details };
  } catch { /* not JSON */ }
  return { code: "internal", message: errorMessage(e) };
}

/**
 * One of the project's own pages: its files in a sandboxed frame (no access to the console or its session; no border
 * or card of its own: the page's sections are its cards), and the
 * bridge it talks through. The channel is opened once, for the page the console loaded: if the frame navigates
 * elsewhere, the channel closes and the page asks to be reloaded.
 */
export function ConsolePageView() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const scheme = useComputedColorScheme("light");
  const [attempt, setAttempt] = useState(0);
  const opened = useQuery({ queryKey: ["console-page", name, attempt], queryFn: () => api.openConsolePage(name), staleTime: Infinity, retry: false });
  const list = useQuery({ queryKey: ["console-pages"], queryFn: api.consolePages, staleTime: 30_000 });
  const title = list.data?.pages.find((p) => p.name === name)?.title ?? name;
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [asking, setAsking] = useState<{ text: string; danger: boolean; confirmLabel: string | null; answer: (yes: boolean) => void } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const loads = useRef(0);
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;

  const close = useCallback(() => { port.current?.close(); port.current = null; }, []);
  useEffect(() => { loads.current = 0; setLeft(false); setSubtitle(null); return close; }, [opened.data?.url, close]);

  // The page's hello: answered once, with a channel only it holds.
  useEffect(() => {
    const user = opened.data?.user;
    const onMessage = (e: MessageEvent) => {
      if (!user || e.source !== frame.current?.contentWindow || e.data?.winche !== 1 || e.data.op !== "hello" || port.current || loads.current > 1) return;
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = async (m: MessageEvent<Ask>) => {
        const d = m.data;
        const reply = (body: object) => port.current === channel.port1 && channel.port1.postMessage(body);
        switch (d.op) {
          case "call":
            try { reply({ id: d.id, result: (await api.runConsoleAction(d.name, d.data)).data ?? null }); }
            catch (err) { reply({ id: d.id, error: bridgeError(err) }); }
            break;
          case "confirm":
            setAsking({ text: d.text, danger: !!d.danger, confirmLabel: d.confirmLabel ?? null, answer: (yes) => { setAsking(null); reply({ id: d.id, result: yes }); } });
            break;
          case "toast":
            notifications.show({ message: String(d.text).slice(0, 500), color: d.kind === "error" ? "red" : d.kind === "success" ? "teal" : undefined });
            break;
          case "navigate":
            if (typeof d.path === "string" && d.path.startsWith("/") && !d.path.startsWith("//")) navigate(d.path);
            break;
          case "title":
            setSubtitle(String(d.text).slice(0, 120) || null);
            break;
        }
      };
      (e.source as Window).postMessage({ winche: 1, op: "connect" }, "*", [channel.port2]);
      channel.port1.postMessage({ op: "init", user, theme: themeOf(schemeRef.current) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [opened.data, navigate]);

  // Light or dark changed: the page hears it.
  useEffect(() => { port.current?.postMessage({ op: "theme", theme: themeOf(scheme) }); }, [scheme]);

  const onLoad = () => {
    loads.current += 1;
    if (loads.current > 1) { close(); setLeft(true); }   // it navigated: whatever is there now gets no channel
  };

  return (
    <>
      <PageBand title={title} description={subtitle ?? undefined} />
      <Stack gap="sm" pb={24}>
        {opened.isLoading && <Loader size="sm" />}
        {opened.isError && <Alert color="red">Couldn't open this page: {errorMessage(opened.error)}</Alert>}
        {left && (
          <Alert color="yellow" title="The page went somewhere else">
            <Group justify="space-between">
              <Text size="sm">It's no longer connected to the console. Reload it to use it again.</Text>
              <Button size="xs" variant="default" onClick={() => setAttempt((a) => a + 1)}>Reload</Button>
            </Group>
          </Alert>
        )}
        {opened.data && (
          <iframe ref={frame} key={opened.data.url} src={opened.data.url} title={title} onLoad={onLoad} data-testid="console-page-frame"
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" referrerPolicy="no-referrer"
            style={{ width: "100%", height: "calc(100vh - 200px)", minHeight: 420, border: 0, display: "block", background: "transparent" }} />
        )}
      </Stack>
      <Modal opened={!!asking} onClose={() => asking?.answer(false)} title={title} centered>
        <Stack>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{asking?.text}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => asking?.answer(false)}>Cancel</Button>
            <Button color={asking?.danger ? "red" : undefined} onClick={() => asking?.answer(true)}>{asking?.confirmLabel ?? "Confirm"}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
