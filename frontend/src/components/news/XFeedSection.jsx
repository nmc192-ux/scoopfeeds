import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, CheckCircle2, Users, X, Search } from "lucide-react";
import { useNewsStore } from "../../store/newsStore";
import { X_ACCOUNTS } from "../../config/xAccounts";
import { topicColor } from "../../lib/topicColors";
import clsx from "clsx";

// X/Twitter bird icon (text-based since no icon library has it)
function XIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function AccountCard({ account, color }) {
  const profileUrl = `https://x.com/${account.handle}`;
  const timelineUrl = `https://x.com/${account.handle}`;

  return (
    <motion.a
      href={timelineUrl}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)]
                 bg-[var(--color-surface)] hover:border-[#1DA1F2]/40 hover:shadow-md
                 transition-all duration-200 group cursor-pointer"
    >
      {/* Avatar placeholder */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm"
        style={{ background: `linear-gradient(135deg, ${color}cc, ${color})` }}
      >
        {account.name.charAt(0)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-[var(--color-text)] truncate">
            {account.name}
          </span>
          {account.verified && (
            <CheckCircle2 size={13} className="text-[#1DA1F2] flex-shrink-0" />
          )}
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)]">@{account.handle}</span>
        {account.desc && (
          <p className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5">{account.desc}</p>
        )}
      </div>

      <ExternalLink
        size={14}
        className="text-[var(--color-text-tertiary)] group-hover:text-[#1DA1F2] flex-shrink-0 transition-colors"
      />
    </motion.a>
  );
}

export default function XFeedSection() {
  const { activeTopics } = useNewsStore();
  const [dismissed, setDismissed] = useState(false);

  const currentTopic = activeTopics.includes("top")
    ? "top"
    : activeTopics[0] || "top";

  const accounts = X_ACCOUNTS[currentTopic] || X_ACCOUNTS["top"] || [];
  const color = topicColor(currentTopic);

  const topicLabel = currentTopic.replace(/-/g, " ");
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(topicLabel)}&f=live`;

  if (dismissed || accounts.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black dark:bg-white rounded-xl flex items-center justify-center shadow-md">
            <XIcon size={16} />
            <span className="sr-only">X</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">
              On 𝕏 — {topicLabel.charAt(0).toUpperCase() + topicLabel.slice(1)}
            </h2>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Top accounts covering this topic
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live search link */}
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full
                       bg-black dark:bg-white text-white dark:text-black
                       hover:opacity-80 transition-opacity"
          >
            <Search size={11} />
            Live Search
          </a>

          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface2)] transition-colors"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Account grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {accounts.map((account, i) => (
          <motion.div
            key={account.handle}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
          >
            <AccountCard account={account} color={color} />
          </motion.div>
        ))}
      </div>

      {/* Embed disclaimer */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-tertiary)]">
          💡 Click any account to view their live feed on X
        </p>
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="sm:hidden text-xs text-[#1DA1F2] hover:underline"
        >
          Search live on X →
        </a>
      </div>
    </motion.section>
  );
}
