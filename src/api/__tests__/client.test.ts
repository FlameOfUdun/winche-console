import { afterEach, expect, test, vi } from "vitest";
import { authApi, api } from "../client";
import { REFERENCE, keepValue, secretProblem, secretTyped, trimSecret } from "../secrets";
import type { WincheAuthSettings } from "../appAuth";

const sent = () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
};
afterEach(() => vi.unstubAllGlobals());

test("a sync's client secret kept in AWS goes as its value plus keep:<store>; a reference as a reference; a value as a value", async () => {
  const body = sent();
  await authApi("auth").saveSignInSettings({} as WincheAuthSettings, null, "why", {
    kc: keepValue("aws-sm", "s3cret"), other: `${REFERENCE}aws-ssm:/app/kc`, plain: "plain-value",
  });
  const b = body();
  expect(b.syncSecrets).toEqual({ kc: "s3cret", plain: "plain-value" });
  expect(b.syncSecretReferences).toEqual({ kc: "keep:aws-sm", other: "aws-ssm:/app/kc" });
});

test("a Turnstile secret is sent as { value, reference }", async () => {
  const body = sent();
  await api.setTurnstileSecret("my-app", "0x4secret", "keep:aws-ssm");
  expect(body()).toEqual({ value: "0x4secret", reference: "keep:aws-ssm" });
});

test("a bare mode marker isn't a typed secret; trimming keeps the mode; problems are caught before sending", () => {
  expect(secretTyped(REFERENCE)).toBe(false);
  expect(secretTyped(keepValue("aws-sm", ""))).toBe(false);
  expect(trimSecret(keepValue("aws-sm", "  v  "))).toBe(keepValue("aws-sm", "v"));
  expect(trimSecret(`${REFERENCE} aws-ssm:/x `)).toBe(`${REFERENCE}aws-ssm:/x`);
  expect(secretProblem(`${REFERENCE}not-a-reference`)).toBe("Not a reference");
  expect(secretProblem(keepValue("", "v"))).toBe("Pick a store");
  expect(secretProblem(`${REFERENCE}aws-ssm:/x`)).toBeNull();
  expect(secretProblem("plain")).toBeNull();
});
