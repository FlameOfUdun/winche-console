import { render, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { EmbedFrame } from "../nodes/EmbedFrame";
import { SessionContext } from "../../auth/session";
import { keycloakAccessToken, onKeycloakTokenRenewed } from "../../auth/keycloak";
import type { LayoutNode } from "../../api/tabs";

vi.mock("../../auth/keycloak", () => ({
  keycloakAccessToken: vi.fn(),
  onKeycloakTokenRenewed: vi.fn(() => () => {}),
}));

const node = { type: "embed", id: "editor", route: "/plugins/notes", flex: 1, minHeight: 200, sandbox: "allow-scripts allow-same-origin allow-forms" } as Extract<
  LayoutNode,
  { type: "embed" }
>;

const session = {
  state: null,
  user: { id: "u1", email: "a@x.com", role: "Admin" },
  refresh: async () => {},
} as any;

const keycloakSession = {
  state: { provider: "keycloak" },
  user: { id: "u1", email: "a@x.com", role: "Admin" },
  refresh: async () => {},
} as any;

function setup(client = new QueryClient(), sess = session) {
  const utils = render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={sess}>
          <MemoryRouter initialEntries={["/analytics"]}>
            <Routes>
              <Route path=":tabId" element={<EmbedFrame node={node} />} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const iframe = utils.container.querySelector("iframe")!;
  return { ...utils, iframe, client };
}

// Dispatch a message as if it came FROM the given iframe at the current origin.
function messageFrom(source: Window | null, data: unknown, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
}

beforeEach(() => vi.restoreAllMocks());

test("renders a same-origin iframe with the route and sandbox", () => {
  const { iframe } = setup();
  expect(iframe.getAttribute("src")).toBe("/plugins/notes");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms");
  expect(iframe.style.height).toBe("200px");
});

test("replies to winche:ready with winche:init carrying user + theme", () => {
  const { iframe } = setup();
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  messageFrom(iframe.contentWindow, { type: "winche:ready" });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: "winche:init", theme: "light", user: { id: "u1", email: "a@x.com", role: "Admin" } }),
    window.location.origin,
  );
});

test("Keycloak mode: winche:init carries the bearer token", async () => {
  (keycloakAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue("tok-1");
  const { iframe } = setup(new QueryClient(), keycloakSession);
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  messageFrom(iframe.contentWindow, { type: "winche:ready" });
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "winche:init", token: "tok-1" }),
      window.location.origin,
    ),
  );
});

test("Keycloak mode: a token renewal pushes winche:token", () => {
  let renew: (t: string) => void = () => {};
  (onKeycloakTokenRenewed as ReturnType<typeof vi.fn>).mockImplementation((fn: (t: string) => void) => {
    renew = fn;
    return () => {};
  });
  const { iframe } = setup(new QueryClient(), keycloakSession);
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  renew("tok-2");
  expect(post).toHaveBeenCalledWith({ type: "winche:token", token: "tok-2" }, window.location.origin);
});

test("Identity mode: winche:init token is null and keycloak is never called", () => {
  const { iframe } = setup();
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  messageFrom(iframe.contentWindow, { type: "winche:ready" });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: "winche:init", token: null }),
    window.location.origin,
  );
  expect(keycloakAccessToken).not.toHaveBeenCalled();
});

test("winche:resize updates the frame height", async () => {
  const { iframe } = setup();
  messageFrom(iframe.contentWindow, { type: "winche:resize", height: 480 });
  await waitFor(() => expect(iframe.style.height).toBe("480px"));
});

test("winche:resize rejects a non-finite or runaway height", () => {
  const { iframe } = setup(); // starts at minHeight 200
  messageFrom(iframe.contentWindow, { type: "winche:resize", height: Infinity });
  messageFrom(iframe.contentWindow, { type: "winche:resize", height: 1e9 });
  expect(iframe.style.height).toBe("200px");
});

test("winche:refetch invalidates the tab data query", () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { iframe } = setup(client);
  messageFrom(iframe.contentWindow, { type: "winche:refetch" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["console-tab-data", "analytics"] });
});

test("winche:notify raises a toast", () => {
  const show = vi.spyOn(notifications, "show");
  const { iframe } = setup();
  messageFrom(iframe.contentWindow, { type: "winche:notify", level: "success", message: "done" });
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: "done", color: "green" }));
});

test("ignores a message from a foreign source", () => {
  const { iframe } = setup();
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  messageFrom(window, { type: "winche:ready" }); // source is the top window, not the iframe
  expect(post).not.toHaveBeenCalled();
});

test("ignores a message from a foreign origin", () => {
  const { iframe } = setup();
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  messageFrom(iframe.contentWindow, { type: "winche:ready" }, "https://evil.com");
  expect(post).not.toHaveBeenCalled();
});

import { RenderNode } from "../nodes/render";

test("RenderNode routes an embed node to an iframe", () => {
  const embed = { type: "embed", id: "editor", route: "/plugins/notes", flex: 1, minHeight: 180, sandbox: "allow-scripts allow-same-origin allow-forms" } as LayoutNode;
  const utils = render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={session}>
          <MemoryRouter initialEntries={["/analytics"]}>
            <Routes>
              <Route
                path=":tabId"
                element={<RenderNode node={embed} filters={{ values: {}, drafts: {}, setValue: () => {}, setDraft: () => {}, commit: () => {} }} data={{}} />}
              />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const iframe = utils.container.querySelector("iframe");
  expect(iframe?.getAttribute("src")).toBe("/plugins/notes");
});
