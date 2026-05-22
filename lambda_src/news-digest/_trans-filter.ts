// Post-fetch keyword filter for the trans variant.
//
// The community category aggregates direct RSS from broad LGBTQ+ outlets
// (PinkNews, LGBTQ Nation, Them, Xtra, Autostraddle, The 19th). Those
// outlets cover queer journalism more broadly — gay/lesbian/bi celebrity
// coverage, drag, sex-positive content, etc. — so without filtering, the
// community panel surfaces a lot of LGBTQ+-but-not-trans-specific content.
//
// This module filters items down to those whose title contains at least
// one trans-specific keyword. RSS tag/category filtering would be more
// reliable but is not currently preserved through the digest pipeline
// (item shape: source, title, link, publishedAt, ...) — extending the
// parser to capture <category> tags is a separate change.

import {
  IDENTITY_TERMS,
  MEDICAL_TERMS,
  KEY_PEOPLE,
  DETRANS_TERMS,
} from './_trans-keywords';

const TRANS_RELEVANT_KEYWORDS = [
  ...IDENTITY_TERMS,
  ...MEDICAL_TERMS,
  ...KEY_PEOPLE,
  ...DETRANS_TERMS,
  // Additional terms not in keyword groups — catch false negatives from
  // broad LGBTQ+ outlets that use these without 'transgender' explicitly.
  'gender-affirming',
  'gender nonconforming',
  'gender diverse',
  'gender diversity',
  'gender minority',
  'gender minorities',
  'trans-inclusive',
  'trans inclusive',
  'transphobia',
  'transphobic',
  'anti-trans',
  'trans community',
  'trans people',
  'trans youth',
  'trans kids',
  'trans adults',
  'trans athlete',
  'trans athletes',
  'trans student',
  'trans students',
  'trans military',
  'trans visibility',
  'trans awareness',
  'trans pride',
  'trans health',
  'trans care',
  'trans lives',
  'trans rights',
  'gender clinic',
  'gender medicine',
  'gender treatment',
  'gender surgery',
  'gender transition',
  'gender expression',
  'SOGIESC',              // UN terminology: sexual orientation, gender identity/expression, sex characteristics
  'gender marker',
  'name change',          // legal name change — trans-specific in context
  'legal gender',
  'chosen name',
  'dead name',
  'deadname',
].map(kw => kw.toLowerCase());

// Word-boundary regex; built once at module load.
// Escapes regex special chars in keywords (e.g. apostrophe in fa'afafine).
const TRANS_PATTERN = new RegExp(
  '\\b(?:' +
    TRANS_RELEVANT_KEYWORDS.map(kw =>
      kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ).join('|') +
    ')\\b',
  'i',
);

export interface FilterableItem {
  title?: string;
}

/**
 * Returns true if the item's title contains any trans-relevant keyword.
 * Word-boundary matched, case-insensitive. Items with no title pass through
 * (defensive — better to keep an unscored item than drop it silently).
 */
export function isTransRelevant(item: FilterableItem): boolean {
  if (!item.title) return true;
  return TRANS_PATTERN.test(item.title);
}
