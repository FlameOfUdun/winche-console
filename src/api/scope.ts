/**
 * Where the console is and which project's pages are open: one console at /console (the server's pages), a project's at
 * /console/projects/<id>/…. Its API is /console/v1/…: the server's areas there, a project's under
 * /console/v1/projects/<id>/….
 */
export const CONSOLE = "/console";

/** The areas that are the server's whichever page is open: signing in, the CLI's sign-in, accounts, invites, projects, settings. */
const SERVER_AREAS = new Set(["session", "cli", "accounts", "invites", "server", "projects"]);

/** The project whose pages are open, from the address (null: the server's pages). */
export function currentProject(pathname = window.location.pathname): string | null {
  const m = /^\/console\/projects\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The router's base: a project's pages, or the console's. */
export function routerBase(pathname = window.location.pathname): string {
  const project = currentProject(pathname);
  return project ? `${CONSOLE}/projects/${encodeURIComponent(project)}` : CONSOLE;
}

/** A project's console API, from the host's root: /console/v1/projects/<id>. */
export const projectApi = (id: string) => `${CONSOLE}/v1/projects/${encodeURIComponent(id)}`;

/**
 * An API call's address, from its area and path (e.g. "documents/query", "session/state"): the server's areas at
 * /console/v1/…, the rest at the open project's /console/v1/projects/<id>/… (at /console/v1/… on the server's pages).
 */
export function apiPath(rel: string, pathname = window.location.pathname): string {
  const area = rel.split(/[/?]/, 1)[0];
  const project = currentProject(pathname);
  return project && !SERVER_AREAS.has(area) ? `${projectApi(project)}/${rel}` : `${CONSOLE}/v1/${rel}`;
}
