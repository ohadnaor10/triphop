"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import {
  IconAlertTriangle,
  IconCalendar,
  IconGlobe,
  IconGrid,
  IconHeart,
  IconMap,
  IconMapPin,
  IconPlus,
  IconSliders,
  IconUser,
  IconWhatsApp,
  IconX,
} from "./components/icons";
import type { FeedMapPoint, FeedMapPost } from "./components/TripMap";
import Combobox from "./components/Combobox";
import CalendarRangePicker from "./components/CalendarRangePicker";
import DestinationPickerOverlay from "./components/DestinationPickerOverlay";
import DatePickerOverlay from "./components/DatePickerOverlay";
import DurationInput, { DURATION_UNITS, type DurationUnit, type DurationValue } from "./components/DurationInput";
import {
  geocodePlace,
  geocodeSuggestions,
  getAllCountries,
  getCitiesOfCountry,
  getCountryByCode,
  isGeographicallyRelevant,
  REGION_CENTROIDS,
  REGIONS,
  warmGeocode,
  type GeoDestination,
  type Region,
} from "./lib/geo";
import { durationToDays, hasActiveDateSearch, rankByRelevance, type DateSearchInput } from "./lib/relevance";
import { INITIAL_POSTS } from "./data/mockPosts";

const TripMap = dynamic(() => import("./components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map…</div>
  ),
});

const TripDestinationsMap = dynamic(() => import("./components/TripDestinationsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map…</div>
  ),
});

// ---------- Domain types ----------

export type TripVibe = "Backpacking" | "Road Trip" | "Luxury" | "Chill" | "Adventure" | "Culture";

export type Gender = "Woman" | "Man" | "Non-binary" | "Prefer not to say";

export type UserProfile = {
  name: string;
  age: number;
  gender: Gender;
  avatarColor: string;
};

export type FocusedDestination = { mode: "focused"; country: string; countryCode: string; cities: string[] };
export type BroadDestination = { mode: "broad"; regions: Region[] };
export type Destination = FocusedDestination | BroadDestination;

export type TripDuration = { amount: number; unit: DurationUnit };

export type FocusedDateInfo = { mode: "focused"; startDate: string; endDate: string };
export type BroadDateInfo = { mode: "broad"; months: string[]; duration?: TripDuration };
export type FlexibleDateInfo = { mode: "flexible"; earliest: string; latest: string; duration?: TripDuration };
export type TripDate = FocusedDateInfo | BroadDateInfo | FlexibleDateInfo;

export type Post = {
  id: string;
  user: UserProfile;
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  whatsapp: string;
};

// ---------- Static reference data ----------

const TRIP_STYLES: TripVibe[] = ["Backpacking", "Road Trip", "Luxury", "Chill", "Adventure", "Culture"];
const GENDERS: Gender[] = ["Woman", "Man", "Non-binary", "Prefer not to say"];

const VIBE_STYLES: Record<TripVibe, string> = {
  Backpacking: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  "Road Trip": "bg-amber-50 text-amber-700 ring-amber-600/20",
  Luxury: "bg-violet-50 text-violet-700 ring-violet-600/20",
  Chill: "bg-sky-50 text-sky-700 ring-sky-600/20",
  Adventure: "bg-rose-50 text-rose-700 ring-rose-600/20",
  Culture: "bg-orange-50 text-orange-700 ring-orange-600/20",
};

const AVATAR_COLORS = [
  "bg-gradient-to-br from-orange-400 to-pink-500",
  "bg-gradient-to-br from-sky-400 to-indigo-500",
  "bg-gradient-to-br from-emerald-400 to-teal-500",
  "bg-gradient-to-br from-fuchsia-400 to-purple-500",
];

const CURRENT_USER: UserProfile = {
  name: "Alex Rivera",
  age: 26,
  gender: "Non-binary",
  avatarColor: AVATAR_COLORS[2],
};

// ---------- Formatting helpers ----------

