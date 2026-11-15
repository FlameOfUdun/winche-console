import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, serverAuthApi, type AuthApi } from "../../api/client";

/**
 * Which Winche Auth the Authentication pages show: a project's (its app users) or the server's console accounts
 * (Server settings → Authentication). The same pages; the console's leave out what doesn't apply to it (email links,
 * guests, webhooks) and keep its identity providers with Server settings.
 */
export interface AuthScope { api: AuthApi; console: boolean }

const Scope = createContext<AuthScope>({ api, console: false });

export const useAuthScope = () => useContext(Scope);
export const useAuthApi = () => useContext(Scope).api;

/** The console accounts' pages: their own calls, and their own cache (so nothing mixes with a project's). */
export function ConsoleAccountsScope({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <Scope.Provider value={{ api: serverAuthApi, console: true }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Scope.Provider>
  );
}
