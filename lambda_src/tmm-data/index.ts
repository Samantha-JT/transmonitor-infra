import { createClient } from 'redis';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UWAZI_BASE = 'https://transmurdermonitoring.tgeu.org/api/search';
const PAGE_SIZE = 100;
const CACHE_KEY = 'tmm:aggregated:v2';
const CACHE_TTL = 60 * 60 * 24;

interface UwaziRow {
  metadata: {
    country_territory_of_the_murder?: Array<{ label: string; parent?: { label: string } }>;
    gender_identity_or_expression?: Array<{ label: string }>;
    age_range?: Array<{ label: string }>;
    calendar_year?: Array<{ label: string }>;
    type_of_homicide_murder?: Array<{ label: string }>;
    migrant_status?: Array<{ label: string }>;
    occupation?: Array<{ label: string }>;
    tdor_period__oct_sept_?: Array<{ label: string }>;
    location_of_the_murder_geolocation?: Array<{ value: { lat: number; lon: number } }>;
    race?: Array<{ label: string }>;
    response_from_local_authorities?: Array<{ label: string }>;
  };
}

function label(arr: Array<{ label: string }> | undefined): string {
  return arr?.[0]?.label ?? 'unknown';
}

function inc(obj: Record<string, number>, key: string) {
  obj[key] = (obj[key] ?? 0) + 1;
}

const REGION_MAP: Record<string, string> = {
  'South America, Latin America and the Caribbean': 'Latin America & Caribbean',
  'Central America, Latin America and the Caribbean': 'Latin America & Caribbean',
  'North America, North America': 'North America',
  'North America': 'North America',
  'Europe, Europe': 'Europe',
  'Europe': 'Europe',
  'Asia, Asia': 'Asia',
  'Southeast Asia, Asia': 'Asia',
  'South Asia, Asia': 'Asia',
  'Africa, Africa': 'Africa',
  'Oceania': 'Oceania',
};

async function fetchAllCases(): Promise<UwaziRow[]> {
  const first = await fetch(
    `${UWAZI_BASE}?filters=%7B%7D&from=0&includeUnpublished=false&limit=${PAGE_SIZE}&order=asc&sort=creationDate&allAggregations=false`
  ).then(r => r.json());
  const totalRows: number = first.totalRows;
  const pages = Math.ceil(totalRows / PAGE_SIZE);
  const batches: UwaziRow[][] = [];
  for (let i = 1; i < pages; i += 5) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(5, pages - i) }, (_, j) =>
        fetch(
          `${UWAZI_BASE}?filters=%7B%7D&from=${(i + j) * PAGE_SIZE}&includeUnpublished=false&limit=${PAGE_SIZE}&order=asc&sort=creationDate&allAggregations=false`
        ).then(r => r.json()).then((d: { rows: UwaziRow[] }) => d.rows)
      )
    );
    batches.push(...batch);
  }
  return [...first.rows, ...batches.flat()];
}

