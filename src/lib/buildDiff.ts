/** How many items differ between two core-item builds — symmetric set
 * difference (items only in A, plus items only in B). Order doesn't matter
 * (the same core items bought in a different sequence isn't "a different
 * build"), and a repeated item id only counts once either way. Used both
 * server-side (getChampionBuildVariants, src/lib/sources/deeplol.ts — to
 * pick build_lst entries that are actually distinct item sets, not just
 * re-orderings/near-duplicates of the same one) and client-side (to label
 * how many items a shown build variant differs by from the top build). */
export function itemSetDiffCount(a: number[], b: number[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let diff = 0;
  for (const id of setA) if (!setB.has(id)) diff++;
  for (const id of setB) if (!setA.has(id)) diff++;
  return diff;
}
