import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Stack, Table, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { valueText, type HistoryEntry } from "../../api/history";
import { EmptyState } from "../../components/EmptyState";
import { IconHistory, IconSearch } from "@tabler/icons-react";

const PAGE = 50;
const TYPE: Record<HistoryEntry["type"], { label: string; color: string }> = {
  added: { label: "Added", color: "teal" },
  modified: { label: "Changed", color: "blue" },
  removed: { label: "Removed", color: "red" },
};
const KIND: Record<string, string> = { added: "added", changed: "changed", removed: "removed" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "u1" → "u1"; "console:admin@x" → "admin@x (console)"; null → "the app (no user)". */
export function who(actor: string | null): string {
  if (!actor) return "the app (no user)";
  return actor.startsWith("console:") ? `${actor.slice(8)} (console)` : actor;
}

/** "name changed · phone added" — or why there's nothing to show. */
export function summary(e: HistoryEntry): string {
  if (!e.recorded || !e.fields) return "details weren't recorded (before history was turned on)";
  if (e.fields.length === 0) return e.type === "modified" ? "rewritten with the same fields" : "no fields";
  if (e.type !== "modified") return `${e.fields.length} field${e.fields.length === 1 ? "" : "s"}`;
  return e.fields.map((f) => `${f.field} ${KIND[f.kind]}`).join(" · ");
}

/**
 * Who changed which document, when, and how. The path box takes a document (users/u1) or a collection or any path
 * (users) to see everything under it; ?path= in the URL opens one document's history (the document view links here).
 */
export function HistoryView() {
  const [params, setParams] = useSearchParams();
  const [pathText, setPathText] = useState(params.get("path") ?? "");
  const [actorText, setActorText] = useState("");
  const pathInput = useDebounced(pathText.trim().replace(/^\/+|\/+$/g, ""), 300);
  const actor = useDebounced(actorText.trim(), 300);
  const [older, setOlder] = useState<HistoryEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  // An even number of segments is a document (users/u1): its own history; otherwise everything under the path.
  const filter = useMemo(() => {
    if (!pathInput) return { actor };
    const isDoc = pathInput.split("/").length % 2 === 0;
    return isDoc ? { path: pathInput, actor } : { under: pathInput, actor };
  }, [pathInput, actor]);

  useEffect(() => {
    setOlder([]);
    setExhausted(false);
    const next = new URLSearchParams(params);
    if (pathInput) next.set("path", pathInput); else next.delete("path");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const first = useQuery({ queryKey: ["history", filter], queryFn: () => api.history({ ...filter, limit: PAGE }) });
  const entries = useMemo(() => [...(first.data?.entries ?? []), ...older], [first.data, older]);

  const loadOlder = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const page = await api.history({ ...filter, before: last.seq, limit: PAGE });
    setOlder((o) => [...o, ...page.entries]);
    if (page.entries.length < PAGE) setExhausted(true);
  };

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput label="Document or path" placeholder="users/u1, or users for the whole collection" w={360}
          value={pathText} onChange={(e) => setPathText(e.currentTarget.value)} />
        <TextInput label="Changed by" placeholder="u1, or console:admin@…" w={240}
          value={actorText} onChange={(e) => setActorText(e.currentTarget.value)} />
      </Group>

      {first.isLoading && <Loader size="sm" />}
      {first.isError && <Alert color="red">Couldn't load the history: {String((first.error as Error).message)}</Alert>}
      {first.data && entries.length === 0 && (pathInput || actor
        ? <EmptyState compact icon={IconSearch} title="No changes match" description="Try another path or person." />
        : <EmptyState icon={IconHistory} title="No changes yet" description="Every write to a document shows here: who, when and what, with the version before it to restore." />)}

      {entries.length > 0 && (
        <Table highlightOnHover verticalSpacing={6} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={170}>When</Table.Th>
              <Table.Th w={210}>Who</Table.Th>
              <Table.Th w={100}>Change</Table.Th>
              <Table.Th>Document</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((e) => (
              <Fragment key={e.seq}>
                <Table.Tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === e.seq ? null : e.seq)} data-testid="history-row">
                  <Table.Td><Text size="xs" ff="monospace">{new Date(e.at).toLocaleString()}</Text></Table.Td>
                  <Table.Td><Text size="sm">{who(e.actor)}</Text></Table.Td>
                  <Table.Td><Badge color={TYPE[e.type].color} variant="light">{TYPE[e.type].label}</Badge></Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">{e.path}</Text>
                    <Text size="xs" c="dimmed">{summary(e)}</Text>
                  </Table.Td>
                </Table.Tr>
                {open === e.seq && e.fields && e.fields.length > 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={4} style={{ background: "var(--mantine-color-gray-0)" }}>
                      <Table fz="xs" withRowBorders={false} verticalSpacing={2}>
                        <Table.Thead>
                          <Table.Tr><Table.Th w={180}>Field</Table.Th><Table.Th w={90}></Table.Th><Table.Th>Before</Table.Th><Table.Th>After</Table.Th></Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {e.fields.map((f) => (
                            <Table.Tr key={f.field}>
                              <Table.Td><Text size="xs" ff="monospace">{f.field}</Text></Table.Td>
                              <Table.Td><Text size="xs" c="dimmed">{KIND[f.kind]}</Text></Table.Td>
                              <Table.Td><Text size="xs" ff="monospace" td={f.kind === "changed" ? "line-through" : undefined} c="dimmed">{f.before === null ? "—" : valueText(f.before)}</Text></Table.Td>
                              <Table.Td><Text size="xs" ff="monospace">{f.after === null ? "—" : valueText(f.after)}</Text></Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                      <Text size="xs" c="dimmed" mt={4}>version {e.version}</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {(first.data?.entries.length ?? 0) >= PAGE && !exhausted && (
        <Button variant="subtle" onClick={loadOlder} w="fit-content">Older changes</Button>
      )}
    </Stack>
  );
}
