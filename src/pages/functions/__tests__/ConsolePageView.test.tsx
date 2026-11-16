import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ConsolePageView } from "../ConsolePageView";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, openConsolePage: vi.fn(), consolePages: vi.fn(), runConsoleAction: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.openConsolePage).mockResolvedValue({ url: "/_console/page/reports/tok/", user: { email: "ann@example.com", role: "viewer" } });
  mock(api.consolePages).mockResolvedValue({ pages: [{ name: "reports", title: "Weekly reports", icon: null, order: 0 }] });
});

function renderView() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/pages/reports"]}>
          <Routes><Route path="pages/:name" element={<ConsolePageView />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** Plays the page's side of the bridge: says hello as the frame, takes the channel, returns it. */
async function connect(frame: HTMLIFrameElement): Promise<MessagePort> {
  const win = frame.contentWindow!;
  // jsdom doesn't carry transferred ports through postMessage: take the channel where the console hands it over.
  const got = new Promise<MessagePort>((resolve) => {
    vi.spyOn(win, "postMessage").mockImplementation(((msg: any, _origin: string, transfer?: Transferable[]) => {
      if (msg?.op === "connect") resolve(transfer![0] as MessagePort);
    }) as any);
  });
  window.dispatchEvent(new MessageEvent("message", { data: { winche: 1, op: "hello" }, source: win }));
  return got;
}

const next = (port: MessagePort) => new Promise<any>((resolve) => { port.onmessage = (m) => resolve(m.data); });

test("the page is sandboxed, gets who's signed in, and runs actions through the console", async () => {
  mock(api.runConsoleAction).mockResolvedValue({ data: { count: 3 } });
  renderView();
  const frame = await screen.findByTestId("console-page-frame") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups allow-modals allow-downloads");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(await screen.findByText("Weekly reports")).toBeInTheDocument();

  const port = await connect(frame);
  const init = await next(port);
  expect(init.op).toBe("init");
  expect(init.user).toEqual({ email: "ann@example.com", role: "viewer" });
  expect(["light", "dark"]).toContain(init.theme.scheme);

  const answer = next(port);
  port.postMessage({ op: "call", id: 1, name: "summary", data: { week: 46 } });
  expect(await answer).toEqual({ id: 1, result: { count: 3 } });
  expect(mock(api.runConsoleAction)).toHaveBeenCalledWith("summary", { week: 46 });

  mock(api.runConsoleAction).mockRejectedValue(new Error(JSON.stringify({ error: { code: "permission-denied", message: "wipe needs the admin role." } })));
  const refused = next(port);
  port.postMessage({ op: "call", id: 2, name: "wipe", data: null });
  expect(await refused).toEqual({ id: 2, error: { code: "permission-denied", message: "wipe needs the admin role.", details: undefined } });
  port.close();
});

test("a second hello gets no channel, and navigating away disconnects the page", async () => {
  renderView();
  const frame = await screen.findByTestId("console-page-frame") as HTMLIFrameElement;
  const port = await connect(frame);
  await next(port);
  const handOver = vi.mocked(frame.contentWindow!.postMessage);
  handOver.mockClear();
  window.dispatchEvent(new MessageEvent("message", { data: { winche: 1, op: "hello" }, source: frame.contentWindow }));
  frame.dispatchEvent(new Event("load"));
  frame.dispatchEvent(new Event("load"));   // it navigated
  expect(await screen.findByText("The page went somewhere else")).toBeInTheDocument();
  await waitFor(() => expect(handOver).not.toHaveBeenCalled());
  port.close();
});
