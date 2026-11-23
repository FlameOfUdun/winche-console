import { describe, expect, it } from "vitest";
import { fillTemplate } from "../appAuth";

describe("fillTemplate", () => {
  it("shows the provider only in the sign-in-method-added message", () => {
    expect(fillTemplate("A %PROVIDER% account was added", "Clinic", "providerLinked")).toBe("A Google account was added");
    expect(fillTemplate("[%PROVIDER%]", "Clinic", "verifyEmail")).toBe("[]");
  });
});
