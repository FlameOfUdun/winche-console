import { afterEach, expect, test, vi } from "vitest";
import { authApi, api } from "../client";
import { REFERENCE, keepValue, secretBody, secretProblem, secretTyped, trimSecret } from "../secrets";
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

test("every secret sent goes without the spaces and line breaks around it; inside a PEM key they stay", async () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----";
  expect(secretBody(`  \n${pem}\n\n`)).toEqual({ value: pem });
  expect(secretBody(keepValue("aws-sm", " v \n"))).toEqual({ value: "v", reference: "keep:aws-sm" });
  expect(secretBody("   ")).toEqual({});
  expect(secretTyped(" \n ")).toBe(false);
  let body = sent();
  await api.setFunctionSecret("k", "  s3cret \n");
  expect(body()).toEqual({ value: "s3cret" });
  vi.unstubAllGlobals(); body = sent();
  await api.setServerSecret("k", `${REFERENCE} aws-ssm:/x `);
  expect(body()).toEqual({ reference: "aws-ssm:/x" });
  vi.unstubAllGlobals(); body = sent();
  await authApi("auth").saveSignInSettings({} as WincheAuthSettings, " pw ", "why", { kc: " kc-secret " });
  expect(body()).toMatchObject({ smtpPassword: "pw", syncSecrets: { kc: "kc-secret" } });
  vi.unstubAllGlobals(); body = sent();
  await api.saveAssetCdn("c", { kind: "cloudfront", baseUrl: "https://x", keyPairId: "K", linkMinutes: 5 }, `${pem}\n`, "why");
  expect(body().privateKey).toBe(pem);
});

test("a secret that can't be sent as typed is refused before the server is asked", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.setFunctionSecret("k", `${REFERENCE}not-a-reference`)).rejects.toThrow("Not a reference");
  await expect(api.setServerSecret("k", keepValue("", "v"))).rejects.toThrow("Pick a store");
  await expect(authApi("auth").saveSignInSettings({} as WincheAuthSettings, `${REFERENCE}nope`, "why")).rejects.toThrow("Not a reference");
  await expect(api.startStorageMove({ kind: "code" }, `${REFERENCE}nope`, "why")).rejects.toThrow("Not a reference");
  expect(fetchMock).not.toHaveBeenCalled();
});
