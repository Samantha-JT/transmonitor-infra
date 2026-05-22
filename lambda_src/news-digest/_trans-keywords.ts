// Keyword groups for trans-focused news queries.
// Used by _feeds.ts to build targeted Google News search queries
// that surface trans-relevant journalism from general-purpose outlets.
//
// Design: each group is ~5-15 terms, kept short because Google News
// query URLs max out around 256 chars once site: and when: filters
// are added. Per-query, pick 1-3 groups that match the query's intent.

// Core identity terminology. Include in almost every query.
export const IDENTITY_TERMS = [
  'trans',                          // standalone — word-boundary regex prevents 'transit'/'transparent' matching
  'transgender',
  'trans rights',
  'gender identity',
  'gender expression',
  'trans woman',
  'trans women',
  'trans man',
  'trans men',
  'transmasculine',
  'transmasc',
  'transfeminine',
  'transfemme',
  'nonbinary',
  'genderqueer',
  'genderfluid',
  'agender',
  'bigender',
  'two-spirit',         // Indigenous North American
  'transsexual',        // older term, still used in legal documents
  'MTF',                // community shorthand: male-to-female
  'FTM',                // community shorthand: female-to-male
  'enby',               // NB / nonbinary slang
  'travesti',           // LatAm — specifically Argentine/Brazilian context
  'hijra',              // South Asia — legally recognised third gender in India/Bangladesh
  'kathoey',            // Thai
  'muxe',               // Zapotec/Mexican
  'bakla',              // Filipino
  "fa'afafine",         // Samoa
];

// Medical and clinical vocabulary. For healthcare queries.
export const MEDICAL_TERMS = [
  'gender-affirming care',
  'gender dysphoria',
  'puberty blockers',
  'hormone therapy',
  'HRT',                            // ⚠️ overlaps with menopause HRT
  'cross-sex hormones',
  'feminizing hormones',
  'masculinizing hormones',
  'gender reassignment',
  'gender confirmation',
  'top surgery',
  'bottom surgery',
  'vaginoplasty',
  'phalloplasty',
  'metoidioplasty',
  'voice training',
  'voice therapy',
  'WPATH SOC',                      // WPATH Standards of Care
  'Standards of Care',
  'informed consent model',
  'trans healthcare',
];

// UK legal and policy terms.
export const LEGAL_TERMS_UK = [
  'gender recognition certificate',
  'GRC',
  'Gender Recognition Act',
  'GRA reform',
  'Cass Review',
  'Bell v Tavistock',
  'Equality Act',
  'EHRC',
  'Tavistock clinic',
  'Gender Identity Clinic',
  'GIC',
  'Sandyford clinic',                // Scottish equivalent of Tavistock
  'For Women Scotland',              // legal challenger group
  'single-sex spaces',               // ⚠️ politically charged
];

// US legal and policy terms.
export const LEGAL_TERMS_US = [
  'gender-affirming care ban',
  'trans bill',
  'bathroom bill',
  'drag ban',
  'SAFE Act',
  'gender identity law',
  'Chase Strangio',
];

// EU/European terms.
export const LEGAL_TERMS_EU = [
  'gender self-determination',
  'Ley Trans',                     // Spain 2023
  'Selbstbestimmungsgesetz',       // Germany 2024
  'gender recognition law',
  'ILGA Europe',
];

// International (LatAm, Asia, Oceania, Africa).
export const LEGAL_TERMS_INTL = [
  'Ley de Identidad de Género',    // Argentina 2012
  'gender identity law',
  'transgender rights',
  'marriage equality',
  'ILGA World',
];

// Hostile/anti-trans framing. For tracking what hostile outlets are saying.
export const HOSTILE_FRAMING = [
  'gender ideology',
  'radical gender ideology',
  'trans ideology',
  'trans agenda',
  'gender extremism',
  'gender critical',
  'trans debate',
  'protecting women and girls',     // ⚠️ both legitimate and used as anti-trans framing
  'biological sex',                 // ⚠️ used both scientifically and as framing tool
  'sex-based rights',
  'TERF',                           // tracker term — surfaces both critique-of and use-of
];

// Public figures who appear repeatedly in trans news coverage.
export const KEY_PEOPLE = [
  'Erin Reed',
  'Dylan Mulvaney',
  'Chase Strangio',
  'Munroe Bergdorf',
  'Laverne Cox',
  'Schuyler Bailar',
  'Sarah McBride',                   // US Congresswoman
  'Imara Jones',                     // TransLash founder
  'Jamie Reed',                      // detransitioner / whistleblower
  'Helen Joyce',                     // anti-trans commentator
  'Kathleen Stock',                  // anti-trans academic
];

// Detransition coverage. Real beat — controversial, but informationally important.
export const DETRANS_TERMS = [
  'detransition',
  'detransitioner',
  'desistance',
];

// Helper: builds an OR'd query fragment from one or more groups.
// Each term is quoted so multi-word terms match as phrases.
// Deduplicates across groups.
export function transQuery(...groups: readonly string[][]): string {
  const terms = Array.from(new Set(groups.flat()));
  return '(' + terms.map(t => `"${t}"`).join(' OR ') + ')';
}
