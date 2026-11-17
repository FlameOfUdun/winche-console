import { ServerSettingsPage } from "./pages/server/ServerSettingsPage";
import { FunctionsPage } from "./pages/functions/FunctionsPage";
import { SecretsPage } from "./pages/secrets/SecretsPage";
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
import { homePath, serverConsoleUrl } from "./layout/nav";
import { ServerLayout } from "./layout/AppLayout";
import { ProjectsPage } from "./pages/server/ProjectsPage";
import type { ReactNode } from "react";
import { ProductGate } from "./pages/onboarding/ProductGate";
import type { ProductId } from "./api/project";
import { AssetsPage } from "./pages/assets/AssetsPage";
import { RequireProject } from "./pages/onboarding/RequireProject";
import { currentProject } from "./api/scope";

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
  return currentProject() ? <ProjectConsole /> : <ServerConsole />;
}

/** The server's own console: its projects (everyone signed in), and its settings (server admins). */
function ServerConsole() {
  const { user } = useSession();
  return (
    <AuthGate>
      <Routes>
        <Route path="cli-login" element={<CliLoginPage />} />
        <Route element={<ServerLayout />}>
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="server" element={<Navigate to="/server/authentication/sign-in" replace />} />
          <Route path="server/:section/:tab?" element={user?.serverAdmin ? <ServerSettingsPage /> : <Navigate to="/projects" replace />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}

/** Leaves for the server's own console (its projects and settings live there, not in a project's). */
function ToServer({ path }: { path: string }) {
  window.location.replace(serverConsoleUrl(path));
  return null;
}

/** A project's pages (at /console/projects/<id>/…). */
function ProjectConsole() {
  const { state, user } = useSession();
  const home = homePath(state, user) ?? "/settings/general";
  const caps = state?.capabilities;
  const gated = (product: ProductId, ok: boolean | undefined, page: ReactNode) =>
    ok ? <ProductGate product={product}>{page}</ProductGate> : <Navigate to={home} replace />;
  return (
    <AuthGate>
      <RequireProject>
      <Routes>
        <Route path="cli-login" element={<CliLoginPage />} />
        {/* The server's pages are its own console's. */}
        <Route path="projects" element={<ToServer path="projects" />} />
        <Route path="server/*" element={<ToServer path="server" />} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="database/*" element={gated("database", caps?.database, <DataBrowserPage />)} />
          <Route path="storage/*" element={gated("storage", caps?.storage, <StorageBrowserPage />)} />
          <Route path="authentication" element={<Navigate to="/authentication/users" replace />} />
          <Route path="authentication/:page" element={gated("authentication", caps?.authentication, <AuthenticationPage />)} />
          <Route path="logs/*" element={caps?.logs?.app ? <LogsPage /> : <Navigate to={home} replace />} />
          <Route path="hooks" element={<Navigate to="/overview" replace />} />
          <Route path="functions" element={gated("functions", caps?.functions, <FunctionsPage />)} />
          <Route path="secrets" element={user?.role === "Admin" ? <SecretsPage /> : <Navigate to={home} replace />} />
          <Route path="assets/*" element={gated("assets", caps?.assets, <AssetsPage />)} />
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

