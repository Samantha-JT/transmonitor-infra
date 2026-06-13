"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tmm-data/index.ts
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var UWAZI_BASE = "https://transmurdermonitoring.tgeu.org/api/search";
var PAGE_SIZE = 100;
var CACHE_KEY = "tmm:aggregated:v2";
var CACHE_TTL = 60 * 60 * 24;
function label(arr) {
  return arr?.[0]?.label ?? "unknown";
}
function inc(obj, key) {
  obj[key] = (obj[key] ?? 0) + 1;
}
var REGION_MAP = {
  "South America, Latin America and the Caribbean": "Latin America & Caribbean",
  "Central America, Latin America and the Caribbean": "Latin America & Caribbean",
  "North America, North America": "North America",
  "North America": "North America",
  "Europe, Europe": "Europe",
  "Europe": "Europe",
  "Asia, Asia": "Asia",
  "Southeast Asia, Asia": "Asia",
  "South Asia, Asia": "Asia",
  "Africa, Africa": "Africa",
  "Oceania": "Oceania"
};
async function fetchAllCases() {
  const first = await fetch(
    `${UWAZI_BASE}?filters=%7B%7D&from=0&includeUnpublished=false&limit=${PAGE_SIZE}&order=asc&sort=creationDate&allAggregations=false`
  ).then((r) => r.json());
  const totalRows = first.totalRows;
  const pages = Math.ceil(totalRows / PAGE_SIZE);
  const batches = [];
  for (let i = 1; i < pages; i += 5) {
    const batch = await Promise.all(
      Array.from(
        { length: Math.min(5, pages - i) },
        (_, j) => fetch(
          `${UWAZI_BASE}?filters=%7B%7D&from=${(i + j) * PAGE_SIZE}&includeUnpublished=false&limit=${PAGE_SIZE}&order=asc&sort=creationDate&allAggregations=false`
        ).then((r) => r.json()).then((d) => d.rows)
      )
    );
    batches.push(...batch);
  }
  return [...first.rows, ...batches.flat()];
}
function aggregate(rows) {
  const byCountry = {};
  const byRegion = {};
  const byYear = {};
  const byGender = {};
  const byAge = {};
  const byHomicideType = {};
  const byTdorPeriod = {};
  let migrants = 0, sexWorkers = 0, knownOccupation = 0;
  let knownMigrant = 0, under30 = 0, knownAge = 0;
  for (const row of rows) {
    const m = row.metadata;
    const country = m.country_territory_of_the_murder?.[0]?.label ?? "Unknown";
    inc(byCountry, country);
    const regionRaw = m.country_territory_of_the_murder?.[0]?.parent?.label ?? "";
    inc(byRegion, REGION_MAP[regionRaw] ?? "Other");
    const year = label(m.calendar_year);
    if (year !== "unknown") inc(byYear, year);
    inc(byGender, label(m.gender_identity_or_expression));
    const age = label(m.age_range);
    inc(byAge, age);
    if (age !== "unknown") {
      knownAge++;
      if (["0 to 17", "18 to 25", "26 to 30"].includes(age)) under30++;
    }
    inc(byHomicideType, label(m.type_of_homicide_murder));
    const tdor = label(m.tdor_period__oct_sept_);
    if (tdor !== "unknown") inc(byTdorPeriod, tdor);
    const migrant = label(m.migrant_status);
    if (migrant !== "unknown / not applicable" && migrant !== "unknown") {
      knownMigrant++;
      if (migrant !== "not a migrant") migrants++;
    }
    const occ = label(m.occupation);
    if (occ !== "unknown / not applicable" && occ !== "unknown") {
      knownOccupation++;
      if (occ.toLowerCase().includes("sex work")) sexWorkers++;
    }
  }
  const tdorYears = Object.keys(byTdorPeriod).map((k) => parseInt(k.replace("TDoR ", ""))).filter((n) => !isNaN(n)).sort((a, b) => b - a);
  const latestYear = tdorYears[0] ?? (/* @__PURE__ */ new Date()).getFullYear();
  const latestTdorKey = `TDoR ${latestYear}`;
  const latestRows = rows.filter((r) => label(r.metadata.tdor_period__oct_sept_) === latestTdorKey);
  const latestByCountry = {};
  const latestByRegion = {};
  for (const row of latestRows) {
    const country = row.metadata.country_territory_of_the_murder?.[0]?.label ?? "Unknown";
    inc(latestByCountry, country);
    const regionRaw = row.metadata.country_territory_of_the_murder?.[0]?.parent?.label ?? "";
    inc(latestByRegion, REGION_MAP[regionRaw] ?? "Other");
  }
  const yearlyData = tdorYears.slice(1, 5).map((yr) => {
    const yrKey = `TDoR ${yr}`;
    const yrRows = rows.filter((r) => label(r.metadata.tdor_period__oct_sept_) === yrKey);
    const yrByCountry = {};
    const yrByRegion = {};
    for (const row of yrRows) {
      const country = row.metadata.country_territory_of_the_murder?.[0]?.label ?? "Unknown";
      inc(yrByCountry, country);
      const regionRaw = row.metadata.country_territory_of_the_murder?.[0]?.parent?.label ?? "";
      inc(yrByRegion, REGION_MAP[regionRaw] ?? "Other");
    }
    return {
      year: yr,
      period: `Oct ${yr - 1} \u2013 Sep ${yr}`,
      total: yrRows.length,
      byRegion: yrByRegion,
      byCountry: yrByCountry
    };
  });
  return {
    latest: {
      year: latestYear,
      period: `Oct ${latestYear - 1} \u2013 Sep ${latestYear}`,
      total: latestRows.length,
      byRegion: latestByRegion,
      byCountry: latestByCountry
    },
    yearlyData,
    byYear,
    byGender,
    byAge,
    byHomicideType,
    allTimeTotalSince2008: rows.length,
    historicalTotals: Object.entries(byYear).map(([year, total]) => ({ year: parseInt(year), total })).sort((a, b) => a.year - b.year),
    percentSexWorkers: knownOccupation > 0 ? Math.round(sexWorkers / knownOccupation * 100) : 0,
    percentMigrants: knownMigrant > 0 ? Math.round(migrants / knownMigrant * 100) : 0,
    percentUnder30: knownAge > 0 ? Math.round(under30 / knownAge * 100) : 0,
    recentVictims: [],
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: `TGEU Trans Murder Monitoring \xB7 live data \xB7 Oct ${latestYear - 1} \u2013 Sep ${latestYear}`
  };
}
var handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const redisUrl = process.env.REDIS_URL;
  let redis = null;
  try {
    if (redisUrl) {
      redis = (0, import_redis.createClient)({ url: redisUrl });
      await redis.connect();
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        await redis.disconnect();
        return {
          statusCode: 200,
          headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
          body: cached
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
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      body
    };
  } catch (err) {
    if (redis) try {
      await redis.disconnect();
    } catch {
    }
    console.error("TMM fetch error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to fetch TMM data" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