function aggregate(rows: UwaziRow[]) {
  const byCountry: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const byGender: Record<string, number> = {};
  const byAge: Record<string, number> = {};
  const byHomicideType: Record<string, number> = {};
  const byTdorPeriod: Record<string, number> = {};
  let migrants = 0, sexWorkers = 0, knownOccupation = 0;
  let knownMigrant = 0, under30 = 0, knownAge = 0;

  for (const row of rows) {
    const m = row.metadata;
    const country = m.country_territory_of_the_murder?.[0]?.label ?? 'Unknown';
    inc(byCountry, country);
    const regionRaw = m.country_territory_of_the_murder?.[0]?.parent?.label ?? '';
    inc(byRegion, REGION_MAP[regionRaw] ?? 'Other');
    const year = label(m.calendar_year);
    if (year !== 'unknown') inc(byYear, year);
    inc(byGender, label(m.gender_identity_or_expression));
    const age = label(m.age_range);
    inc(byAge, age);
    if (age !== 'unknown') {
      knownAge++;
      if (['0 to 17', '18 to 25', '26 to 30'].includes(age)) under30++;
    }
    inc(byHomicideType, label(m.type_of_homicide_murder));
    const tdor = label(m.tdor_period__oct_sept_);
    if (tdor !== 'unknown') inc(byTdorPeriod, tdor);
    const migrant = label(m.migrant_status);
    if (migrant !== 'unknown / not applicable' && migrant !== 'unknown') {
      knownMigrant++;
      if (migrant !== 'not a migrant') migrants++;
    }
    const occ = label(m.occupation);
    if (occ !== 'unknown / not applicable' && occ !== 'unknown') {
      knownOccupation++;
      if (occ.toLowerCase().includes('sex work')) sexWorkers++;
    }
  }

  const tdorYears = Object.keys(byTdorPeriod)
    .map(k => parseInt(k.replace('TDoR ', '')))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a);
  const latestYear = tdorYears[0] ?? new Date().getFullYear();
  const latestTdorKey = `TDoR ${latestYear}`;
  const latestRows = rows.filter(r => label(r.metadata.tdor_period__oct_sept_) === latestTdorKey);
  const latestByCountry: Record<string, number> = {};
  const latestByRegion: Record<string, number> = {};
  for (const row of latestRows) {
    const country = row.metadata.country_territory_of_the_murder?.[0]?.label ?? 'Unknown';
    inc(latestByCountry, country);
    const regionRaw = row.metadata.country_territory_of_the_murder?.[0]?.parent?.label ?? '';
    inc(latestByRegion, REGION_MAP[regionRaw] ?? 'Other');
  }
  const yearlyData = tdorYears.slice(1, 5).map(yr => {
    const yrKey = `TDoR ${yr}`;
    const yrRows = rows.filter(r => label(r.metadata.tdor_period__oct_sept_) === yrKey);
    const yrByCountry: Record<string, number> = {};
    const yrByRegion: Record<string, number> = {};
    for (const row of yrRows) {
      const country = row.metadata.country_territory_of_the_murder?.[0]?.label ?? "Unknown";
      inc(yrByCountry, country);
      const regionRaw = row.metadata.country_territory_of_the_murder?.[0]?.parent?.label ?? "";
      inc(yrByRegion, REGION_MAP[regionRaw] ?? "Other");
    }
    return {
      year: yr,
      period: `Oct ${yr - 1} – Sep ${yr}`,
      total: yrRows.length,
      byRegion: yrByRegion,
      byCountry: yrByCountry,
    };
  });
  return {
    latest: {
      year: latestYear,
      period: `Oct ${latestYear - 1} – Sep ${latestYear}`,
      total: latestRows.length,
      byRegion: latestByRegion,
      byCountry: latestByCountry,
    },
    yearlyData,
    byYear,
    byGender,
    byAge,
    byHomicideType,
    allTimeTotalSince2008: rows.length,
    historicalTotals: Object.entries(byYear)
      .map(([year, total]) => ({ year: parseInt(year), total }))
      .sort((a, b) => a.year - b.year),
    percentSexWorkers: knownOccupation > 0 ? Math.round((sexWorkers / knownOccupation) * 100) : 0,
    percentMigrants: knownMigrant > 0 ? Math.round((migrants / knownMigrant) * 100) : 0,
    percentUnder30: knownAge > 0 ? Math.round((under30 / knownAge) * 100) : 0,
    recentVictims: [],
    generatedAt: new Date().toISOString(),
    source: `TGEU Trans Murder Monitoring · live data · Oct ${latestYear - 1} – Sep ${latestYear}`,
  };
}

export const handler = async (event: { requestContext?: { http?: { method?: string } } }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const redisUrl = process.env.REDIS_URL;
  let redis: ReturnType<typeof createClient> | null = null;
  try {
    if (redisUrl) {
      redis = createClient({ url: redisUrl });
      await redis.connect();
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        await redis.disconnect();
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
          body: cached,
        };
      }
    }
    const rows = await fetchAllCases();
    const data = aggregate(rows);
    const body = JSON.stringify(data);
    if (redis) {
      await redis.set(CACHE_KEY, body, { EX: CACHE_TTL });
      await redis.disconnect();
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body,
    };
  } catch (err) {
    if (redis) try { await redis.disconnect(); } catch {}
    console.error('TMM fetch error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch TMM data' }),
    };
  }
};
