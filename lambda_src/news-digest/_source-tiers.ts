const TIER1 = new Set(['Reuters', 'AP News', 'AFP', 'Bloomberg', 'BBC World', 'BBC Middle East', 'BBC News']);
const TIER2 = new Set(['The Guardian', 'Guardian Trans', 'Guardian World', 'Financial Times', 'The Times', 'Washington Post Trans', 'NYT Trans Coverage']);
export function getSourceTier(source: string): number {
  if (TIER1.has(source)) return 1;
  if (TIER2.has(source)) return 2;
  return 3;
}