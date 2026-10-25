/**
 * weatherUnits.js - one temperature unit on air (#247, DrJ 25 Oct 2026): every city is read in degrees
 * Celsius. °C is the main number on screen with °F small beside it, but no spoken line says Fahrenheit.
 *
 * checkSegments() drops a weather line that names Fahrenheit (first lock); airCheck() fails the hour if one
 * survives (second lock). Unmeasured is a failure: a weather line whose text cannot be read fails too.
 */

// "Fahrenheit", "°F", "° F", "degrees F", "64F", "64 °F". Not "F-16" or a lone "F" in a name.
const FAHRENHEIT = /\bfahrenheit\b|°\s*F\b|\bdeg(?:rees?|s)?\.?\s+F\b|\b\d+\s?F\b(?!-)/i;

/** null when a weather line may air; otherwise why it may not. */
export function weatherUnitReason(text) {
  if (typeof text !== "string") return "weather: line text unreadable (unmeasured)";
  return FAHRENHEIT.test(text) ? "weather: says Fahrenheit (#247: every city in degrees Celsius)" : null;
}

/** airCheck's second lock: every kept line of every weather slot. */
export function weatherProblems(segments) {
  return Object.entries(segments || {}).filter(([id]) => /^weather/.test(id))
    .flatMap(([id, seg]) => {
      if (!Array.isArray(seg?.lines)) return [`${id}: weather lines unreadable (unmeasured)`];
      return seg.lines.map((l) => { const why = weatherUnitReason(l?.text); return why ? `${id}/${l?.id}: ${why}` : null; }).filter(Boolean);
    });
}
