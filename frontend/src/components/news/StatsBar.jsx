import { motion } from "framer-motion";
import { Activity, Rss, RefreshCw, Database, Youtube } from "lucide-react";
import { useStats } from "../../hooks/useNews";
import { formatDistanceToNow } from "date-fns";

export default function StatsBar() {
  const { data: stats } = useStats();

  if (!stats) return null;

  const lastRun    = stats.scheduler?.lastRun;
  const isRunning  = stats.scheduler?.isRunning;
  const isVideoRun = stats.scheduler?.isVideoRun;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-tertiary)] mb-4 px-1"
    >
      <div className="flex items-center gap-1.5">
        <Database size={12} />
        <span>
          <strong className="text-[var(--color-text-secondary)]">{(stats.totalArticles || 0).toLocaleString()}</strong> articles
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Rss size={12} />
        <span>
          <strong className="text-[var(--color-text-secondary)]">{stats.scheduler?.sourceCount || 0}</strong> sources
        </span>
      </div>

      {stats.totalVideos > 0 && (
        <div className="flex items-center gap-1.5">
          <Youtube size={12} className="text-red-500" />
          <span>
            <strong className="text-[var(--color-text-secondary)]">{stats.totalVideos.toLocaleString()}</strong> videos
          </span>
        </div>
      )}

      {lastRun && (
        <div className="flex items-center gap-1.5">
          <RefreshCw size={12} className={isRunning ? "animate-spin" : ""} />
          <span>Updated {formatDistanceToNow(new Date(lastRun), { addSuffix: true })}</span>
        </div>
      )}

      {isRunning && (
        <div className="flex items-center gap-1.5 text-emerald-500">
          <Activity size={12} />
          <span>Fetching news…</span>
        </div>
      )}

      {isVideoRun && (
        <div className="flex items-center gap-1.5 text-scoop-orange-500">
          <Youtube size={12} className="animate-pulse" />
          <span>Fetching videos…</span>
        </div>
      )}

      {stats.articlesToday > 0 && (
        <div className="flex items-center gap-1.5">
          <span>+<strong className="text-[var(--color-text-secondary)]">{stats.articlesToday}</strong> today</span>
        </div>
      )}
    </motion.div>
  );
}
