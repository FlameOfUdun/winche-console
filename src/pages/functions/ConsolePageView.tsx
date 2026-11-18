import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { PageBand } from "../../components/NavPageHeader";

/** What the page's bridge sends: one @winche-technologies/winche-admin call (the operation and its arguments). */
type Ask = { op: "admin"; id: number; call: string; args: unknown; protocol?: number };

/** An error from the console's API as the page sees it: { code, message }. */
function bridgeError(e: unknown) {
  try {
    const body = JSON.parse((e as Error).message);
    if (body?.error && typeof body.error === "object") return { code: body.error.code ?? "internal", message: body.error.message ?? "" };
  } catch { /* not JSON */ }
  return { code: "internal", message: errorMessage(e) };
}

/**
 * One of the project's own pages: its files in a sandboxed frame (no access to the console or its session; no border
 * or card of its own), and the channel its @winche-technologies/winche-admin calls come through, which the console sends to the admin API
 * as the signed-in person (their role limits them). The channel is opened once, for the page the console loaded: if
 * the frame navigates elsewhere, the channel closes and the page asks to be reloaded.
 */
export function ConsolePageView() {
  const { name = "" } = useParams();
  const [attempt, setAttempt] = useState(0);
  const opened = useQuery({ queryKey: ["console-page", name, attempt], queryFn: () => api.openConsolePage(name), staleTime: Infinity, retry: false });
  const list = useQuery({ queryKey: ["console-pages"], queryFn: api.consolePages, staleTime: 30_000 });
  const title = list.data?.pages.find((p) => p.name === name)?.title ?? name;
  const [left, setLeft] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const loads = useRef(0);

  const close = useCallback(() => { port.current?.close(); port.current = null; }, []);
  useEffect(() => { loads.current = 0; setLeft(false); return close; }, [opened.data?.url, close]);

  // The page's hello: answered once, with a channel only it holds.
  useEffect(() => {
    if (!opened.data) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.winche !== 1 || e.data.op !== "hello" || port.current || loads.current > 1) return;
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = async (m: MessageEvent<Ask>) => {
        const d = m.data;
        if (d?.op !== "admin" || typeof d.call !== "string") return;
        const reply = (body: object) => port.current === channel.port1 && channel.port1.postMessage(body);
        try { reply({ id: d.id, result: (await api.runAdmin(name, d.call, d.args ?? {}, d.protocol)).result ?? null }); }
        catch (err) { reply({ id: d.id, error: bridgeError(err) }); }
      };
      (e.source as Window).postMessage({ winche: 1, op: "connect" }, "*", [channel.port2]);
      channel.port1.postMessage({ op: "init" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [opened.data, name]);

  const onLoad = () => {
    loads.current += 1;
    if (loads.current > 1) { close(); setLeft(true); }   // it navigated: whatever is there now gets no channel
  };

  return (
    <>
      <PageBand title={title} />
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
    </>
  );
}
