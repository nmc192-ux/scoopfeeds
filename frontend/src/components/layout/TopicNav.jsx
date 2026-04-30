import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Bookmark } from "lucide-react";
import { useNewsStore } from "../../store/newsStore";
import { useTopics } from "../../hooks/useNews";
import { useGeo } from "../../hooks/useGeo";
import { topicColor, COBALT_PRIMARY } from "../../lib/topicColors";
import clsx from "clsx";

export default function TopicNav() {
  const { activeTopics, toggleTopic, savedArticles } = useNewsStore();
  const { data: topics = [] } = useTopics();
  const { countryCode, country } = useGeo();
  const scrollRef = useRef(null);
  const savedActive = activeTopics.includes("saved");
  const savedCount = savedArticles.length;

  // Auto-scroll active topic into view
  useEffect(() => {
    if (scrollRef.current && activeTopics.length > 0) {
      const activeBtn = scrollRef.current.querySelector("[data-active='true']");
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [activeTopics]);

  return (
    <nav className="sticky top-14 sm:top-16 z-40 glass border-b border-[var(--color-border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Scroll container with fade hint on right edge */}
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex items-center gap-2 py-3 overflow-x-auto hide-scrollbar"
          >
          {savedCount > 0 && (
            <motion.button
              data-active={savedActive}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggleTopic("saved")}
              className={clsx(
                "topic-pill flex items-center gap-1.5 flex-shrink-0",
                savedActive ? "topic-pill-active" : "topic-pill-inactive"
              )}
              style={savedActive ? { backgroundColor: COBALT_PRIMARY } : {}}
              title={`${savedCount} saved articles`}
            >
              <Bookmark size={13} className={savedActive ? "fill-white" : ""} />
              <span>Saved</span>
              <span className={clsx(
                "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                savedActive ? "bg-white/25 text-white" : "bg-[var(--color-surface2)] text-[var(--color-text-tertiary)]"
              )}>{savedCount}</span>
            </motion.button>
          )}
          {topics.map((topic) => {
            const isActive = activeTopics.includes(topic.id);
            const color = topicColor(topic.id);
            // Local tab shows the detected country as a subtitle so it's
            // obvious what "Local" means right now — same pattern as Apple
            // News' "Local: San Francisco". Users can override via the
            // CountryPicker in the header.
            const isLocal = topic.id === "local";
            const localSuffix = isLocal && countryCode ? ` · ${countryCode}` : "";

            return (
              <motion.button
                key={topic.id}
                data-active={isActive}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggleTopic(topic.id)}
                className={clsx(
                  "topic-pill flex items-center gap-1.5 flex-shrink-0",
                  isActive ? "topic-pill-active" : "topic-pill-inactive"
                )}
                style={isActive ? { backgroundColor: color } : {}}
                title={
                  isLocal && country
                    ? `Local news for ${country} — change country in header`
                    : topic.count
                    ? `${topic.count} articles`
                    : undefined
                }
              >
                <span className="text-base leading-none">{topic.emoji}</span>
                <span>{topic.label}{localSuffix}</span>
                {!isLocal && topic.count > 0 && (
                  <span
                    className={clsx(
                      "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                      isActive
                        ? "bg-white/25 text-white"
                        : "bg-[var(--color-surface2)] text-[var(--color-text-tertiary)]"
                    )}
                  >
                    {topic.count > 999 ? "999+" : topic.count}
                  </span>
                )}
              </motion.button>
            );
          })}
          </div>
          {/* Right-edge fade — indicates more topics to scroll to */}
          <div
            className="pointer-events-none absolute right-0 top-0 h-full w-16"
            style={{
              background: "linear-gradient(to right, transparent, var(--color-bg))",
            }}
          />
        </div>
      </div>
    </nav>
  );
}
