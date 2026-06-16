/**
 * Shared media-bias source registry and domain resolution.
 *
 * SINGLE SOURCE OF TRUTH for media-bias source metadata. This module replaces
 * five previously-overlapping hand-maintained maps that had drifted apart:
 *   - news-digest:  BIAS_SOURCE_REGISTRY (Set), BIAS_EDITORIAL, SOURCE_NAMES,
 *                   BIAS_SOURCE_NAME_MAP, BIAS_TITLE_PUBLISHER_MAP
 *   - media-bias:   SOURCE_REGISTRY (name/domain/editorialBias)
 *
 * The lookup tables below (REGISTRY_DOMAINS, EDITORIAL_BY_DOMAIN, NAME_BY_DOMAIN,
 * ALIAS_TO_DOMAIN) are DERIVED from SOURCE_REGISTRY at module load — adding an
 * outlet now means editing exactly one entry.
 *
 * PR1 (behavior-preserving extraction): logic is copied verbatim from the
 * original news-digest implementation. The only deliberate reconciliation is
 * goodlawproject.org, whose editorial stance disagreed between the two old
 * maps (digest 'supportive' vs registry/panel 'positive'); the panel value
 * 'positive' was kept. See git history / PR description.
 */

export type EditorialBias = 'hostile' | 'negative' | 'neutral' | 'positive' | 'supportive';

export interface SourceEntry {
  name: string;
  domain: string;
  editorialBias: EditorialBias;
  /** Display/title-suffix aliases used to resolve Google News items to this domain. */
  aliases: string[];
}

