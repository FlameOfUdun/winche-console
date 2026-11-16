import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { projectNav, type NavItem } from "./nav";

/** The project's sidebar for this user, with what the server says about rules and auth; `ready` once it knows. */
export function useProjectNav(): { items: NavItem[]; ready: boolean } {
  const { state, user } = useSession();
  const admin = user?.role === "Admin";
  const rules = useQuery({ queryKey: ["rules-subsystems"], queryFn: api.rulesSubsystems, enabled: admin, staleTime: 60_000 });
  const auth = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig, enabled: !!state?.capabilities?.authentication, staleTime: 60_000 });
  const pages = useQuery({ queryKey: ["console-pages"], queryFn: api.consolePages, enabled: !!state?.capabilities?.consolePages, staleTime: 30_000, retry: false });
  const items = projectNav(state, user, {
    rules: rules.data?.map((s) => s.id),
    wincheAuth: auth.data ? auth.data.wincheAuth !== false : undefined,
    authUsers: auth.data ? !!auth.data.directory : undefined,
    trustedIssuers: auth.data ? auth.data.trustedProviders !== false : undefined,
    consolePages: pages.data?.pages,
  });
  return { items, ready: (!admin || !rules.isLoading) && !auth.isLoading };
}
