import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { ProductId, ProductSetupRun } from "../../api/project";
import { surface } from "../../theme";

/**
 * A product's setup as it runs on the server: each step waiting, running, done or failed, polled until it ends.
 * Calls <c>onDone</c> once everything has run; a failure shows why, with Retry.
 */
export function SetupProgress({ product, initial, onDone }: { product: ProductId; initial?: ProductSetupRun | null; onDone: () => void }) {
  const [run, setRun] = useState<ProductSetupRun | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.productSetup(product);
        if (stop) return;
        setRun(next);
        if (next.state === "done") { onDone(); return; }
        if (next.state === "failed") return;
      } catch (e) {
        if (!stop) setError(errorMessage(e));
      }
      if (!stop) timer = setTimeout(poll, 600);
    };
    void poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [product, tick]);

  const retry = async () => {
    setError(null);
    try { setRun(await api.startProduct(product)); setTick((t) => t + 1); } catch (e) { setError(errorMessage(e)); }
  };

  const failed = run?.steps.find((s) => s.state === "failed");
  return (
    <Stack gap="sm" data-testid="setup-progress">
      {(run?.steps ?? []).map((s) => (
        <Group key={s.title} gap="sm" wrap="nowrap">
          {s.state === "done" ? <ThemeIcon size={22} radius="xl" color="teal" variant="light"><IconCheck size={14} /></ThemeIcon>
            : s.state === "running" ? <Loader size={18} />
            : s.state === "failed" ? <ThemeIcon size={22} radius="xl" color="red" variant="light"><IconX size={14} /></ThemeIcon>
            : <span style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${surface.border}`, display: "inline-block" }} />}
          <Text size="sm" c={s.state === "waiting" ? surface.muted : undefined} fw={s.state === "running" ? 600 : 400}>{s.title}</Text>
        </Group>
      ))}
      {!run && <Loader size="sm" />}
      {failed && (
        <Alert color="red" title={`${failed.title} didn't work`}>
          <Stack gap="xs">
            <Text size="sm">{failed.error}</Text>
            <Group><Button size="xs" variant="default" onClick={retry}>Retry</Button></Group>
          </Stack>
        </Alert>
      )}
      {error && <Alert color="red" p="xs">{error}</Alert>}
    </Stack>
  );
}
