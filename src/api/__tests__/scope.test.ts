import { apiPath, currentProject, routerBase } from "../scope";

describe("one console: the server's pages at /console, a project's at /console/projects/<id>", () => {
  it("knows the open project from the address", () => {
    expect(currentProject("/console/projects/demo/documents")).toBe("demo");
    expect(currentProject("/console/projects/demo")).toBe("demo");
    expect(currentProject("/console/projects")).toBeNull();   // the list of projects is the server's page
    expect(currentProject("/console/server/general")).toBeNull();
    expect(routerBase("/console/projects/demo/overview")).toBe("/console/projects/demo");
    expect(routerBase("/console/server")).toBe("/console");
  });

  it("calls a project's areas under its address, and the server's at /console/v1", () => {
    const page = "/console/projects/demo/documents";
    expect(apiPath("documents/query", page)).toBe("/console/v1/projects/demo/documents/query");
    expect(apiPath("access", page)).toBe("/console/v1/projects/demo/access");
    expect(apiPath("tokens", page)).toBe("/console/v1/projects/demo/tokens");
    // Signing in, accounts, invites, the projects and settings are the server's, whichever page is open.
    for (const area of ["session/state", "accounts", "invites", "projects", "server/settings", "cli/approve"])
      expect(apiPath(area, page)).toBe(`/console/v1/${area}`);
    expect(apiPath("projects", "/console/projects")).toBe("/console/v1/projects");
  });
});
