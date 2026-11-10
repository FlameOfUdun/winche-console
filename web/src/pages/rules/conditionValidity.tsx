import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

/**
 * Which condition editors currently hold text that isn't a valid condition yet (a syntax error, or not
 * checked yet). Their last valid expression is still in the draft, so saving then would silently save
 * something other than what's on screen — the editor blocks Save while any are listed.
 */
interface ConditionValidity {
  invalid: number;
  set: (id: string, invalid: boolean) => void;
}

const Context = createContext<ConditionValidity | null>(null);

export function ConditionValidityProvider({ children, onChange }: { children: ReactNode; onChange?: (invalid: number) => void }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const set = useCallback((id: string, invalid: boolean) => {
    setIds((prev) => {
      if (prev.has(id) === invalid) return prev;
      const next = new Set(prev);
      if (invalid) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => onChange?.(ids.size), [ids, onChange]);
  const value = useMemo(() => ({ invalid: ids.size, set }), [ids, set]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** How many conditions are invalid right now (0 outside a provider). */
export function useInvalidConditionCount(): number {
  return useContext(Context)?.invalid ?? 0;
}

/** Reports this editor's validity; clears it on unmount (a removed rule no longer blocks Save). */
export function useReportConditionValidity(invalid: boolean) {
  const ctx = useContext(Context);
  const id = useId();
  const set = ctx?.set;
  useEffect(() => {
    set?.(id, invalid);
  }, [set, id, invalid]);
  useEffect(() => () => set?.(id, false), [set, id]);
}
