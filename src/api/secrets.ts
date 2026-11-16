/** Where secrets can be read from besides being kept here, and the project's own keys for those places. */
export interface SecretSource { name: string; title: string; hint: string; key: string | null }
export interface SourceKeyField { name: string; title: string; secret: boolean; required: boolean; hint: string | null }
export interface SourceKey {
  name: string; title: string; isSet: boolean; setAt: string | null; setBy: string | null; fields: SourceKeyField[]; sources: string[];
}
export interface SecretSources { available: boolean; appCredentials: boolean; sources: SecretSource[]; keys: SourceKey[] }
export interface SecretTest { ok: boolean; problem: string | null; code: string | null }

/**
 * A secret typed in a form: a value, or (marked with this prefix, which nobody can type) a reference such as
 * `aws-ssm:/app/key`. Kept as one string so forms hold it like a password.
 */
export const REFERENCE = "\u0000ref:";
export const isReference = (s: string | null | undefined) => !!s && s.startsWith(REFERENCE);
export const referenceOf = (s: string) => s.slice(REFERENCE.length).trim();

/** What the API takes for a typed secret: { value } or { reference }. Empty: nothing. */
export const secretBody = (s: string | null | undefined): { value?: string; reference?: string } =>
  !s ? {} : isReference(s) ? (referenceOf(s) ? { reference: referenceOf(s) } : {}) : { value: s };

/** Whether something was typed (a reference with nothing after its source isn't). */
export const secretTyped = (s: string | null | undefined) => Object.keys(secretBody(s)).length > 0;
