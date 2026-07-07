import { describe, it, expect } from "vitest";
import { canRunFor } from "../runtime";
import type { CommandSpec } from "../../api/tabs";

const cmd = (minRole: "viewer" | "member" | "admin"): CommandSpec =>
  ({ id: "x", label: "X", minRole, confirm: null, rowScoped: false, form: [] });

describe("canRunFor", () => {
  it("admin can run an admin command", () => expect(canRunFor("admin", cmd("admin"))).toBe(true));
  it("member cannot run an admin command", () => expect(canRunFor("member", cmd("admin"))).toBe(false));
  it("member can run a viewer command", () => expect(canRunFor("member", cmd("viewer"))).toBe(true));
  it("viewer cannot run a member command", () => expect(canRunFor("viewer", cmd("member"))).toBe(false));
});
