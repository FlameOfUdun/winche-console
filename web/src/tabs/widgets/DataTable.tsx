import { Button, Group, Pagination, Table } from "@mantine/core";
import type { CommandSpec, LayoutNode, TableData } from "../../api/tabs";
import { useTabRuntime } from "../runtime";
import type { FilterState } from "../nodes/render";

type TableNode = Extract<LayoutNode, { type: "widget"; kind: "table" }>;

export function DataTable({ node, data, filters }: { node: TableNode; data: TableData; filters: FilterState }) {
  const rt = useTabRuntime();
  const actions = (node.rowActions ?? [])
    .map((id) => rt.commands[id])
    .filter((c): c is CommandSpec => !!c && rt.canRun(c));
  const pageKey = `page:${node.id}`;
  const page = Number(filters.values[pageKey] ?? "1") || 1;
  const pageSize = node.paginate ?? 0;
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {data.columns.map((c, i) => <Table.Th key={i}>{c}</Table.Th>)}
            {actions.length > 0 && <Table.Th />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.rows.map((row) => (
            <Table.Tr key={row.key}>
              {row.cells.map((cell, j) => <Table.Td key={j}>{String(cell ?? "")}</Table.Td>)}
              {actions.length > 0 && (
                <Table.Td>
                  <Group gap="xs">
                    {actions.map((c) => (
                      <Button key={c.id} size="xs" variant="light"
                        onClick={() => rt.runCommand(c, { rowKey: row.key, prefillRow: row })}>
                        {c.label}
                      </Button>
                    ))}
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {pageSize > 0 && pageCount > 1 && (
        <Group justify="flex-end" mt="xs">
          <Pagination total={pageCount} value={page} onChange={(p) => filters.setValue(pageKey, String(p))} size="sm" />
        </Group>
      )}
    </>
  );
}
