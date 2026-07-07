import { Table } from "@mantine/core";
import type { TableData } from "../../api/tabs";

export function DataTable({ data }: { data: TableData }) {
  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>{data.columns.map((c, i) => <Table.Th key={i}>{c}</Table.Th>)}</Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.rows.map((row, i) => (
          <Table.Tr key={i}>{row.map((cell, j) => <Table.Td key={j}>{String(cell ?? "")}</Table.Td>)}</Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
