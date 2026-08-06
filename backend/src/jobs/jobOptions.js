function parseIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const BULLMQ_PREFIX = String(process.env.BULLMQ_PREFIX || "scoop").trim() || "scoop";

export const QUEUE_NAMES = {
  ingestion: "ingestion",
  video: "video",              // YouTube INGESTION (fetchAllYouTube) — not rendering
  videoRender: "video_render", // the autopost loop: spec → render → upload
  social: "social",            // outbound posting to bluesky/threads/fb/ig/li/pinterest
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
  videoRenderCycle: "video.render.cycle",
  socialPostAll: "social.post.all",
};

export const JOB_IDS = {
  [JOB_NAMES.newsIngestAll]: "news-ingest-all-singleton",
  [JOB_NAMES.videosIngestAll]: "videos-ingest-all-singleton",
  [JOB_NAMES.articlesEnrichBatch]: "articles-enrich-batch-singleton",
  [JOB_NAMES.videoRenderCycle]: "video-render-cycle-singleton",
  [JOB_NAMES.socialPostAll]: "social-post-all-singleton",
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
  // STRICTLY 1. A render is minutes of ffmpeg and the daily cap is a global
  // count — two concurrent cycles would both read "under cap" and both publish.
  videoRender: parseIntEnv("QUEUE_CONCURRENCY_VIDEO_RENDER", 1),
  // STRICTLY 1. socialPublisher's single-flight guard is PROCESS-LOCAL, so a
  // second concurrent consumer would not see it and both would post.
  social: parseIntEnv("QUEUE_CONCURRENCY_SOCIAL", 1),
};
