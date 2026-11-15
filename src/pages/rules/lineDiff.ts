/** One line of a line-by-line diff from `before` to `after`. Line numbers are 1-based; null where absent. */
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
  before: number | null;
  after: number | null;
}

/**
 * Line diff by longest common subsequence — plenty for rules files (hundreds of lines). Removed lines come
 * before the added lines that replace them, like a unified diff.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], before: i + 1, after: j + 1 });
      i++; j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ kind: "removed", text: a[i], before: i + 1, after: null });
      i++;
    } else {
      out.push({ kind: "added", text: b[j], before: null, after: j + 1 });
      j++;
    }
  }
  return out;
}

/** How many lines were added and removed. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
}