export const SOURCE_REGISTRY: Record<string, SourceEntry> = {
  "advocate.com": { name: "The Advocate", domain: "advocate.com", editorialBias: "positive", aliases: ["Advocate.com", "Puberty Blocker Rulings"] },
  "andrewsullivan.substack.com": { name: "Andrew Sullivan", domain: "andrewsullivan.substack.com", editorialBias: "hostile", aliases: ["The Weekly Dish | Andrew Sullivan"] },
  "apnews.com": { name: "Apnews", domain: "apnews.com", editorialBias: "neutral", aliases: [] },
  "assignedmedia.org": { name: "Assigned Media", domain: "assignedmedia.org", editorialBias: "supportive", aliases: ["Assigned Media Backfill", "Assigned Media Search"] },
  "attitude.co.uk": { name: "Attitude", domain: "attitude.co.uk", editorialBias: "supportive", aliases: ["Attitude Backfill", "Attitude Search"] },
  "bbc.co.uk": { name: "BBC News", domain: "bbc.co.uk", editorialBias: "negative", aliases: ["BBC", "BBC Trans Coverage"] },
  "catholicworldreport.com": { name: "Catholic World Report", domain: "catholicworldreport.com", editorialBias: "neutral", aliases: ["Catholic World Report"] },
  "cbn.com": { name: "CBN", domain: "cbn.com", editorialBias: "neutral", aliases: ["CBN", "cbn.com"] },
  "channel4.com": { name: "Channel 4 News", domain: "channel4.com", editorialBias: "positive", aliases: ["Channel 4", "Channel 4 News Backfill", "Channel 4 News Search"] },
  "dailymail.co.uk": { name: "The Daily Mail", domain: "dailymail.co.uk", editorialBias: "hostile", aliases: ["Daily Mail", "Daily Mail Backfill", "Daily Mail Search", "Mail Trans"] },
  "divamag.co.uk": { name: "DIVA Magazine", domain: "divamag.co.uk", editorialBias: "supportive", aliases: ["DIVA Magazine Backfill", "DIVA Magazine Search"] },
  "donoharmmedicine.org": { name: "Do No Harm", domain: "donoharmmedicine.org", editorialBias: "neutral", aliases: ["donoharmmedicine.org"] },
  "express.co.uk": { name: "Daily Express", domain: "express.co.uk", editorialBias: "negative", aliases: ["Daily Express Backfill", "Daily Express Search", "Express"] },
  "gbnews.com": { name: "GB News", domain: "gbnews.com", editorialBias: "hostile", aliases: [] },
  "glaad.org": { name: "GLAAD", domain: "glaad.org", editorialBias: "supportive", aliases: ["GLAAD Backfill", "GLAAD Search"] },
  "glad.org": { name: "GLAD Law", domain: "glad.org", editorialBias: "supportive", aliases: ["GLAD Law"] },
  "goodlawproject.org": { name: "Good Law Project", domain: "goodlawproject.org", editorialBias: "positive", aliases: [] },
  "huffingtonpost.co.uk": { name: "HuffPost UK", domain: "huffingtonpost.co.uk", editorialBias: "positive", aliases: ["HuffPost", "HuffPost UK Backfill", "HuffPost UK Search"] },
  "ilga.org": { name: "ILGA World", domain: "ilga.org", editorialBias: "supportive", aliases: [] },
  "independent.co.uk": { name: "The Independent", domain: "independent.co.uk", editorialBias: "neutral", aliases: ["Independent Trans"] },
  "inews.co.uk": { name: "The i", domain: "inews.co.uk", editorialBias: "neutral", aliases: ["The i Backfill", "The i Search", "i news", "inews"] },
  "itv.com": { name: "ITV News", domain: "itv.com", editorialBias: "negative", aliases: ["ITV"] },
  "lambdalegal.org": { name: "Lambda Legal", domain: "lambdalegal.org", editorialBias: "supportive", aliases: [] },
  "mainichi.jp": { name: "Mainichi", domain: "mainichi.jp", editorialBias: "neutral", aliases: ["毎日新聞"] },
  "metro.co.uk": { name: "Metro", domain: "metro.co.uk", editorialBias: "neutral", aliases: ["Metro Trans", "Metro.co.uk"] },
  "mirror.co.uk": { name: "The Mirror", domain: "mirror.co.uk", editorialBias: "neutral", aliases: ["Daily Mirror"] },
  "nationalreview.com": { name: "National Review", domain: "nationalreview.com", editorialBias: "neutral", aliases: ["National Review"] },
  "ndtv.com": { name: "NDTV", domain: "ndtv.com", editorialBias: "neutral", aliases: ["Asia-Pacific Trans News"] },
  "nytimes.com": { name: "New York Times", domain: "nytimes.com", editorialBias: "neutral", aliases: ["The New York Times"] },
  "pinknews.co.uk": { name: "Pink News", domain: "pinknews.co.uk", editorialBias: "supportive", aliases: ["PinkNews", "PinkNews | Latest lesbian, gay, bi and trans news"] },
  "reuters.com": { name: "Reuters", domain: "reuters.com", editorialBias: "neutral", aliases: ["Reuters Trans Coverage"] },
  "sky.com": { name: "Sky News", domain: "sky.com", editorialBias: "neutral", aliases: [] },
  "spectator.co.uk": { name: "The Spectator", domain: "spectator.co.uk", editorialBias: "hostile", aliases: ["The Spectator Backfill", "The Spectator Search"] },
  "spokesman.com": { name: "The Spokesman-Review", domain: "spokesman.com", editorialBias: "neutral", aliases: ["The Spokesman-Review"] },
  "statnews.com": { name: "STAT News", domain: "statnews.com", editorialBias: "neutral", aliases: ["STAT", "STAT News", "STAT News LGBTQ"] },
  "stonewall.org.uk": { name: "Stonewall", domain: "stonewall.org.uk", editorialBias: "supportive", aliases: ["Stonewall Backfill", "Stonewall Search"] },
  "talk.tv": { name: "TalkTV", domain: "talk.tv", editorialBias: "hostile", aliases: ["Talk TV", "TalkTV Backfill", "TalkTV Search"] },
  "telegraph.co.uk": { name: "The Daily Telegraph", domain: "telegraph.co.uk", editorialBias: "hostile", aliases: ["The Telegraph", "The Telegraph Trans"] },
  "theguardian.com": { name: "The Guardian", domain: "theguardian.com", editorialBias: "negative", aliases: ["Guardian Trans", "Guardian Transgender"] },
  "them.us": { name: "Them", domain: "them.us", editorialBias: "supportive", aliases: [] },
  "thesun.co.uk": { name: "The Sun", domain: "thesun.co.uk", editorialBias: "hostile", aliases: ["The Sun Backfill", "The Sun Search"] },
  "thetimes.co.uk": { name: "The Times", domain: "thetimes.co.uk", editorialBias: "hostile", aliases: ["The Times Trans", "Times Trans"] },
  "theweek.com": { name: "The Week", domain: "theweek.com", editorialBias: "neutral", aliases: ["The Week"] },
  "ucla.edu": { name: "UCLA", domain: "ucla.edu", editorialBias: "neutral", aliases: ["Newsroom | UCLA", "UCLA"] },
  "vice.com": { name: "Vice UK", domain: "vice.com", editorialBias: "positive", aliases: ["Vice", "Vice UK Backfill", "Vice UK Search"] },
  "washingtonpost.com": { name: "Washington Post", domain: "washingtonpost.com", editorialBias: "neutral", aliases: ["The Washington Post"] },
  "washingtonstand.com": { name: "The Washington Stand", domain: "washingtonstand.com", editorialBias: "neutral", aliases: ["The Washington Stand"] },};

