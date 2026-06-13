/**
 * Shared Redis key + ref shape for the media-bias scoring work-queue.
 *
 * Producer:  feed-ingestor (and, until PR3, news-digest as a backstop) RPUSHes
 *            BiasQueueRef JSON onto BIAS_QUEUE_KEY for each newly-seen article
 *            whose domain resolves to a known bias source.
 * Consumer:  media-bias lambda (scheduledBiasHandler) LPOPs a batch each run,
 *            scores + ingests, and applies a 7-day dedup window.
 *
 * The list is capped (BIAS_QUEUE_MAX) on the producer side so it cannot grow
 * unbounded if the consumer is down.
 */
export const BIAS_QUEUE_KEY = 'media:bias:queue';
export const BIAS_QUEUE_MAX = 500;

/** 7-day dedup window so the same URL is not re-scored across runs. */
export const BIAS_DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7;
export const biasDedupKey = (urlHash: string) => `media:dedup:${urlHash}`;

export interface BiasQueueRef {
  url: string;
  title: string;
  source: string;
  /** epoch millis */
  publishedAt: number;
  summary?: string;
}
