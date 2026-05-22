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
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
var TMM_DATA = {
  latest: {
    year: 2024,
    period: "October 2023 \u2013 September 2024",
    postUrl: "https://transrespect.org/en/tmm-update-tdor-2024/",
    total: 350,
    byRegion: {
      "Latin America & Caribbean": 272,
      "North America": 28,
      "Europe": 19,
      "Asia": 20,
      "Africa": 9,
      "Oceania": 2,
      "Other": 0
    },
    byCountry: {
      "Brazil": 110,
      "Mexico": 56,
      "Colombia": 25,
      "United States": 28,
      "Honduras": 16,
      "Guatemala": 14,
      "Ecuador": 12,
      "Argentina": 10,
      "Venezuela": 9,
      "Peru": 8,
      "Turkey": 5,
      "Philippines": 7,
      "India": 6,
      "United Kingdom": 3,
      "Germany": 2,
      "France": 2,
      "Italy": 3,
      "Spain": 2,
      "Nigeria": 4,
      "South Africa": 3
    }
  },
  yearlyData: [
    { year: 2023, period: "Oct 2022 \u2013 Sep 2023", postUrl: "https://transrespect.org/en/tmm-update-tdor-2023/", total: 321, byRegion: { "Latin America & Caribbean": 243, "North America": 34, "Europe": 18, "Asia": 17, "Africa": 7, "Oceania": 2 }, byCountry: { "Brazil": 103, "Mexico": 52, "Colombia": 22, "United States": 34 } },
    { year: 2022, period: "Oct 2021 \u2013 Sep 2022", postUrl: "https://transrespect.org/en/tmm-update-tdor-2022/", total: 327, byRegion: { "Latin America & Caribbean": 252, "North America": 33, "Europe": 19, "Asia": 15, "Africa": 6, "Oceania": 2 }, byCountry: { "Brazil": 131, "Mexico": 51, "Colombia": 21, "United States": 33 } },
    { year: 2021, period: "Oct 2020 \u2013 Sep 2021", postUrl: "https://transrespect.org/en/tmm-update-tdor-2021/", total: 375, byRegion: { "Latin America & Caribbean": 295, "North America": 50, "Europe": 17, "Asia": 8, "Africa": 4, "Oceania": 1 }, byCountry: { "Brazil": 140, "Mexico": 66, "Colombia": 24, "United States": 50 } },
    { year: 2020, period: "Oct 2019 \u2013 Sep 2020", postUrl: "https://transrespect.org/en/tmm-update-tdor-2020/", total: 350, byRegion: { "Latin America & Caribbean": 274, "North America": 32, "Europe": 22, "Asia": 14, "Africa": 7, "Oceania": 1 }, byCountry: { "Brazil": 152, "Mexico": 57, "Colombia": 18, "United States": 32 } }
  ],
  historicalTotals: [
    { year: 2008, total: 79 },
    { year: 2009, total: 144 },
    { year: 2010, total: 179 },
    { year: 2011, total: 226 },
    { year: 2012, total: 265 },
    { year: 2013, total: 238 },
    { year: 2014, total: 226 },
    { year: 2015, total: 271 },
    { year: 2016, total: 295 },
    { year: 2017, total: 325 },
    { year: 2018, total: 369 },
    { year: 2019, total: 331 },
    { year: 2020, total: 350 },
    { year: 2021, total: 375 },
    { year: 2022, total: 327 },
    { year: 2023, total: 321 },
    { year: 2024, total: 350 }
  ],
  allTimeTotalSince2008: 4350,
  sourceUrl: "https://transrespect.org/en/map/trans-murder-monitoring/",
  uwazuMapUrl: "https://transrespect.org/en/map/trans-murder-monitoring/",
  generatedAt: "2025-01-01T00:00:00.000Z"
};
var handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
    body: JSON.stringify(TMM_DATA)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
