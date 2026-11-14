import { render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test } from "vitest";
import { OverviewPage } from "../OverviewPage";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, overview: vi.fn() } };
});

test("shows each product with its status and numbers, and recent changes", async () => {
  (api.overview as ReturnType<typeof vi.fn>).mockResolvedValue({
    project: { id: "clinic-records", name: "Clinic records" },
    products: [
      { id: "database", name: "Database", path: "/database", on: true, about: "Documents", stats: [{ label: "collections", value: "14" }, { label: "rules", value: "v6" }] },
      { id: "functions", name: "Functions", path: "/functions", on: false, about: "Your TypeScript", stats: [] },
    ],
    changes: [{ at: "2026-11-14T10:42:00Z", what: "Database rules v6: Nurses read their ward", by: "gitlab-main (CI token by ann@clinic.example)" }],
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><OverviewPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Clinic records" })).toBeInTheDocument();
  const [db, fn] = screen.getAllByTestId("product");
  expect(within(db).getByText("On")).toBeInTheDocument();
  expect(within(db).getByText("v6")).toBeInTheDocument();
  expect(within(fn).getByText("Not set up")).toBeInTheDocument();
  expect(within(screen.getByTestId("change")).getByText("Database rules v6: Nurses read their ward")).toBeInTheDocument();
});
