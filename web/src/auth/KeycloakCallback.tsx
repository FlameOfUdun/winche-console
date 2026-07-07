import { Center, Loader } from "@mantine/core";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, setBearerTokenProvider } from "../api/client";
import { initKeycloak, keycloakAccessToken, keycloakCallback } from "./keycloak";
import { useSession } from "./session";

/** Handles the OIDC redirect: completes the code exchange, refreshes session, returns to the app root. */
export function KeycloakCallback() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  useEffect(() => {
    (async () => {
      // The OIDC client must be initialized before we can process the redirect. On this fresh page load
      // SessionProvider initializes it too, but asynchronously — so do it here first to avoid the race.
      try {
        const cfg = await api.authConfig();
        if (cfg.provider === "keycloak") {
          initKeycloak(cfg);
          setBearerTokenProvider(keycloakAccessToken);
          await keycloakCallback();
        }
      } catch { /* fall through to the gate (shows sign-in again) */ }
      await refresh();
      navigate("/database", { replace: true });
    })();
  }, [navigate, refresh]);
  return <Center h="100vh"><Loader /></Center>;
}
