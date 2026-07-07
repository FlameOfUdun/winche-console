import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { expect, test } from "vitest";
import { StatRow } from "../widgets/StatRow";
import { DataTable } from "../widgets/DataTable";

const wrap = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);

test("StatRow renders a tile per stat (new shape)", () => {
  wrap(<StatRow data={{ stats: [{ label: "Users", value: 42, trend: "up", delta: "+1%" }, { label: "Docs", value: 7, trend: "neutral" }] }} />);
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByText("Docs")).toBeInTheDocument();
});

test("DataTable renders header row + positional cells (new shape)", () => {
  wrap(<DataTable data={{ columns: ["User", "Action"], rows: [["alice", "Created"], ["bob", "Deleted"]] }} />);
  expect(screen.getByText("User")).toBeInTheDocument();
  expect(screen.getByText("alice")).toBeInTheDocument();
  expect(screen.getByText("Deleted")).toBeInTheDocument();
});
