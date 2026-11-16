import { ServerSettingsPage } from "./pages/server/ServerSettingsPage";
import { FunctionsPage } from "./pages/functions/FunctionsPage";
import { ConsolePageView } from "./pages/functions/ConsolePageView";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { useSession } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { DataBrowserPage } from "./pages/DataBrowserPage";
import { StorageBrowserPage } from "./pages/StorageBrowserPage";
import { LogsPage } from "./pages/logs/LogsPage";
import { AuthenticationPage } from "./pages/authentication/AuthenticationPage";
import { ProjectSettingsPage } from "./pages/settings/ProjectSettingsPage";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { CliLoginPage } from "./pages/CliLoginPage";
import { homePath, isDefaultConsole } from "./layout/nav";
import { ServerLayout } from "./layout/AppLayout";
import { ProjectsPage } from "./pages/server/ProjectsPage";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { ProductGate } from "./pages/onboarding/ProductGate";
import { RequireProject } from "./pages/onboarding/RequireProject";

export function App() {
  return (
    <Routes>
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="invite" element={<AcceptInvitePage />} />
      <Route path="*" element={<GatedApp />} />
    </Routes>
  );
}

function GatedApp() {
  const { state, user } = useSession();
  const home = homePath(state, user) ?? "/settings/general";
  const caps = state?.capabilities;
  const gated = (product: "database" | "storage" | "authentication" | "functions", ok: boolean | undefined, page: ReactNode) =>
    ok ? <ProductGate product={product}>{page}</ProductGate> : <Navigate to={home} replace />;
  return (
    <AuthGate>
      <RequireProject>
      <Routes>
        <Route path="cli-login" element={<CliLoginPage />} />
        <Route element={<ServerLayout />}>
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="server" element={<Navigate to="/server/authentication/sign-in" replace />} />
          {/* Addresses of before. */}
          <Route path="server/settings" element={<Navigate to="/server/authentication/sign-in" replace />} />
          <Route path="server/settings/:old" element={<Navigate to="/server/authentication/sign-in" replace />} />
          <Route path="server/:section/:tab?" element={user?.serverAdmin ? <ServerSettingsPage /> : <Navigate to="/projects" replace />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route index element={<Landing home={home} />} />
          <Route path="database/*" element={gated("database", caps?.database, <DataBrowserPage />)} />
          <Route path="storage/*" element={gated("storage", caps?.storage, <StorageBrowserPage />)} />
          <Route path="authentication" element={<Navigate to="/authentication/users" replace />} />
          <Route path="authentication/:page" element={gated("authentication", caps?.authentication, <AuthenticationPage />)} />
          <Route path="logs/*" element={caps?.logs?.app ? <LogsPage /> : <Navigate to={home} replace />} />
          <Route path="hooks" element={<Navigate to="/overview" replace />} />
          <Route path="functions" element={gated("functions", caps?.functions, <FunctionsPage />)} />
          <Route path="pages/:name" element={caps?.consolePages ? <ConsolePageView /> : <Navigate to={home} replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="settings" element={<Navigate to="/settings/general" replace />} />
          <Route path="settings/:tab" element={<ProjectSettingsPage />} />
          <Route path="apps" element={<Navigate to="/settings/general" replace />} />
          <Route path="access" element={<Navigate to="/settings/members" replace />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
      </RequireProject>
    </AuthGate>
  );
}

/** Signing in to the server's own console lands on its projects; a project's own address, on that project. */
function Landing({ home }: { home: string }) {
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  if (projects.isLoading) return null;
  return <Navigate to={projects.data?.available && isDefaultConsole() ? "/projects" : home} replace />;
}
