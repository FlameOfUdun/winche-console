import { useAuthApi } from "./authScope";
import { ProductHooks } from "../hooks/ProductHooks";
import { Anchor } from "@mantine/core";
import { Link, Navigate, useParams } from "react-router-dom";
import { useSession } from "../../auth/session";
import { UsersView } from "./UsersView";
import { TrustedIssuersView } from "./SettingsPanel";
import { AuthSettingsCards, SignInMethodView } from "./SignInSettings";
import { useQuery } from "@tanstack/react-query";
import { EmailTemplatesView } from "./EmailTemplatesView";
import { NavPageHeader } from "../../components/NavPageHeader";
import { useProjectNav } from "../../layout/useProjectNav";

/** Authentication: the app's users (Winche Auth), how they sign in, its emails, hooks and settings — one page each. */
export function AuthenticationPage() {
  const authApi = useAuthApi();
  const { state } = useSession();
  const { page } = useParams();
  const { items, ready } = useProjectNav();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const wincheAuth = config.data?.wincheAuth !== false;
  const pages = items.find((n) => n.to === "/authentication")?.pages ?? [];
  const allowed = pages.some((p) => p.to === `/authentication/${page}`);
  if (page === "hooks") return <Navigate to="/authentication/webhooks" replace />;   // its address of before
  if (!ready) return null;
  if (!allowed) return <Navigate to={pages[0]?.to ?? "/overview"} replace />;
  return (
    <>
      <NavPageHeader
        actions={page === "users" && state?.capabilities?.logs?.app && (
          <Anchor component={Link} to="/logs?resource=auth" size="sm" fw={600}>Sign-ins and failures in Logs →</Anchor>
        )} />
      <div style={{ paddingBottom: 28 }}>
        {page === "users" && <UsersView />}
        {page === "methods" && <SignInMethodView />}
        {page === "issuers" && <TrustedIssuersView />}
        {page === "emails" && <EmailTemplatesView />}
        {page === "webhooks" && <ProductHooks source="auth" />}
        {page === "settings" && <AuthSettingsCards wincheAuth={wincheAuth} />}
      </div>
    </>
  );
}
