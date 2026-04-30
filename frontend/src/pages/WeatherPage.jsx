/**
 * WeatherPage — `/weather`
 *
 * Multi-city weather hub. Shows the user's location at the top (geolocation
 * with backend fallback) plus a curated grid of major world cities so the
 * page is useful even before geolocation resolves. Designed as a return-visit
 * surface — weather is the #1 daily-habit anchor for news products.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ChevronLeft, MapPin, Loader2, RefreshCw,
  Sun, CloudSun, Cloud, CloudRain, CloudSnow, Zap, CloudFog,
} from "lucide-react";
import clsx from "clsx";

/* ─── World cities catalog ───────────────────────────────────────────────── */
const CITIES = [
  { name: "New York",     lat: 40.7128,  lon:  -74.0060, flag: "🇺🇸" },
  { name: "Los Angeles",  lat: 34.0522,  lon: -118.2437, flag: "🇺🇸" },
  { name: "Toronto",      lat: 43.6532,  lon:  -79.3832, flag: "🇨🇦" },
  { name: "London",       lat: 51.5074,  lon:   -0.1278, flag: "🇬🇧" },
  { name: "Paris",        lat: 48.8566,  lon:    2.3522, flag: "🇫🇷" },
  { name: "Berlin",       lat: 52.5200,  lon:   13.4050, flag: "🇩🇪" },
  { name: "Madrid",       lat: 40.4168,  lon:   -3.7038, flag: "🇪🇸" },
  { name: "Rome",         lat: 41.9028,  lon:   12.4964, flag: "🇮🇹" },
  { name: "Moscow",       lat: 55.7558,  lon:   37.6173, flag: "🇷🇺" },
  { name: "Istanbul",     lat: 41.0082,  lon:   28.9784, flag: "🇹🇷" },
  { name: "Dubai",        lat: 25.2048,  lon:   55.2708, flag: "🇦🇪" },
  { name: "Riyadh",       lat: 24.7136,  lon:   46.6753, flag: "🇸🇦" },
  { name: "Cairo",        lat: 30.0444,  lon:   31.2357, flag: "🇪🇬" },
  { name: "Lagos",        lat:  6.5244,  lon:    3.3792, flag: "🇳🇬" },
  { name: "Johannesburg", lat:-26.2041,  lon:   28.0473, flag: "🇿🇦" },
  { name: "Mumbai",       lat: 19.0760,  lon:   72.8777, flag: "🇮🇳" },
  { name: "Karachi",      lat: 24.8607,  lon:   67.0011, flag: "🇵🇰" },
  { name: "Singapore",    lat:  1.3521,  lon:  103.8198, flag: "🇸🇬" },
  { name: "Bangkok",      lat: 13.7563,  lon:  100.5018, flag: "🇹🇭" },
  { name: "Hong Kong",    lat: 22.3193,  lon:  114.1694, flag: "🇭🇰" },
  { name: "Tokyo",        lat: 35.6762,  lon:  139.6503, flag: "🇯🇵" },
  { name: "Seoul",        lat: 37.5665,  lon:  126.9780, flag: "🇰🇷" },
  { name: "Sydney",       lat:-33.8688,  lon:  151.2093, flag: "🇦🇺" },
  { name: "São Paulo",    lat:-23.5505,  lon:  -46.6333, flag: "🇧🇷" },
  { name: "Mexico City",  lat: 19.4326,  lon:  -99.1332, flag: "🇲🇽" },
  { name: "Buenos Aires", lat:-34.6037,  lon:  -58.3816, flag: "🇦🇷" },
];

/* ─── Weather icon picker ────────────────────────────────────────────────── */
function iconFor(code) {
  const c = String(code || "").toLowerCase();
  if (/clear|sun/.test(c))         return <Sun        size={28} className="text-amber-500" />;
  if (/partly|few/.test(c))        return <CloudSun   size={28} className="text-amber-400" />;
  if (/cloud/.test(c))             return <Cloud      size={28} className="text-[var(--color-text-tertiary)]" />;
  if (/rain|drizzle|shower/.test(c)) return <CloudRain  size={28} className="text-electric-500" />;
  if (/snow|sleet|ice/.test(c))    return <CloudSnow  size={28} className="text-electric-300" />;
  if (/thunder|storm/.test(c))     return <Zap        size={28} className="text-amber-500" />;
  if (/fog|mist|haze/.test(c))     return <CloudFog   size={28} className="text-[var(--color-text-tertiary)]" />;
  return <CloudSun size={28} className="text-[var(--color-text-tertiary)]" />;
}

/* ─── API ────────────────────────────────────────────────────────────────── */
async function fetchCity({ lat, lon }) {
  const { data } = await axios.get("/api/weather", { params: { lat, lon } });
  return data?.data ?? null;
}

function CityCard({ city, big = false }) {
  const { data: w, isLoading } = useQuery({
    queryKey: ["weather-city", city.lat, city.lon],
    queryFn:  () => fetchCity(city),
    staleTime: 15 * 60 * 1000,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-lg transition-shadow",
        big && "md:col-span-2 lg:col-span-3 p-6"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider mb-0.5">
            <span aria-hidden="true">{city.flag}</span>
            <span className="truncate">{city.label || city.name}</span>
          </div>
          <p className={clsx("font-bold tabular-nums text-[var(--color-text)]", big ? "text-4xl" : "text-2xl")}>
            {isLoading ? "…" : w?.temp != null ? `${Math.round(w.temp)}°` : "—"}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">
            {w?.description || w?.condition || (isLoading ? "Loading…" : "—")}
          </p>
        </div>
        {iconFor(w?.condition || w?.description || w?.icon)}
      </div>
      {w && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-[var(--color-text-tertiary)]">
          <div>
            <p className="uppercase tracking-wider">Feels</p>
            <p className="text-[var(--color-text-secondary)] font-semibold">{w.feelsLike != null ? `${Math.round(w.feelsLike)}°` : "—"}</p>
          </div>
          <div>
            <p className="uppercase tracking-wider">Humidity</p>
            <p className="text-[var(--color-text-secondary)] font-semibold">{w.humidity != null ? `${Math.round(w.humidity)}%` : "—"}</p>
          </div>
          <div>
            <p className="uppercase tracking-wider">Wind</p>
            <p className="text-[var(--color-text-secondary)] font-semibold">{w.wind != null ? `${Math.round(w.wind)} km/h` : "—"}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function WeatherPage() {
  const navigate = useNavigate();
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Your Location", flag: "📍" }),
      () => {},
      { timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = "Weather — Scoopfeeds";
    return () => { document.title = prev; };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-electric-50 dark:bg-electric-950/40 text-electric-600 dark:text-electric-400 shrink-0">
          <CloudSun size={22} />
        </div>
        <div className="min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            Weather
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex items-center gap-1.5">
            <MapPin size={11} />
            Conditions across {CITIES.length} world cities · refreshed every 15 min
          </p>
        </div>
      </div>

      {/* User's location — featured */}
      {coords && (
        <div className="mb-6">
          <CityCard city={{ ...coords, label: "Your Location" }} big />
        </div>
      )}

      {/* World cities grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {CITIES.map(c => (
          <CityCard key={c.name} city={c} />
        ))}
      </div>
    </div>
  );
}
