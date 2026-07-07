import { Alert, useMantineColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useSession } from "../../auth/session";
import { keycloakAccessToken, onKeycloakTokenRenewed } from "../../auth/keycloak";
import type { LayoutNode } from "../../api/tabs";

type EmbedNode = Extract<LayoutNode, { type: "embed" }>;

const LOAD_TIMEOUT_MS = 15000;

// Mounts a consumer-authored island in a same-origin iframe and bridges the closed postMessage protocol.
// Inbound to the island: winche:init { user, theme, token } and winche:token { token } (Keycloak-mode bearer
// token + silent-renewal push; null in Identity mode, which uses the cookie). Outbound from the island (the only
// three we honour): winche:resize { height }, winche:refetch (reload siblings), winche:notify { level, message }.
export function EmbedFrame({ node }: { node: EmbedNode }) {
  const { tabId } = useParams();
  const { user, state } = useSession();
  const provider = state?.provider;
  const { colorScheme } = useMantineColorScheme();
  const queryClient = useQueryClient();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(node.minHeight);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // The console has no dark toggle yet, so "auto" collapses to "light"; kept explicit for a future toggle.
  const theme = colorScheme === "dark" ? "dark" : "light";

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return; // only our own iframe
      if (event.origin !== window.location.origin) return;        // only same origin
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "winche:ready": {
          // Keycloak mode: hand over the current (auto-renewing) access token so the island's same-audience API
          // calls carry it. Identity mode sends null — the same-origin cookie already authenticates.
          const token = provider === "keycloak" ? await keycloakAccessToken() : null;
          frame.contentWindow?.postMessage(
            {
              type: "winche:init",
              user: user ? { id: user.id, email: user.email, role: user.role } : null,
              theme,
              token,
            },
            window.location.origin,
          );
          break;
        }
        case "winche:resize":
          // Clamp to a sane range: rejects NaN/Infinity and a runaway height that would blow out the layout.
          if (Number.isFinite(msg.height) && msg.height > 0 && msg.height <= 4000) setHeight(msg.height);
          break;
        case "winche:refetch":
          void queryClient.invalidateQueries({ queryKey: ["console-tab-data", tabId] });
          break;
        case "winche:notify":
          notifications.show({
            color: msg.level === "error" ? "red" : msg.level === "success" ? "green" : "blue",
            message: typeof msg.message === "string" ? msg.message : "",
          });
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [user, theme, tabId, queryClient, provider]);

  // Keycloak mode: push a fresh token to the island whenever oidc-client-ts silently renews.
  useEffect(() => {
    if (provider !== "keycloak") return;
    return onKeycloakTokenRenewed((token) => {
      frameRef.current?.contentWindow?.postMessage({ type: "winche:token", token }, window.location.origin);
    });
  }, [provider]);

  useEffect(() => {
    if (loaded) return;
    const t = window.setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [loaded]);

  if (failed) return <Alert color="red" variant="light">This panel couldn't be loaded.</Alert>;

  return (
    <iframe
      ref={frameRef}
      src={node.route}
      title={node.id}
      onLoad={() => setLoaded(true)}
      sandbox="allow-scripts allow-same-origin allow-forms"
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
