import { motion } from "framer-motion";
import { RefreshCw, Newspaper } from "lucide-react";

const EMPTY_MESSAGES = [
  { emoji: "🦗", text: "Nothing here but crickets...", sub: "Our AI hamsters are running very fast right now." },
  { emoji: "🚀", text: "Loading the good stuff!", sub: "News is being warped in from the internet." },
  { emoji: "🕵️", text: "News is undercover right now", sub: "We've sent our best journalists. Both of them." },
  { emoji: "🧐", text: "Hmm, nothing found", sub: "The news might be on a coffee break. ☕" },
  { emoji: "🎭", text: "The stage is empty", sub: "But the show must go on! Try refreshing." },
];

export default function EmptyState({ type = "noArticles", onRefresh }) {
  const msg = EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 px-8 text-center"
    >
      <motion.div
        animate={{ rotate: [0, -10, 10, -10, 0] }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="text-6xl mb-4"
      >
        {type === "error" ? "😵" : type === "search" ? "🔍" : msg.emoji}
      </motion.div>

      <h3 className="text-xl font-semibold text-[var(--color-text)] mb-2">
        {type === "error"
          ? "Oops! Connection trouble"
          : type === "search"
          ? "No results found"
          : msg.text}
      </h3>
      <p className="text-sm text-[var(--color-text-tertiary)] max-w-xs mb-6">
        {type === "error"
          ? "The API server might be warming up. Give it a moment!"
          : type === "search"
          ? "Try different keywords or browse by topic."
          : msg.sub}
      </p>

      {onRefresh && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRefresh}
          className="flex items-center gap-2 px-5 py-2.5 bg-cobalt-600 text-white rounded-full font-medium text-sm shadow-lg hover:shadow-xl transition-shadow"
        >
          <RefreshCw size={14} />
          Try Again
        </motion.button>
      )}
    </motion.div>
  );
}

export function BackendOffline() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-bg)] p-8 text-center"
    >
      <div className="text-7xl mb-6">🔌</div>
      <h2 className="text-2xl font-bold mb-3">Backend Not Running</h2>
      <p className="text-[var(--color-text-secondary)] max-w-sm mb-6">
        Start the backend server first, then this app will come alive with fresh news!
      </p>
      <div className="card p-4 text-left text-sm font-mono text-[var(--color-text-secondary)] max-w-sm w-full">
        <p className="text-emerald-500 mb-1">$ cd backend</p>
        <p className="text-emerald-500">$ npm start</p>
      </div>
      <p className="mt-4 text-xs text-[var(--color-text-tertiary)]">
        Waiting for API on port 4000...
      </p>
      <div className="mt-4 flex gap-1">
        {[0, 0.2, 0.4].map((delay, i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay }}
            className="w-2 h-2 bg-cobalt-600 rounded-full"
          />
        ))}
      </div>
    </motion.div>
  );
}
