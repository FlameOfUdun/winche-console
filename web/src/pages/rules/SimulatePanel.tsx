import { useState } from "react";
import {
  Accordion, ActionIcon, Alert, Badge, Button, Group, Select, Stack, Text, TextInput, Textarea,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type { RuleOperation, RuleSubsystem } from "../../api/rules";

const OPERATIONS: RuleOperation[] = ["Get", "List", "Create", "Update", "Delete"];

interface ParamRow { key: string; value: string }

/**
 * "Simulate a request against the draft ruleset" panel — wired to `api.rulesSimulate`. Uses the
 * `rulesJson` prop (the current, possibly-unsaved draft) so admins can test before saving.
 */
export function SimulatePanel({ subsystem, rulesJson }: { subsystem: RuleSubsystem; rulesJson: string }) {
  const [operation, setOperation] = useState<RuleOperation>("Get");
  const [documentPath, setDocumentPath] = useState("");
  const [requestJson, setRequestJson] = useState("");
  const [resourceJson, setResourceJson] = useState("");
  const [params, setParams] = useState<ParamRow[]>([]);

  const simulate = useMutation({
    mutationFn: () => api.rulesSimulate(subsystem, {
      rulesJson,
      operation,
      documentPath,
      resourceJson: resourceJson.trim() || undefined,
      requestJson: requestJson.trim() || undefined,
      params: params.some((p) => p.key.trim())
        ? Object.fromEntries(params.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]))
        : undefined,
    }),
  });

  const updateParam = (i: number, patch: Partial<ParamRow>) =>
    setParams((ps) => ps.map((p, pi) => (pi === i ? { ...p, ...patch } : p)));
  const removeParam = (i: number) => setParams((ps) => ps.filter((_, pi) => pi !== i));
  const addParam = () => setParams((ps) => [...ps, { key: "", value: "" }]);

  const requestError = simulate.isError
    ? (simulate.error instanceof ApiError || simulate.error instanceof Error ? simulate.error.message : "Simulation request failed.")
    : null;

  return (
    <Accordion variant="separated" mt="md">
      <Accordion.Item value="simulate">
        <Accordion.Control>Simulate request</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Group grow align="flex-start">
              <Select label="Operation" data={OPERATIONS} value={operation} allowDeselect={false}
                onChange={(v) => v && setOperation(v as RuleOperation)} />
              <TextInput label="Document path" placeholder="users/abc123" ff="monospace"
                value={documentPath} onChange={(e) => setDocumentPath(e.currentTarget.value)} />
            </Group>

            <Textarea
              label="Request (optional)"
              description='RuleValue map for `request`, e.g. {"auth":{"$path":"users/abc123"}}'
              minRows={2} autosize styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
              value={requestJson} onChange={(e) => setRequestJson(e.currentTarget.value)} />

            <Textarea
              label="Resource (optional)"
              description="RuleValue map for the existing `resource` document"
              minRows={2} autosize styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
              value={resourceJson} onChange={(e) => setResourceJson(e.currentTarget.value)} />

            <Stack gap={4}>
              <Text size="xs" fw={600} c="#5f6368">PARAMS (path captures)</Text>
              {params.map((p, i) => (
                <Group key={i} gap={6} wrap="nowrap">
                  <TextInput size="xs" ff="monospace" placeholder="userId" style={{ flex: 1 }}
                    value={p.key} onChange={(e) => updateParam(i, { key: e.currentTarget.value })} />
                  <TextInput size="xs" ff="monospace" placeholder="value" style={{ flex: 1 }}
                    value={p.value} onChange={(e) => updateParam(i, { value: e.currentTarget.value })} />
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove param" onClick={() => removeParam(i)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content" onClick={addParam}>
                Add param
              </Button>
            </Stack>

            <Group gap={10}>
              <Button size="xs" onClick={() => simulate.mutate()} loading={simulate.isPending} disabled={!documentPath.trim()}>
                Simulate
              </Button>
              {simulate.data && (
                <Badge color={simulate.data.allowed ? "green" : "red"} variant="light">
                  {simulate.data.allowed ? "Allowed" : "Denied"}
                </Badge>
              )}
            </Group>

            {simulate.data?.error && (
              <Alert color={simulate.data.allowed ? "yellow" : "red"} title="Result detail">
                <Text size="sm" ff="monospace">{simulate.data.error}</Text>
              </Alert>
            )}
            {requestError && <Text size="sm" c="red">{requestError}</Text>}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
