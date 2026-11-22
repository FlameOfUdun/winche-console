/** Where secrets can be read from besides being kept here, and the project's own keys for those places. */
export interface SecretSource { name: string; title: string; hint: string; key: string | null; access?: SourceAccess }
/** What the caller may do in a source with the key that applies to them (older servers don't say). */
export interface SourceAccess { read: boolean; write: boolean; delete: boolean; missing: string[]; problem: string | null }
/** Sources a reference can be read from: those the caller may read (all, when the server doesn't say). */
export const readableSources = <T extends SecretSource>(list: T[]) => list.filter((s) => !s.access || s.access.read);
/** Sources Winche may keep a secret in for the caller. */
export const writableSources = <T extends SecretSource>(list: T[]) => list.filter((s) => !!s.access?.write);
export interface SourceKeyField { name: string; title: string; secret: boolean; required: boolean; hint: string | null }
export interface SourceKey {
  name: string; title: string; isSet: boolean; setAt: string | null; setBy: string | null; fields: SourceKeyField[]; sources: string[];
}
export interface SecretSources { available: boolean; appCredentials: boolean; sources: SecretSource[]; keys: SourceKey[] }
/** A secret a product keeps (the SMTP password, a bucket's key), as the Secrets page lists it. */
export interface KeptSecret {
  name: string; product: string; title: string; link: string | null; setAt: string; setBy: string | null; reference: string | null;
  /** Kept in AWS by Winche (written there when saved), not a reference set by hand. */
  managed?: boolean;
}
export interface SecretTest { ok: boolean; problem: string | null; code: string | null }

/**
 * A secret typed in a form: a value, or (marked with this prefix, which nobody can type) a reference such as
 * `aws-ssm:/app/key`. Kept as one string so forms hold it like a password.
 */
export const REFERENCE = "\u0000ref:";
export const isReference = (s: string | null | undefined) => !!s && s.startsWith(REFERENCE);
export const referenceOf = (s: string) => s.slice(REFERENCE.length).trim();

/** A value to keep in AWS (Winche writes it there and keeps a reference): this prefix, the store, NUL, the value. */
export const KEEP = "\u0000keep:";
export const isKeep = (s: string | null | undefined) => !!s && s.startsWith(KEEP);
export const keepValue = (store: string, value: string) => `${KEEP}${store}\u0000${value}`;
export const keepOf = (s: string) => {
  const rest = s.slice(KEEP.length);
  const at = rest.indexOf("\u0000");
  return at < 0 ? { store: rest, value: "" } : { store: rest.slice(0, at), value: rest.slice(at + 1) };
};

/**
 * What the API takes for a typed secret: { value }, { reference }, or { value, reference: "keep:<store>" }, with the spaces
 * and line breaks around it taken off (inside a PEM key or a JSON key file they stay). Empty, or only spaces: nothing.
 */
export const secretBody = (s: string | null | undefined): { value?: string; reference?: string } => {
  if (!s) return {};
  if (isReference(s)) return referenceOf(s) ? { reference: referenceOf(s) } : {};
  if (isKeep(s)) { const k = keepOf(s); const v = k.value.trim(); return k.store && v ? { value: v, reference: `keep:${k.store}` } : {}; }
  const v = s.trim();
  return v ? { value: v } : {};
};

/** Whether something was typed (a reference with nothing after its source isn't). */
export const secretTyped = (s: string | null | undefined) => Object.keys(secretBody(s)).length > 0;

/** The typed secret with the spaces around its value (or reference) taken off, kept as it was typed (a value, a reference, kept in AWS). */
export const trimSecret = (s: string) => {
  if (isReference(s)) return REFERENCE + referenceOf(s);
  if (isKeep(s)) { const k = keepOf(s); return keepValue(k.store, k.value.trim()); }
  return s.trim();
};

/** What's wrong with a typed secret before it's sent (a reference without its store, a value kept in AWS without a store), or null. */
export const secretProblem = (s: string | null | undefined): string | null => {
  if (isReference(s) && referenceOf(s!) && !/^[a-z0-9-]+:.+/.test(referenceOf(s!))) return "Not a reference";
  if (isKeep(s)) { const k = keepOf(s!); if (k.value.trim() && !k.store) return "Pick a store"; }
  return null;
};

/** secretBody for sending: throws (with secretProblem's words) when the typed secret can't be sent as it is. */
export const secretToSend = (s: string | null | undefined) => {
  const problem = secretProblem(s);
  if (problem) throw new Error(problem);
  return secretBody(s);
};