function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start).toLocaleDateString("en-US", opts);
  const e = new Date(end).toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${s} – ${e}`;
}

function formatMonth(ym: string) {
  return new Date(`${ym}-01`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function shortMonthName(year: string, month: number) {
  return new Date(Number(year), month - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
}

function isDurationWithinRange(duration: DurationValue, startDate: string, endDate: string): boolean {
  if (!duration.amount || !startDate || !endDate) return true;
  const durationDays = durationToDays({ amount: Number(duration.amount), unit: duration.unit });
  if (durationDays === undefined) return true;
  return durationDays <= daysBetween(startDate, endDate);
}

function groupConsecutive(nums: number[]): [number, number][] {
  const sorted = [...nums].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) {
      last[1] = n;
    } else {
      runs.push([n, n]);
    }
  }
  return runs;
}

function getMonthYearGroups(months: string[]): { year: string; label: string; count: number }[] {
  const sorted = [...months].sort();
  const byYear = new Map<string, number[]>();
  for (const ym of sorted) {
    const [year, month] = ym.split("-");
    byYear.set(year, [...(byYear.get(year) ?? []), Number(month)]);
  }
  return [...byYear.entries()].map(([year, monthNums]) => {
    const runs = groupConsecutive(monthNums);
    const runLabels = runs.map(([start, end]) =>
      start === end
        ? shortMonthName(year, start)
        : `${shortMonthName(year, start)} – ${shortMonthName(year, end)}`,
    );
    return { year, label: `${runLabels.join(", ")} ${year}`, count: monthNums.length };
  });
}

function formatMonthsSmart(months: string[]): string {
  if (months.length === 0) return "";
  return getMonthYearGroups(months)
    .map((g) => g.label)
    .join(", ");
}

function formatMonthsCompact(months: string[]): string {
  if (months.length === 0) return "";
  const groups = getMonthYearGroups(months);
  const [first, ...rest] = groups;
  const remaining = rest.reduce((sum, g) => sum + g.count, 0);
  return remaining > 0 ? `${first.label} (+${remaining} month${remaining > 1 ? "s" : ""})` : first.label;
}

function formatDuration(duration: TripDuration): string {
  const unit = duration.amount === 1 ? duration.unit.slice(0, -1) : duration.unit;
  return `~${duration.amount} ${unit}`;
}

function formatGender(gender: Gender): string {
  if (gender === "Woman") return "F";
  if (gender === "Man") return "M";
  return gender;
}

function getSingleDestinationLabel(destination: Destination): string {
  if (destination.mode === "focused") {
    return destination.cities.length > 0
      ? `${destination.country} — ${destination.cities.join(", ")}`
      : destination.country;
  }
  return destination.regions.join(" · ");
}

function getDestinationLabel(destinations: Destination[]): string {
  return destinations.map(getSingleDestinationLabel).join("  +  ");
}

export type SearchDestination =
  | { type: "country"; code: string; name: string }
  | { type: "city"; name: string; countryCode: string; countryName: string }
  | { type: "region"; name: Region }
  | { type: "place"; name: string; placeType: string };

function toGeoDestination(sel: SearchDestination): GeoDestination {
  if (sel.type === "country") return { mode: "focused", country: sel.name, countryCode: sel.code, cities: [] };
  if (sel.type === "city") {
    return { mode: "focused", country: sel.countryName, countryCode: sel.countryCode, cities: [sel.name] };
  }
  if (sel.type === "region") return { mode: "broad", regions: [sel.name] };
  return { mode: "place", name: sel.name };
}

function postMatchesDestinationSearch(destinations: Destination[], selected: SearchDestination[]): boolean {
  return isGeographicallyRelevant(selected.map(toGeoDestination), destinations);
}

function getDateLabel(date: TripDate, compact = false): string {
  if (date.mode === "focused") {
    return `${formatDateRange(date.startDate, date.endDate)} · ${daysBetween(date.startDate, date.endDate)} days`;
  }
  if (date.mode === "flexible") {
    const base = `Flexible: ${formatDateRange(date.earliest, date.latest)}`;
    return date.duration ? `${base} · ${formatDuration(date.duration)}` : base;
  }
  const months = compact ? formatMonthsCompact(date.months) : formatMonthsSmart(date.months);
  return date.duration ? `${months} · ${formatDuration(date.duration)}` : months;
}

function matchesDurationFilter(date: TripDate, unit: DurationUnit | "All"): boolean {
  if (unit === "All") return true;
  if (date.mode === "focused") return unit === "Days";
  return date.duration?.unit === unit;
}

type GeoTier = "country" | "local" | "region";
type GeoPoint = {
  name: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  tier: GeoTier;
  countryCode?: string;
};

function destinationQueries(
  destination: Destination,
): { name: string; query: string; tier: GeoTier; countryCode?: string }[] {
  if (destination.mode === "focused") {
    const countryEntry = {
      name: destination.country,
      query: destination.country,
      tier: "country" as const,
      countryCode: destination.countryCode,
    };
    if (destination.cities.length === 0) return [countryEntry];
    const cityEntries = destination.cities.map((city) => ({
      name: city,
      query: `${city}, ${destination.country}`,
      tier: "local" as const,
      countryCode: destination.countryCode,
    }));
    return [countryEntry, ...cityEntries];
  }
  return destination.regions.map((region) => ({ name: region, query: region, tier: "region" as const }));
}

function staticFallbackPoint(destination: Destination, name: string, tier: GeoTier): GeoPoint {
  if (destination.mode === "focused") {
    const country = getCountryByCode(destination.countryCode);
    return country
      ? { name, lat: country.lat, lng: country.lng, tier, countryCode: destination.countryCode }
      : { name, lat: 0, lng: 0, tier, countryCode: destination.countryCode };
  }
  const region = REGION_CENTROIDS[name as Region] ?? REGION_CENTROIDS.Europe;
  return { name, lat: region.lat, lng: region.lng, tier };
}

async function getDestinationPoints(destinations: Destination[]): Promise<GeoPoint[]> {
  const perDestination = await Promise.all(
    destinations.map(async (destination) => {
      const queries = destinationQueries(destination);
      return Promise.all(
        queries.map(async ({ name, query, tier, countryCode }) => {
          // Broad regions are this app's own taxonomy buckets (e.g. "East Asia/SE Asia"),
          // not real place names — geocoding them against a live places API just returns
          // whatever fuzzy-matches the text (which can land anywhere on the globe), so
          // always use the curated centroid instead.
          if (destination.mode === "broad") return staticFallbackPoint(destination, name, tier);
          const geocoded = await geocodePlace(query);
          if (geocoded) return { name, tier, countryCode, ...geocoded };
          return staticFallbackPoint(destination, name, tier);
        }),
      );
    }),
  );
  return perDestination.flat();
}

// A "specific" destination is a real, pinnable spot — a city picked under a focused
// country. Bare countries (no cities) and broad regions carry no pinpoint location, so
// they're excluded from the feed map entirely (see getFeedMapPost below).
type SpecificDestination = { name: string; query: string; countryCode: string; country: string };

function getSpecificDestinations(destinations: Destination[]): SpecificDestination[] {
  const out: SpecificDestination[] = [];
  for (const destination of destinations) {
    if (destination.mode !== "focused") continue;
    for (const city of destination.cities) {
      out.push({
        name: city,
        query: `${city}, ${destination.country}`,
        countryCode: destination.countryCode,
        country: destination.country,
      });
    }
  }
  return out;
}

// Resolves one specific destination to real coordinates, or null if nothing usable is
// available. Never falls back to (0, 0) — an unresolvable "null island" point would
// render as a pin adrift in the Gulf of Guinea, indistinguishable from a real bug.
async function resolveFeedMapPoint(dest: SpecificDestination): Promise<FeedMapPoint | null> {
  const geocoded = await geocodePlace(dest.query);
  if (geocoded) {
    return { name: dest.name, lat: geocoded.lat, lng: geocoded.lng, bbox: geocoded.bbox, countryCode: dest.countryCode };
  }
  const country = getCountryByCode(dest.countryCode);
  if (!country) return null;
  return { name: dest.name, lat: country.lat, lng: country.lng, countryCode: dest.countryCode };
}

async function getFeedMapPost(post: Post): Promise<FeedMapPost | null> {
  const specific = getSpecificDestinations(post.destinations);
  if (specific.length === 0) return null;

  const resolved = await Promise.all(specific.map(resolveFeedMapPoint));
  const points = resolved.filter((p): p is FeedMapPoint => p !== null);
  if (points.length === 0) return null;

  return {
    id: post.id,
    points,
    countryCodes: [...new Set(specific.map((d) => d.countryCode))],
    destinationLabel: getDestinationLabel(post.destinations),
    dateLabel: getDateLabel(post.date),
    userLabel: `${post.user.name} · ${post.user.age} · ${formatGender(post.user.gender)}`,
    whatsapp: post.whatsapp,
  };
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("");
}

// ---------- Form state ----------

type DestinationMode = "focused" | "broad";
type DateMode = "range" | "broad";

type DestinationEntry = {
  destinationMode: DestinationMode;
  country: string;
  countryCode: string;
  cities: string[];
  regions: Region[];
};

const EMPTY_DESTINATION_ENTRY: DestinationEntry = {
  destinationMode: "focused",
  country: "",
  countryCode: "",
  cities: [],
  regions: [],
};

type FormState = {
  destinations: DestinationEntry[];
  dateMode: DateMode;
  startDate: string;
  endDate: string;
  isFlexible: boolean;
  months: string[];
  duration: DurationValue;
  vibes: TripVibe[];
  bio: string;
};

const EMPTY_FORM: FormState = {
  destinations: [{ ...EMPTY_DESTINATION_ENTRY }],
  dateMode: "range",
  startDate: "",
  endDate: "",
  isFlexible: false,
  months: [],
  duration: { amount: "", unit: "Days" },
  vibes: [],
  bio: "",
};

function nextMonthOptions(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// ---------- Hero date search ----------

export type DateSearchMode = "specific" | "flexible";

export type DateSearchUI = {
  mode: DateSearchMode;
  startDate: string;
  endDate: string;
  months: string[];
  duration: DurationValue;
};

const EMPTY_DATE_SEARCH: DateSearchUI = {
  mode: "specific",
  startDate: "",
  endDate: "",
  months: [],
  duration: { amount: "", unit: "Days" },
};

function toSearchInput(search: DateSearchUI): DateSearchInput {
  if (search.mode === "specific") {
    return { mode: "specific", startDate: search.startDate, endDate: search.endDate };
  }
  const amount = Number(search.duration.amount);
  return {
    mode: "flexible",
    months: search.months,
    duration: amount > 0 ? { amount, unit: search.duration.unit } : undefined,
  };
}

function getDateSearchLabel(search: DateSearchUI | null): string {
  if (!search) return "Any dates";
  if (search.mode === "specific") {
    return search.startDate && search.endDate ? formatDateRange(search.startDate, search.endDate) : "Any dates";
  }
  return search.months.length > 0 ? formatMonthsCompact(search.months) : "Any dates";
}

// Wraps a state update in a View Transition so the shared-name "logo" element can morph
// between its big/centered (first-run) and small/top-left (post-search) positions instead
// of jump-cutting. Falls back to a plain update on browsers without the API.
function withViewTransition(fn: () => void) {
  if (typeof document !== "undefined" && "startViewTransition" in document) {
    document.startViewTransition(() => flushSync(fn));
  } else {
    fn();
  }
}

export default function HomePage() {
  const [view, setView] = useState<"feed" | "map">("feed");
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [selectedDestinations, setSelectedDestinations] = useState<SearchDestination[]>([]);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [vibeFilter, setVibeFilter] = useState<TripVibe | "All">("All");
  const [appliedDateSearch, setAppliedDateSearch] = useState<DateSearchUI | null>(null);
  const [dateSearchDraft, setDateSearchDraft] = useState<DateSearchUI>(EMPTY_DATE_SEARCH);
  const [genderFilter, setGenderFilter] = useState<Gender | "All">("All");
  const [durationUnitFilter, setDurationUnitFilter] = useState<DurationUnit | "All">("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewPostId, setViewPostId] = useState<string | null>(null);
  const [isTripMapOpen, setIsTripMapOpen] = useState(false);
  const [tripMapPoints, setTripMapPoints] = useState<GeoPoint[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [openHeroField, setOpenHeroField] = useState<"destination" | "dates" | "filters" | null>(null);
  // Whether the user has performed their first search yet — gates the full-screen,
  // centered destination/dates prompt (see below) that replaces the feed on first run,
  // so a first-time visitor sees an inviting, focused "what do I search for" moment
  // instead of a wall of posts with no context.
  const [hasSearched, setHasSearched] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const monthOptions = useMemo(() => nextMonthOptions(12), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (heroRef.current && !heroRef.current.contains(e.target as Node)) {
        setOpenHeroField(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleSavedPost(postId: string) {
    setSavedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }

  // Cross-border spatial matching (e.g. search "Alps" vs a post in "France") needs bbox
  // data isGeographicallyRelevant() can't fetch itself (it's pure/sync). Warm the geocode
  // cache for the active "place" search terms plus every country appearing in posts, in
  // the background — once populated, bumping geoWarmTick lets bbox-based matches surface
  // without ever blocking the filter computation on a network round-trip.
  const [geoWarmTick, setGeoWarmTick] = useState(0);

  useEffect(() => {
    const placeNames = selectedDestinations.filter((d) => d.type === "place").map((d) => d.name);
    if (placeNames.length === 0) return;
    const countryNames = [
      ...new Set(
        posts
          .flatMap((p) => p.destinations)
          .filter((d): d is FocusedDestination => d.mode === "focused")
          .map((d) => d.country),
      ),
    ];
    let cancelled = false;
    Promise.all([...placeNames, ...countryNames].map((name) => warmGeocode(name))).then(() => {
      if (!cancelled) setGeoWarmTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDestinations, posts]);

  const filteredPosts = useMemo(() => {
    const base = posts.filter((post) => {
      const matchesRegion = postMatchesDestinationSearch(post.destinations, selectedDestinations);
      const matchesVibe = vibeFilter === "All" || post.vibes.includes(vibeFilter);
      const matchesGender = genderFilter === "All" || post.user.gender === genderFilter;
      const matchesDuration = matchesDurationFilter(post.date, durationUnitFilter);
      const matchesSaved = !showSavedOnly || savedPostIds.has(post.id);
      return matchesRegion && matchesVibe && matchesGender && matchesDuration && matchesSaved;
    });

    if (!appliedDateSearch) return base;
    const searchInput = toSearchInput(appliedDateSearch);
    if (!hasActiveDateSearch(searchInput)) return base;
    return rankByRelevance(base, searchInput, (post) => post.date);
    // geoWarmTick isn't read directly — it forces a recompute once warmGeocode() has
    // populated the bbox cache that postMatchesDestinationSearch reads synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    posts,
    selectedDestinations,
    vibeFilter,
    genderFilter,
    durationUnitFilter,
    showSavedOnly,
    savedPostIds,
    appliedDateSearch,
    geoWarmTick,
  ]);

  const viewPost = posts.find((p) => p.id === viewPostId) ?? null;

  useEffect(() => {
    if (!viewPost || !isTripMapOpen) return;
    let cancelled = false;
    getDestinationPoints(viewPost.destinations).then((points) => {
      if (!cancelled) setTripMapPoints(points);
    });
    return () => {
      cancelled = true;
    };
  }, [viewPost, isTripMapOpen]);

  function destinationKey(d: SearchDestination): string {
    if (d.type === "country") return `country:${d.code}`;
    if (d.type === "city") return `city:${d.countryCode}:${d.name}`;
    if (d.type === "region") return `region:${d.name}`;
    return `place:${d.placeType}:${d.name}`;
  }

  function toggleSelectedDestination(dest: SearchDestination) {
    setSelectedDestinations((prev) =>
      prev.some((d) => destinationKey(d) === destinationKey(dest))
        ? prev.filter((d) => destinationKey(d) !== destinationKey(dest))
        : [...prev, dest],
    );
  }

  const allPostCities = useMemo(() => {
    const map = new Map<string, SearchDestination>();
    for (const post of posts) {
      for (const d of post.destinations) {
        if (d.mode === "focused") {
          for (const city of d.cities) {
            const key = `city:${d.countryCode}:${city}`;
            if (!map.has(key)) {
              map.set(key, { type: "city", name: city, countryCode: d.countryCode, countryName: d.country });
            }
          }
        }
      }
    }
    return [...map.values()];
  }, [posts]);

  const [placeSuggestions, setPlaceSuggestions] = useState<SearchDestination[]>([]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      geocodeSuggestions(query).then((results) => {
        if (cancelled) return;
        setPlaceSuggestions(
          results.map((r) => ({ type: "place" as const, name: r.name, placeType: r.placeType })),
        );
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destinationQuery]);

  const destinationResults = useMemo(() => {
    const q = destinationQuery.trim().toLowerCase();
    const countries: SearchDestination[] = getAllCountries()
      .filter((c) => q === "" || c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ type: "country" as const, code: c.isoCode, name: c.name }));
    const regions: SearchDestination[] = REGIONS.filter(
      (r) => q === "" || r.toLowerCase().includes(q),
    ).map((r) => ({ type: "region" as const, name: r }));
    const cities = allPostCities.filter((c) => q === "" || c.name.toLowerCase().includes(q)).slice(0, 8);
    // Drop Mapbox suggestions that duplicate a country/city/region already surfaced locally.
    const knownNames = new Set(
      [...countries, ...regions, ...cities].map((d) => d.name.toLowerCase()),
    );
    const places = q.length < 2 ? [] : placeSuggestions.filter((p) => !knownNames.has(p.name.toLowerCase()));
    return { countries, regions, cities, places };
  }, [destinationQuery, allPostCities, placeSuggestions]);

  const countryOptions = useMemo(
    () => getAllCountries().map((c) => ({ value: c.isoCode, label: `${c.flag} ${c.name}` })),
    [],
  );

  function citiesOptionsFor(entry: DestinationEntry) {
    const citiesOfCountry = getCitiesOfCountry(entry.countryCode);
    return {
      quickCities: citiesOfCountry.slice(0, 5),
      cityOptions: citiesOfCountry
        .filter((c) => !entry.cities.includes(c.name))
        .map((c) => ({ value: c.name, label: c.name })),
    };
  }

  const [mapMarkers, setMapMarkers] = useState<FeedMapPost[]>([]);
  const [focusedMapPostId, setFocusedMapPostId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(filteredPosts.map((post) => getFeedMapPost(post))).then((results) => {
      if (!cancelled) setMapMarkers(results.filter((r): r is FeedMapPost => r !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [filteredPosts]);

  // Derived rather than synced via effect: once a post drops out of mapMarkers (filtered
  // out or no longer has a specific destination), its pin — and thus its focus — is gone.
  const activeFocusedMapPostId =
    focusedMapPostId && mapMarkers.some((m) => m.id === focusedMapPostId) ? focusedMapPostId : null;
  const focusedMapPost = activeFocusedMapPostId ? posts.find((p) => p.id === activeFocusedMapPostId) ?? null : null;

  function toggleFormVibe(vibe: TripVibe) {
    setForm((prev) => ({
      ...prev,
      vibes: prev.vibes.includes(vibe) ? prev.vibes.filter((v) => v !== vibe) : [...prev.vibes, vibe],
    }));
  }

  function updateDestinationEntry(index: number, updater: (entry: DestinationEntry) => DestinationEntry) {
    setForm((prev) => ({
      ...prev,
      destinations: prev.destinations.map((entry, i) => (i === index ? updater(entry) : entry)),
    }));
  }

  function setEntryMode(index: number, mode: DestinationMode) {
    updateDestinationEntry(index, (entry) => ({ ...entry, destinationMode: mode }));
  }

  function setEntryCountry(index: number, isoCode: string) {
    const country = getCountryByCode(isoCode);
    if (!country) return;
    updateDestinationEntry(index, (entry) => ({
      ...entry,
      country: country.name,
      countryCode: country.isoCode,
      cities: [],
    }));
  }

  function toggleEntryRegion(index: number, region: Region) {
    updateDestinationEntry(index, (entry) => ({
      ...entry,
      regions: entry.regions.includes(region) ? entry.regions.filter((r) => r !== region) : [...entry.regions, region],
    }));
  }

  function toggleEntryCity(index: number, city: string) {
    updateDestinationEntry(index, (entry) => ({
      ...entry,
      cities: entry.cities.includes(city) ? entry.cities.filter((c) => c !== city) : [...entry.cities, city],
    }));
  }

  function addEntryCity(index: number, city: string) {
    updateDestinationEntry(index, (entry) =>
      entry.cities.includes(city) ? entry : { ...entry, cities: [...entry.cities, city] },
    );
  }

  function addDestinationEntry() {
    setForm((prev) => ({ ...prev, destinations: [...prev.destinations, { ...EMPTY_DESTINATION_ENTRY }] }));
  }

  function removeDestinationEntry(index: number) {
    setForm((prev) => ({ ...prev, destinations: prev.destinations.filter((_, i) => i !== index) }));
  }

  function toggleFormMonth(month: string) {
    setForm((prev) => ({
      ...prev,
      months: prev.months.includes(month) ? prev.months.filter((m) => m !== month) : [...prev.months, month],
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  // True once the destination step has at least one entry, but none of them pin down a
  // real spot (a city under a focused country) — matches getSpecificDestinations, so
  // this post would end up invisible on the feed map.
  const formHasNoSpecificDestination =
    form.destinations.length > 0 &&
    form.destinations.every((entry) => entry.destinationMode === "broad" || entry.cities.length === 0);

  function isFormValid(): boolean {
    const destinationValid =
      form.destinations.length > 0 &&
      form.destinations.every((entry) =>
        entry.destinationMode === "focused" ? Boolean(entry.country) : entry.regions.length > 0,
      );
    const dateValid =
      form.dateMode === "range"
        ? Boolean(form.startDate && form.endDate) &&
          (!form.isFlexible || isDurationWithinRange(form.duration, form.startDate, form.endDate))
        : form.months.length > 0;
    return destinationValid && dateValid;
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!isFormValid()) return;

    const destinations: Destination[] = form.destinations.map((entry) =>
      entry.destinationMode === "focused"
        ? { mode: "focused", country: entry.country, countryCode: entry.countryCode, cities: entry.cities }
        : { mode: "broad", regions: entry.regions },
    );

    const duration: TripDuration | undefined =
      form.duration.amount && Number(form.duration.amount) > 0
        ? { amount: Number(form.duration.amount), unit: form.duration.unit }
        : undefined;

    const date: TripDate =
      form.dateMode === "range"
        ? form.isFlexible
          ? { mode: "flexible", earliest: form.startDate, latest: form.endDate, duration }
          : { mode: "focused", startDate: form.startDate, endDate: form.endDate }
        : { mode: "broad", months: form.months, duration };

    const newPost: Post = {
      id: crypto.randomUUID(),
      user: CURRENT_USER,
      destinations,
      date,
      vibes: form.vibes,
      bio: form.bio,
      whatsapp: "https://wa.me/10000000000",
    };

    setPosts((prev) => [newPost, ...prev]);
    resetForm();
    setIsModalOpen(false);
  }

  // Destination/dates trigger buttons + their dropdown panels are shared between the
  // compact sticky-header search bar (shown once the user has searched) and the large,
  // centered first-run prompt (shown before that) — same behavior, different sizing, so
  // the two surfaces can't drift apart. Plain functions (not components) so calling them
  // inline doesn't remount the DOM/reset focus on every render.
  function renderDestinationTrigger(size: "sm" | "lg") {
    return (
      <button
        type="button"
        onClick={() => setOpenHeroField(openHeroField === "destination" ? null : "destination")}
        className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left transition ${
          size === "lg"
            ? "border-b border-slate-100 px-4 py-4 sm:border-b-0 sm:border-r"
            : "border-r border-slate-100 px-3 py-2.5"
        } ${openHeroField === "destination" ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
      >
        <span
          className={`flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-400 ${size === "lg" ? "text-xs" : "text-[10px]"}`}
        >
          <IconMapPin className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} />
          Destination
        </span>
        <span className={`w-full truncate font-semibold text-slate-900 ${size === "lg" ? "text-base" : "text-sm"}`}>
          {selectedDestinations.length === 0 ? "Anywhere" : selectedDestinations.map((d) => d.name).join(" + ")}
        </span>
      </button>
    );
  }

  function renderDatesTrigger(size: "sm" | "lg") {
    return (
      <button
        type="button"
        onClick={() => {
          if (openHeroField !== "dates") setDateSearchDraft(appliedDateSearch ?? EMPTY_DATE_SEARCH);
          setOpenHeroField(openHeroField === "dates" ? null : "dates");
        }}
        className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left transition ${
          size === "lg" ? "px-4 py-4" : "px-3 py-2.5"
        } ${openHeroField === "dates" ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
      >
        <span
          className={`flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-400 ${size === "lg" ? "text-xs" : "text-[10px]"}`}
        >
          <IconCalendar className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} />
          Dates
        </span>
        <span className={`w-full truncate font-semibold text-slate-900 ${size === "lg" ? "text-base" : "text-sm"}`}>
          {getDateSearchLabel(appliedDateSearch)}
        </span>
      </button>
    );
  }

  function renderDestinationPanel() {
    if (openHeroField !== "destination") return null;
    return (
      <div className="absolute inset-x-4 z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
        {selectedDestinations.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedDestinations.map((d) => (
              <span
                key={destinationKey(d)}
                className="flex items-center gap-1 rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
              >
                {d.name}
                <button
                  type="button"
                  onClick={() => toggleSelectedDestination(d)}
                  aria-label={`Remove ${d.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-orange-600"
                >
                  <IconX className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          type="text"
          autoFocus
          value={destinationQuery}
          onChange={(e) => setDestinationQuery(e.target.value)}
          placeholder="Search continents, regions, countries, cities…"
          className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />

        {destinationResults.countries.length === 0 &&
          destinationResults.regions.length === 0 &&
          destinationResults.cities.length === 0 &&
          destinationResults.places.length === 0 && (
            <p className="px-2 py-2 text-xs text-slate-400">No matches found</p>
          )}

        {(
          [
            { key: "countries", label: "Countries", items: destinationResults.countries },
            { key: "regions", label: "Continents / Regions", items: destinationResults.regions },
            { key: "cities", label: "Cities / Specific Destinations", items: destinationResults.cities },
            { key: "places", label: "Natural Features & Places", items: destinationResults.places },
          ] as const
        ).map(
          ({ key, label, items }) =>
            items.length > 0 && (
              <div key={key}>
                <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {label}
                </p>
                {items.map((d) => (
                  <button
                    key={destinationKey(d)}
                    type="button"
                    onClick={() => toggleSelectedDestination(d)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                      selectedDestinations.some((s) => destinationKey(s) === destinationKey(d))
                        ? "bg-orange-50 font-semibold text-orange-600"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {d.name}
                    {d.type === "city" ? `, ${d.countryName}` : ""}
                  </button>
                ))}
              </div>
            ),
        )}

        <button
          type="button"
          onClick={() => {
            setHasSearched(true);
            setOpenHeroField(null);
          }}
          className="mt-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    );
  }

  function renderDatesPanel() {
    if (openHeroField !== "dates") return null;
    return (
      <div className="absolute inset-x-4 z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="flex gap-1 border-b border-slate-100 p-1.5">
          <button
            type="button"
            onClick={() => setDateSearchDraft((d) => ({ ...d, mode: "specific" }))}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              dateSearchDraft.mode === "specific" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            Specific Dates
          </button>
          <button
            type="button"
            onClick={() => setDateSearchDraft((d) => ({ ...d, mode: "flexible" }))}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              dateSearchDraft.mode === "flexible" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            Flexible Dates
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-3">
          {dateSearchDraft.mode === "specific" ? (
            <CalendarRangePicker
              startDate={dateSearchDraft.startDate}
              endDate={dateSearchDraft.endDate}
              onChange={(range) => {
                const next = { ...dateSearchDraft, ...range };
                setDateSearchDraft(next);
                if (range.startDate && range.endDate) {
                  setAppliedDateSearch(next);
                  setHasSearched(true);
                  setOpenHeroField(null);
                }
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {monthOptions.map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() =>
                      setDateSearchDraft((d) => ({
                        ...d,
                        months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month],
                      }))
                    }
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                      dateSearchDraft.months.includes(month)
                        ? "bg-orange-500 text-white ring-orange-500"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {formatMonth(month)}
                  </button>
                ))}
              </div>
              <DurationInput
                value={dateSearchDraft.duration}
                onChange={(duration) => setDateSearchDraft((d) => ({ ...d, duration }))}
                label="Optional: trip duration"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => {
              setDateSearchDraft(EMPTY_DATE_SEARCH);
              setAppliedDateSearch(null);
              setHasSearched(true);
              setOpenHeroField(null);
            }}
            className="flex-1 rounded-xl bg-slate-100 py-2 text-xs font-semibold text-slate-700 transition active:bg-slate-200"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const hasContent =
                dateSearchDraft.mode === "specific"
                  ? Boolean(dateSearchDraft.startDate && dateSearchDraft.endDate)
                  : dateSearchDraft.months.length > 0;
              setAppliedDateSearch(hasContent ? dateSearchDraft : null);
              setHasSearched(true);
              setOpenHeroField(null);
            }}
            className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-semibold text-white transition active:scale-[0.98] active:bg-orange-600"
          >
            Apply
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {/* Top Navigation Bar — only shown once the user has searched; first-run keeps just
          the big centered wordmark rendered in the hero block below (see !hasSearched). */}
      {hasSearched && (
        <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={() => withViewTransition(() => setHasSearched(false))}
              aria-label="Back to search"
              style={{ viewTransitionName: "logo" }}
              className="text-xl font-extrabold tracking-tight text-slate-900 transition active:scale-95"
            >
              trip<span className="text-orange-500">hop</span>
            </button>
            <div className="flex items-center gap-2">
              <div className="flex items-stretch gap-0.5 rounded-full bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setView("feed")}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    view === "feed" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconGrid className="h-3.5 w-3.5" />
                  Feed
                </button>
                <button
                  type="button"
                  onClick={() => setView("map")}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    view === "map" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconMap className="h-3.5 w-3.5" />
                  Map
                </button>
              </div>
              <button
                type="button"
                aria-label="Language and region"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
              >
                <IconGlobe className="h-4.5 w-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSavedOnly((v) => !v)}
                aria-label={showSavedOnly ? "Show all posts" : "Show saved posts"}
                aria-pressed={showSavedOnly}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95 ${
                  showSavedOnly ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600 active:bg-slate-200"
                }`}
              >
                <IconHeart className="h-4.5 w-4.5" filled={showSavedOnly} />
              </button>
              <button
                type="button"
                aria-label="Profile"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
              >
                <IconUser className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>

          {/* Hero Search */}
          <div ref={heroRef} className="relative mx-auto max-w-lg px-4 pb-3">
            <div className="flex items-stretch gap-2">
              <div className="flex flex-1 items-stretch overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                {renderDestinationTrigger("sm")}
                {renderDatesTrigger("sm")}
              </div>
              <button
                type="button"
                onClick={() => setOpenHeroField(openHeroField === "filters" ? null : "filters")}
                aria-label="More filters"
                className={`flex shrink-0 items-center justify-center rounded-2xl border px-3 transition ${
                  openHeroField === "filters"
                    ? "border-orange-300 bg-orange-50 text-orange-600"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                <IconSliders className="h-4 w-4" />
              </button>
            </div>

            {renderDestinationPanel()}
            {renderDatesPanel()}

            {openHeroField === "filters" && (
              <div className="absolute right-4 z-50 mt-2 flex w-56 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">More filters</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Gender</label>
                  <select
                    value={genderFilter}
                    onChange={(e) => setGenderFilter(e.target.value as Gender | "All")}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="All">Any</option>
                    {GENDERS.map((gender) => (
                      <option key={gender} value={gender}>
                        {gender}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Trip duration</label>
                  <select
                    value={durationUnitFilter}
                    onChange={(e) => setDurationUnitFilter(e.target.value as DurationUnit | "All")}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="All">Any</option>
                    {DURATION_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Secondary filters */}
          <div className="mx-auto max-w-lg px-4 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setVibeFilter("All")}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                  vibeFilter === "All"
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                All styles
              </button>
              {TRIP_STYLES.map((vibe) => (
                <button
                  key={vibe}
                  type="button"
                  onClick={() => setVibeFilter(vibe)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                    vibeFilter === vibe
                      ? "bg-slate-900 text-white ring-slate-900"
                      : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {vibe}
                </button>
              ))}
            </div>
          </div>
        </header>
      )}

      {/* Main content */}
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">
        {!hasSearched ? (
          <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
            <h1
              style={{ viewTransitionName: "logo" }}
              className="text-5xl font-extrabold tracking-tight text-slate-900"
            >
              trip<span className="text-orange-500">hop</span>
            </h1>

            <div>
              <h2 className="text-xl font-bold text-slate-900">Where&apos;s your next trip?</h2>
              <p className="mt-1.5 text-sm text-slate-500">Find travelers heading your way.</p>
            </div>

            <div ref={heroRef} className="relative w-full max-w-sm">
              <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
                {renderDestinationTrigger("lg")}
                {renderDatesTrigger("lg")}
              </div>

              {openHeroField === "destination" && (
                <DestinationPickerOverlay
                  query={destinationQuery}
                  onQueryChange={setDestinationQuery}
                  results={destinationResults}
                  destinationKey={destinationKey}
                  onSelect={(dest) =>
                    withViewTransition(() => {
                      setSelectedDestinations([dest]);
                      setHasSearched(true);
                      setOpenHeroField(null);
                    })
                  }
                  onClose={() => setOpenHeroField(null)}
                />
              )}

              {openHeroField === "dates" && (
                <DatePickerOverlay
                  draft={dateSearchDraft}
                  onDraftChange={setDateSearchDraft}
                  monthOptions={monthOptions}
                  formatMonth={formatMonth}
                  onAutoApply={(next) =>
                    withViewTransition(() => {
                      setAppliedDateSearch(next);
                      setHasSearched(true);
                      setOpenHeroField(null);
                    })
                  }
                  onApply={() =>
                    withViewTransition(() => {
                      const hasContent =
                        dateSearchDraft.mode === "specific"
                          ? Boolean(dateSearchDraft.startDate && dateSearchDraft.endDate)
                          : dateSearchDraft.months.length > 0;
                      setAppliedDateSearch(hasContent ? dateSearchDraft : null);
                      setHasSearched(true);
                      setOpenHeroField(null);
                    })
                  }
                  onClear={() =>
                    withViewTransition(() => {
                      setDateSearchDraft(EMPTY_DATE_SEARCH);
                      setAppliedDateSearch(null);
                      setHasSearched(true);
                      setOpenHeroField(null);
                    })
                  }
                  onClose={() => setOpenHeroField(null)}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => withViewTransition(() => setHasSearched(true))}
              className="w-full max-w-sm rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-orange-600"
            >
              Search trips
            </button>
          </div>
        ) : view === "feed" ? (
          <div className="flex flex-col gap-4">
            {filteredPosts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
                No trips match your filters yet.
              </div>
            )}

            {filteredPosts.map((post) => (
              <div
                key={post.id}
                role="button"
                tabIndex={0}
                onClick={() => setViewPostId(post.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setViewPostId(post.id);
                  }
                }}
                className="relative overflow-hidden rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md active:scale-[0.99]"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSavedPost(post.id);
                  }}
                  aria-label={savedPostIds.has(post.id) ? "Remove from saved" : "Save trip"}
                  className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                    savedPostIds.has(post.id)
                      ? "bg-rose-500 text-white"
                      : "bg-white/90 text-slate-400 ring-1 ring-slate-200 hover:text-rose-500"
                  }`}
                >
                  <IconHeart className="h-4 w-4" filled={savedPostIds.has(post.id)} />
                </button>

                {/* 1. Destination — primary header */}
                <div className="flex min-w-0 items-start gap-1.5 pr-9">
                  <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                  <h3 className="min-w-0 truncate text-lg font-bold leading-snug text-slate-900">
                    {getDestinationLabel(post.destinations)}
                  </h3>
                </div>

                {/* 2. Dates / timing — secondary header */}
                <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-[22px] text-sm font-medium text-slate-600">
                  <IconCalendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{getDateLabel(post.date, true)}</span>
                </div>

                {/* 3. User info */}
                <div className="mt-3 flex items-center gap-2.5">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${post.user.avatarColor}`}
                  >
                    {initials(post.user.name)}
                  </div>
                  <p className="truncate text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{post.user.name}</span>
                    {" · "}
                    {post.user.age}
                    {" · "}
                    {formatGender(post.user.gender)}
                  </p>
                </div>

                {/* 4. Style / vibe tags */}
                <div className="mt-3 flex flex-nowrap gap-1.5 overflow-hidden">
                  {post.vibes.map((vibe) => (
                    <span
                      key={vibe}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${VIBE_STYLES[vibe]}`}
                    >
                      {vibe}
                    </span>
                  ))}
                </div>

                {/* 5. Description */}
                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">{post.bio}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative h-[420px] overflow-hidden rounded-2xl border border-slate-200">
              <TripMap
                posts={mapMarkers}
                focusedPostId={activeFocusedMapPostId}
                onSelectPost={(id) => setFocusedMapPostId(id)}
              />

              {focusedMapPost && (
                <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewPostId(focusedMapPost.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setViewPostId(focusedMapPost.id);
                      }
                    }}
                    className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200 transition active:scale-[0.99]"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${focusedMapPost.user.avatarColor}`}
                    >
                      {initials(focusedMapPost.user.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {getDestinationLabel(focusedMapPost.destinations)}
                      </p>
                      <p className="truncate text-xs text-slate-500">{getDateLabel(focusedMapPost.date, true)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusedMapPostId(null);
                      }}
                      aria-label="Close preview"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="px-1 text-center text-xs text-slate-400">
              Tap a pin to preview that trip and message on WhatsApp.
            </p>
          </div>
        )}
      </main>

      {/* Floating Action Button — hidden until the user has searched, matching the header */}
      {hasSearched && (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          aria-label="Create new post"
          className="fixed bottom-6 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/30 transition active:scale-95 active:bg-orange-600"
        >
          <IconPlus className="h-6 w-6" />
        </button>
      )}

      {/* Create Post Modal (slide-over) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />

          <div className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />

            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Share your trip</h2>
                <p className="text-xs text-slate-500">
                  Posting as {CURRENT_USER.name} · {CURRENT_USER.age} · {formatGender(CURRENT_USER.gender)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* Destination(s) */}
              <div className="flex flex-col gap-4">
                <label className="-mb-2.5 block text-xs font-medium text-slate-500">Destination</label>
                {form.destinations.map((entry, index) => {
                  const { quickCities, cityOptions } = citiesOptionsFor(entry);
                  return (
                    <div key={index} className="rounded-2xl border border-slate-100 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Destination {index + 1}
                        </span>
                        {form.destinations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeDestinationEntry(index)}
                            aria-label={`Remove destination ${index + 1}`}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
                          >
                            <IconX className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      <div className="mb-2 flex gap-2">
                        {(["focused", "broad"] as DestinationMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setEntryMode(index, mode)}
                            className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ring-inset transition ${
                              entry.destinationMode === mode
                                ? "bg-slate-900 text-white ring-slate-900"
                                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                            }`}
                          >
                            {mode === "focused" ? "Focused (country)" : "Broad (regions)"}
                          </button>
                        ))}
                      </div>

                      {entry.destinationMode === "focused" ? (
                        <div className="flex flex-col gap-2">
                          <Combobox
                            options={countryOptions}
                            selectedLabel={
                              entry.country ? `${getCountryByCode(entry.countryCode)?.flag ?? ""} ${entry.country}` : ""
                            }
                            onSelect={(opt) => setEntryCountry(index, opt.value)}
                            placeholder="Search for a country…"
                            emptyMessage="No countries found"
                          />

                          {entry.countryCode && (
                            <>
                              <p className="mt-1 text-[11px] font-medium text-slate-400">
                                Popular cities in {entry.country}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {quickCities.length === 0 && (
                                  <span className="text-xs text-slate-400">
                                    No city data available for this country
                                  </span>
                                )}
                                {quickCities.map((city) => (
                                  <button
                                    key={city.name}
                                    type="button"
                                    onClick={() => toggleEntryCity(index, city.name)}
                                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                                      entry.cities.includes(city.name)
                                        ? "bg-orange-500 text-white ring-orange-500"
                                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                                    }`}
                                  >
                                    {city.name}
                                  </button>
                                ))}
                              </div>

                              <Combobox
                                options={cityOptions}
                                onSelect={(opt) => addEntryCity(index, opt.value)}
                                placeholder={`Search any city in ${entry.country}…`}
                                emptyMessage="No matching cities"
                              />

                              {entry.cities.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {entry.cities.map((city) => (
                                    <span
                                      key={city}
                                      className="flex items-center gap-1 rounded-full bg-orange-500 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
                                    >
                                      {city}
                                      <button
                                        type="button"
                                        onClick={() => toggleEntryCity(index, city)}
                                        aria-label={`Remove ${city}`}
                                        className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-orange-600"
                                      >
                                        <IconX className="h-2.5 w-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {REGIONS.map((region) => (
                            <button
                              key={region}
                              type="button"
                              onClick={() => toggleEntryRegion(index, region)}
                              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                                entry.regions.includes(region)
                                  ? "bg-orange-500 text-white ring-orange-500"
                                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                              }`}
                            >
                              {region}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addDestinationEntry}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-500 transition hover:border-orange-400 hover:text-orange-600"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  Add another destination
                </button>

                {formHasNoSpecificDestination && (
                  <div
                    dir="rtl"
                    className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                  >
                    <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span>העלאה ללא יעדים ממוקדים לא תופיע בפיד המפה</span>
                  </div>
                )}
              </div>

              {/* Dates */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">When</label>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {(["range", "broad"] as DateMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, dateMode: mode }))}
                      className={`rounded-xl px-2 py-2 text-[11px] font-semibold ring-1 ring-inset transition ${
                        form.dateMode === mode
                          ? "bg-slate-900 text-white ring-slate-900"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {mode === "range" ? "Date range" : "Months"}
                    </button>
                  ))}
                </div>

                {form.dateMode === "range" && (
                  <div className="flex flex-col gap-2">
                    <CalendarRangePicker
                      startDate={form.startDate}
                      endDate={form.endDate}
                      onChange={(range) => setForm((p) => ({ ...p, ...range }))}
                    />
                    {form.startDate && form.endDate && (
                      <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        {daysBetween(form.startDate, form.endDate)} days
                      </span>
                    )}

                    <label className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.isFlexible}
                        onChange={(e) => setForm((p) => ({ ...p, isFlexible: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400"
                      />
                      My dates are flexible within this range
                    </label>

                    {form.isFlexible && (
                      <>
                        <DurationInput
                          value={form.duration}
                          onChange={(duration) => setForm((p) => ({ ...p, duration }))}
                          label="Optional: trip duration"
                        />
                        {!isDurationWithinRange(form.duration, form.startDate, form.endDate) && (
                          <p className="text-[11px] font-medium text-rose-500">
                            Duration can&apos;t exceed the {daysBetween(form.startDate, form.endDate)}-day range you
                            selected.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {form.dateMode === "broad" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {monthOptions.map((month) => (
                        <button
                          key={month}
                          type="button"
                          onClick={() => toggleFormMonth(month)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                            form.months.includes(month)
                              ? "bg-orange-500 text-white ring-orange-500"
                              : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {formatMonth(month)}
                        </button>
                      ))}
                    </div>
                    <DurationInput
                      value={form.duration}
                      onChange={(duration) => setForm((p) => ({ ...p, duration }))}
                    />
                  </div>
                )}
              </div>

              {/* Vibe tags */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Trip style / vibe (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {TRIP_STYLES.map((vibe) => (
                    <button
                      key={vibe}
                      type="button"
                      onClick={() => toggleFormVibe(vibe)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                        form.vibes.includes(vibe)
                          ? "bg-slate-900 text-white ring-slate-900"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {vibe}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Bio / description</label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell potential travel partners about your plans, pace, and what you're looking for..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              <button
                type="submit"
                disabled={!isFormValid()}
                className="mt-1 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                Post trip
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Full-screen Post Detail View */}
      {viewPost && (
        <div className="fixed inset-0 z-[1200] flex justify-center bg-white sm:items-center sm:bg-slate-900/40 sm:p-4">
          <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl sm:shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur-md">
              <h2 className="text-sm font-bold text-slate-900">Trip details</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTripMapOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95"
                >
                  <IconMap className="h-3.5 w-3.5" />
                  Show Trip Map
                </button>
                <button
                  type="button"
                  onClick={() => toggleSavedPost(viewPost.id)}
                  aria-label={savedPostIds.has(viewPost.id) ? "Remove from saved" : "Save trip"}
                  aria-pressed={savedPostIds.has(viewPost.id)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                    savedPostIds.has(viewPost.id)
                      ? "bg-rose-500 text-white"
                      : "bg-slate-100 text-slate-500 hover:text-rose-500"
                  }`}
                >
                  <IconHeart className="h-4 w-4" filled={savedPostIds.has(viewPost.id)} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewPostId(null);
                    setIsTripMapOpen(false);
                  }}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 px-5 py-5">
              {/* Destination */}
              <div className="flex items-start gap-2">
                <IconMapPin className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
                <h1 className="text-2xl font-bold leading-snug text-slate-900">
                  {getDestinationLabel(viewPost.destinations)}
                </h1>
              </div>

              {/* Dates */}
              <div className="mt-2 flex items-center gap-1.5 pl-[26px] text-base font-medium text-slate-600">
                <IconCalendar className="h-4 w-4 shrink-0 text-slate-400" />
                {getDateLabel(viewPost.date)}
              </div>

              {/* User info */}
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${viewPost.user.avatarColor}`}
                >
                  {initials(viewPost.user.name)}
                </div>
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{viewPost.user.name}</span>
                  {" · "}
                  {viewPost.user.age}
                  {" · "}
                  {formatGender(viewPost.user.gender)}
                </p>
              </div>

              {/* Vibe tags */}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {viewPost.vibes.map((vibe) => (
                  <span
                    key={vibe}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${VIBE_STYLES[vibe]}`}
                  >
                    {vibe}
                  </span>
                ))}
              </div>

              {/* Description */}
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">{viewPost.bio}</p>
            </div>

            <div className="sticky bottom-0 border-t border-slate-100 bg-white p-4">
              <a
                href={viewPost.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-emerald-600"
              >
                <IconWhatsApp className="h-4 w-4" />
                Message on WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Trip Map modal */}
      {viewPost && isTripMapOpen && (
        <div className="fixed inset-0 z-[1300] flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-900/40 sm:p-4">
          <div className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-white sm:h-[80dvh] sm:rounded-3xl sm:shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">
                {getDestinationLabel(viewPost.destinations)}
              </h2>
              <button
                type="button"
                onClick={() => setIsTripMapOpen(false)}
                aria-label="Close map"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:bg-slate-200"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex-1">
              <TripDestinationsMap points={tripMapPoints} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
