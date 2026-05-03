function parseIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const BULLMQ_PREFIX = String(process.env.BULLMQ_PREFIX || "scoop").trim() || "scoop";

export const QUEUE_NAMES = {
  ingestion: "ingestion",
  video: "video",
  enrichment: "enrichment",
  analysis: "analysis",
  realityIndex: "reality-index",
  notification: "notification",
  newsletter: "newsletter",
  brief: "brief",
  maintenance: "maintenance",
};

export const JOB_NAMES = {
  newsIngestAll: "news.ingest.all",
  videosIngestAll: "videos.ingest.all",
  articlesEnrichBatch: "articles.enrich.batch",
};

export const JOB_IDS = {
  [JOB_NAMES.newsIngestAll]: "news-ingest-all-singleton",
  [JOB_NAMES.videosIngestAll]: "videos-ingest-all-singleton",
  [JOB_NAMES.articlesEnrichBatch]: "articles-enrich-batch-singleton",
};

export const defaultJobOptions = {
  attempts: 1,
  removeOnComplete: {
    count: 100,
  },
  removeOnFail: {
    count: 200,
  },
};

export const queueConcurrency = {
  ingestion: parseIntEnv("QUEUE_CONCURRENCY_INGESTION", 1),
  video: parseIntEnv("QUEUE_CONCURRENCY_VIDEO", 1),
  enrichment: parseIntEnv("QUEUE_CONCURRENCY_ENRICHMENT", 2),
};
