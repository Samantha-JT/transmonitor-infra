export const STORY_TTL = 86400;
export const DIGEST_ACCUMULATOR_TTL = 172800;
export const STORY_TRACK_KEY = (hash: string) => `story:track:v1:${hash}`;
export const STORY_SOURCES_KEY = (hash: string) => `story:sources:v1:${hash}`;
export const STORY_PEAK_KEY = (hash: string) => `story:peak:v1:${hash}`;
export const STORY_TRACK_KEY_PREFIX = 'story:track:v1:';
export const DIGEST_ACCUMULATOR_KEY = (variant: string, lang: string) => `digest:acc:v1:${variant}:${lang}`;