// ── Derived lookup tables (built once at module load) ────────────────────────

/** Domains we will attribute a real article URL to. */
export const REGISTRY_DOMAINS: ReadonlySet<string> = new Set(Object.keys(SOURCE_REGISTRY));

export const EDITORIAL_BY_DOMAIN: Record<string, EditorialBias> = Object.fromEntries(
  Object.values(SOURCE_REGISTRY).map(s => [s.domain, s.editorialBias]),
);

export const NAME_BY_DOMAIN: Record<string, string> = Object.fromEntries(
  Object.values(SOURCE_REGISTRY).map(s => [s.domain, s.name]),
);

/** alias / display name / title-suffix → canonical domain */
export const ALIAS_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const entry of Object.values(SOURCE_REGISTRY)) {
    m[entry.name] = entry.domain; // the canonical name resolves too
    for (const a of entry.aliases) m[a] = entry.domain;
  }
  return m;
})();

// ── Resolution helpers (copied verbatim from news-digest/index.ts) ───────────

export function normaliseBiasHost(hostname: string): string {
  const h = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^amp\./, '')
    .replace(/^m\./, '');

  if (h === 'diva-magazine.com') return 'divamag.co.uk';

  return h;
}

export function isGoogleNewsUrl(url: string): boolean {
  try {
    const h = normaliseBiasHost(new URL(url).hostname);
    return h === 'news.google.com' || h.endsWith('.google.com');
  } catch {
    return false;
  }
}

export function extractBiasDomainFromUrl(url: string): string | null {
  try {
    const h = normaliseBiasHost(new URL(url).hostname);

    // Google News URLs are redirect/aggregator URLs, not the real publisher.
    if (h === 'news.google.com' || h.endsWith('.google.com')) {
      return null;
    }

    for (const k of REGISTRY_DOMAINS) {
      if (h === k || h.endsWith('.' + k)) return k;
    }

    return null;
  } catch {
    return null;
  }
}

export function extractPublisherSuffix(title: string): string | null {
  const m = title.match(/\s+-\s+(.{2,100})\s*$/);
  return m?.[1]?.trim() ?? null;
}

export function extractBiasDomain(url: string, sourceName?: string, title?: string): string | null {
  // Prefer the real article URL.
  const urlDomain = extractBiasDomainFromUrl(url);
  if (urlDomain) return urlDomain;

  // Google News URLs are aggregators. Try the publisher suffix from the title.
  if (title && isGoogleNewsUrl(url)) {
    const publisher = extractPublisherSuffix(title);
    if (publisher && ALIAS_TO_DOMAIN[publisher]) {
      return ALIAS_TO_DOMAIN[publisher];
    }
    // Title suffix failed — try the RSS <source> element via alias map.
    if (sourceName && ALIAS_TO_DOMAIN[sourceName]) {
      return ALIAS_TO_DOMAIN[sourceName];
    }
    return null;
  }

  // Last resort for direct feeds with known source names.
  if (sourceName && ALIAS_TO_DOMAIN[sourceName]) {
    return ALIAS_TO_DOMAIN[sourceName];
  }

  return null;
}

export function canResolveBiasDomain(item: { link: string; title: string; source: string }): boolean {
  const urlDomain = extractBiasDomainFromUrl(item.link);
  if (urlDomain) return true;

  // Google News URLs are only safe if we can extract a real publisher suffix.
  // Do not use source-name fallback for Google News, because it can misattribute
  // articles from one outlet into another configured bucket.
  if (isGoogleNewsUrl(item.link)) {
    const publisher = extractPublisherSuffix(item.title);
    if (publisher && ALIAS_TO_DOMAIN[publisher]) return true;
    return !!ALIAS_TO_DOMAIN[item.source];
  }

  return !!ALIAS_TO_DOMAIN[item.source];
}

export function biasScoreToLabel(score: number): EditorialBias {
  if (score <= 20) return 'hostile';
  if (score <= 40) return 'negative';
  if (score <= 60) return 'neutral';
  if (score <= 80) return 'positive';
  return 'supportive';
}

export function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(16).padStart(8, '0');
}
