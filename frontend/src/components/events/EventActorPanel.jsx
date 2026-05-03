/**
 * EventActorPanel — displays key actors (people, orgs, countries) in an event.
 */

import { User, Building2, Globe, Users } from "lucide-react";

const TYPE_ICON = {
  person:  User,
  org:     Building2,
  country: Globe,
};

const TYPE_COLORS = {
  person:  "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  org:     "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300",
  country: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300",
};

function ActorChip({ actor }) {
  const Icon = TYPE_ICON[actor.actor_type] ?? Users;
  const color = TYPE_COLORS[actor.actor_type] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className={`p-1.5 rounded-lg flex-shrink-0 ${color}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[var(--color-text)] truncate">
            {actor.actor_name}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${color}`}>
            {actor.actor_type ?? "person"}
          </span>
        </div>
        {actor.role && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">{actor.role}</p>
        )}
      </div>
      {actor.mentions > 1 && (
        <span className="text-[10px] text-[var(--color-text-secondary)] flex-shrink-0 pt-0.5">
          ×{actor.mentions}
        </span>
      )}
    </div>
  );
}

export default function EventActorPanel({ actors = [], isLoading = false }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!actors.length) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] py-4 text-center">
        Actors will appear as articles are analysed.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {actors.map(actor => (
        <ActorChip key={actor.actor_name} actor={actor} />
      ))}
    </div>
  );
}
