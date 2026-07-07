import { describe, it, expect } from "vitest";
import type { CommandSpec, TableData } from "../tabs";

describe("tab wire types", () => {
  it("accepts a command spec with fields", () => {
    const c: CommandSpec = {
      id: "createuser", label: "Create user", minRole: "admin", confirm: null, rowScoped: false,
      form: [{ key: "email", kind: "text", label: "Email", required: true }],
    };
    expect(c.form[0].key).toBe("email");
  });
  it("table data has total and keyed rows", () => {
    const t: TableData = { columns: ["N"], total: 1, rows: [{ key: "k", cells: ["Alice"] }] };
    expect(t.rows[0].key).toBe("k");
  });
});
