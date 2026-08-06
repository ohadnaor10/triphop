"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import {
  IconCalendar,
  IconChevronLeft,
  IconEdit,
  IconGlobe,
  IconGrid,
  IconHeart,
  IconLogOut,
  IconMap,
  IconMapPin,
  IconPlus,
  IconSearch,
  IconSliders,
  IconTrash,
  IconUser,
  IconWhatsApp,
  IconX,
} from "./components/icons";
import type { FeedMapPoint, FeedMapPost } from "./components/TripMap";
import Avatar from "./components/Avatar";
import Combobox from "./components/Combobox";
import CalendarRangePicker from "./components/CalendarRangePicker";
import DestinationPickerOverlay from "./components/DestinationPickerOverlay";
import PostDestinationCarousel from "./components/PostDestinationCarousel";
import DatePickerOverlay from "./components/DatePickerOverlay";
import DateSearchFields from "./components/DateSearchFields";
import MonthCarousel from "./components/MonthCarousel";
import { getPopularDestinations } from "./data/popularDestinations";
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
import { hasActiveDateSearch, rankByRelevance, type DateSearchInput } from "./lib/relevance";
import { useAuth } from "./context/AuthContext";
import { usePostsStore } from "./lib/postsStore";

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

export type Gender = "Male" | "Female";

export type UserProfile = {
  name: string;
  age: number;
  gender: Gender;
  avatarColor: string;
  /** Absent for older mock seed data that predates profile photos. */
  avatarUrl?: string | null;
  /** Optional "about me" bio — distinct from a post's own trip-specific bio. */
  about?: string;
};

export type FocusedDestination = { mode: "focused"; country: string; countryCode: string; cities: string[] };
export type BroadDestination = { mode: "broad"; regions: Region[] };
export type Destination = FocusedDestination | BroadDestination;

export type FocusedDateInfo = { mode: "focused"; startDate: string; endDate: string };
export type BroadDateInfo = { mode: "broad"; months: string[] };
export type FlexibleDateInfo = { mode: "flexible"; earliest: string; latest: string };
export type TripDate = FocusedDateInfo | BroadDateInfo | FlexibleDateInfo;

export type Post = {
  id: string;
  userId: string;
  user: UserProfile;
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  whatsapp: string;
  /** ISO timestamp of when the post was created. Optional since older mock seed data predates this field. */
  createdAt?: string;
};

// ---------- Static reference data ----------

const TRIP_STYLES: TripVibe[] = ["Backpacking", "Road Trip", "Luxury", "Chill", "Adventure", "Culture"];
const GENDERS: Gender[] = ["Male", "Female"];

const VIBE_STYLES: Record<TripVibe, string> = {
  Backpacking: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  "Road Trip": "bg-amber-50 text-amber-700 ring-amber-600/20",
  Luxury: "bg-violet-50 text-violet-700 ring-violet-600/20",
  Chill: "bg-sky-50 text-sky-700 ring-sky-600/20",
  Adventure: "bg-rose-50 text-rose-700 ring-rose-600/20",
  Culture: "bg-orange-50 text-orange-700 ring-orange-600/20",
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

// "Posted X ago" — shown only in the full post-detail view, not on preview cards.
function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function shortMonthName(year: string, month: number) {
  return new Date(Number(year), month - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
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

function formatGender(gender: Gender): string {
  return gender === "Male" ? "M" : "F";
}

// Caps how much of a single destination's city list gets spelled out before folding
// the rest into a "+N" count — a country with a dozen cities picked would otherwise
// turn every label showing it into a wall of text.
const MAX_CITIES_PER_DESTINATION = 3;

function getSingleDestinationLabel(destination: Destination): string {
  if (destination.mode === "focused") {
    if (destination.cities.length === 0) return destination.country;
    const shown = destination.cities.slice(0, MAX_CITIES_PER_DESTINATION);
    const extra = destination.cities.length - shown.length;
    const cities = extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
    return `${destination.country} — ${cities}`;
  }
  return destination.regions.join(" · ");
}

// Single-line summary for compact contexts (feed cards, map popups) — caps the number
// of destinations spelled out the same way getSingleDestinationLabel caps cities, so a
// post with many countries/regions still reads as one short line.
const MAX_DESTINATIONS_COMPACT = 2;

function getDestinationLabel(destinations: Destination[]): string {
  const shown = destinations.slice(0, MAX_DESTINATIONS_COMPACT);
  const extra = destinations.length - shown.length;
  const label = shown.map(getSingleDestinationLabel).join("  +  ");
  return extra > 0 ? `${label}  +${extra} more` : label;
}

// Chip list for the full post-detail view — more room than a single line, so more
// destinations are spelled out before folding into a "+N more" chip.
const MAX_DESTINATION_CHIPS = 6;

function getDestinationChips(destinations: Destination[]): { chips: string[]; moreCount: number } {
  const shown = destinations.slice(0, MAX_DESTINATION_CHIPS);
  return { chips: shown.map(getSingleDestinationLabel), moreCount: destinations.length - shown.length };
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
    return `Flexible: ${formatDateRange(date.earliest, date.latest)}`;
  }
  return compact ? formatMonthsCompact(date.months) : formatMonthsSmart(date.months);
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

type DestinationEntry =
  | { kind: "country"; country: string; countryCode: string; cities: string[] }
  | { kind: "region"; region: Region };

// Bounded month range (not infinite) spanning `yearsBack`..`yearsForward` years around
// today, used by the month carousel everywhere it appears.
function monthRangeOptions(yearsBack: number, yearsForward: number): string[] {
  const now = new Date();
  const start = -yearsBack * 12;
  const end = yearsForward * 12;
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + start + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- Date search (shared shape for both the hero search and the post-creation
// wizard's dates step, so the two stay in lockstep — see DateSearchFields) ----------

export type DateSearchMode = "specific" | "flexible";

export type DateSearchUI = {
  mode: DateSearchMode;
  startDate: string;
  endDate: string;
  months: string[];
};

const EMPTY_DATE_SEARCH: DateSearchUI = {
  mode: "specific",
  startDate: "",
  endDate: "",
  months: [],
};

function toSearchInput(search: DateSearchUI): DateSearchInput {
  if (search.mode === "specific") {
    return { mode: "specific", startDate: search.startDate, endDate: search.endDate };
  }
  return { mode: "flexible", months: search.months };
}

type FormState = {
  destinations: DestinationEntry[];
  dates: DateSearchUI;
  vibes: TripVibe[];
  bio: string;
};

const EMPTY_FORM: FormState = {
  destinations: [],
  dates: EMPTY_DATE_SEARCH,
  vibes: [],
  bio: "",
};

function getDateSearchLabel(search: DateSearchUI | null): string {
  if (!search) return "Any dates";
  if (search.mode === "specific") {
    return search.startDate && search.endDate ? formatDateRange(search.startDate, search.endDate) : "Any dates";
  }
  return search.months.length > 0 ? formatMonthsCompact(search.months) : "Any dates";
}

// Compact 1-2 line summary of what's been picked so far — shown pinned at the top of
// later wizard steps once the destination/dates step is behind the user, so it stays
// visible without competing for attention with the step actually in focus.
function getDestinationEntriesSummary(entries: DestinationEntry[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((e) => (e.kind === "country" ? (e.cities.length > 0 ? `${e.country} — ${e.cities.join(", ")}` : e.country) : e.region))
    .join("  +  ");
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

// useSearchParams() (used below to open a post via /?post=<id>, see the profile page's
// "My posts" links) requires a Suspense boundary around anything that reads it.
export default function HomePage() {
  return (
    <Suspense>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const { currentUser, logout, requireAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { posts, savedPostIds, addPost, editPost, removePost, toggleSaved, revealContact } = usePostsStore();
  const [revealedContact, setRevealedContact] = useState<string | null>(null);
  const [view, setView] = useState<"feed" | "map">("feed");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDestinations, setSelectedDestinations] = useState<SearchDestination[]>([]);
  const [destinationPickerCloseOnSelect, setDestinationPickerCloseOnSelect] = useState(true);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [vibeFilter, setVibeFilter] = useState<TripVibe | "All">("All");
  const [appliedDateSearch, setAppliedDateSearch] = useState<DateSearchUI | null>(null);
  const [dateSearchDraft, setDateSearchDraft] = useState<DateSearchUI>(EMPTY_DATE_SEARCH);
  const [genderFilter, setGenderFilter] = useState<Gender | "All">("All");
  const [ageMinFilter, setAgeMinFilter] = useState("");
  const [ageMaxFilter, setAgeMaxFilter] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [postStep, setPostStep] = useState<0 | 1 | 2>(0);
  const [postDestQuery, setPostDestQuery] = useState("");
  const [viewPostId, setViewPostId] = useState<string | null>(null);
  const [isTripMapOpen, setIsTripMapOpen] = useState(false);
  const [tripMapPoints, setTripMapPoints] = useState<GeoPoint[]>([]);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [openHeroField, setOpenHeroField] = useState<"destination" | "dates" | "filters" | null>(null);
  // Whether the user has performed their first search yet — gates the full-screen,
  // centered destination/dates prompt (see below) that replaces the feed on first run,
  // so a first-time visitor sees an inviting, focused "what do I search for" moment
  // instead of a wall of posts with no context.
  const [hasSearched, setHasSearched] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [postError, setPostError] = useState<string | null>(null);
  const [isSavingPost, setIsSavingPost] = useState(false);

  const monthOptions = useMemo(() => monthRangeOptions(2, 2), []);

  // Opens straight to a post's detail view when arriving via /?post=<id> — used by the
  // "My posts" list on the profile page, which has no post-detail UI of its own. Applied
  // synchronously during render (not an effect) per the same pattern used elsewhere in
  // this file for syncing external state — see revealedForPostId below.
  const postParam = searchParams.get("post");
  const [handledPostParam, setHandledPostParam] = useState<string | null>(null);
  if (postParam && postParam !== handledPostParam) {
    setHandledPostParam(postParam);
    setHasSearched(true);
    setViewPostId(postParam);
  }

  useEffect(() => {
    if (handledPostParam) router.replace("/");
  }, [handledPostParam, router]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (heroRef.current && !heroRef.current.contains(e.target as Node)) {
        setOpenHeroField(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleSavedPost(postId: string) {
    requireAuth(() => {
      toggleSaved(postId);
    });
  }

  function clearMoreFilters() {
    setVibeFilter("All");
    setGenderFilter("All");
    setAgeMinFilter("");
    setAgeMaxFilter("");
  }

  function deletePost(postId: string) {
    requireAuth(() => {
      removePost(postId);
      setViewPostId((id) => (id === postId ? null : id));
    });
  }

  function startEditPost(post: Post) {
    requireAuth(() => {
      setForm({
        destinations: post.destinations.flatMap((d): DestinationEntry[] =>
          d.mode === "focused"
            ? [{ kind: "country", country: d.country, countryCode: d.countryCode, cities: d.cities }]
            : d.regions.map((region) => ({ kind: "region", region })),
        ),
        dates:
          post.date.mode === "focused"
            ? { mode: "specific", startDate: post.date.startDate, endDate: post.date.endDate, months: [] }
            : post.date.mode === "flexible"
              ? { mode: "specific", startDate: post.date.earliest, endDate: post.date.latest, months: [] }
              : { mode: "flexible", startDate: "", endDate: "", months: post.date.months },
        vibes: post.vibes,
        bio: post.bio,
      });
      setEditingPostId(post.id);
      setPostStep(0);
      setPostDestQuery("");
      setPostError(null);
      setViewPostId(null);
      setIsModalOpen(true);
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
      const ageMin = ageMinFilter.trim() === "" ? null : Number(ageMinFilter);
      const ageMax = ageMaxFilter.trim() === "" ? null : Number(ageMaxFilter);
      const matchesAge = (ageMin === null || post.user.age >= ageMin) && (ageMax === null || post.user.age <= ageMax);
      const matchesSaved = !showSavedOnly || savedPostIds.has(post.id);
      return matchesRegion && matchesVibe && matchesGender && matchesAge && matchesSaved;
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
    ageMinFilter,
    ageMaxFilter,
    showSavedOnly,
    savedPostIds,
    appliedDateSearch,
    geoWarmTick,
  ]);

  const viewPost = posts.find((p) => p.id === viewPostId) ?? null;
  const viewPostDestinationChips = useMemo(
    () => (viewPost ? getDestinationChips(viewPost.destinations) : null),
    [viewPost],
  );

  // Reset the revealed contact synchronously on render when the viewed post changes,
  // rather than in an effect (https://react.dev/learn/you-might-not-need-an-effect).
  const [revealedForPostId, setRevealedForPostId] = useState<string | null>(null);
  if (viewPostId !== revealedForPostId) {
    setRevealedForPostId(viewPostId);
    setRevealedContact(null);
  }

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

  // Post-creation destination picker: same search + infinite-scroll carousel of
  // countries/regions as the hero search (see DestinationPickerOverlay), restricted to
  // country/region cards since cities are handled per-country below (see the "add
  // specific places" reveal).
  const postDestinationCards = useMemo((): SearchDestination[] => {
    const q = postDestQuery.trim().toLowerCase();
    if (q === "") {
      return getPopularDestinations().map((c) => ({ type: "country" as const, code: c.isoCode, name: c.name }));
    }
    const countries: SearchDestination[] = getAllCountries()
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 12)
      .map((c) => ({ type: "country" as const, code: c.isoCode, name: c.name }));
    const regions: SearchDestination[] = REGIONS.filter((r) => r.toLowerCase().includes(q)).map((r) => ({
      type: "region" as const,
      name: r,
    }));
    return [...countries, ...regions];
  }, [postDestQuery]);

  function isDestinationChosen(item: SearchDestination): boolean {
    if (item.type === "country") return form.destinations.some((e) => e.kind === "country" && e.countryCode === item.code);
    if (item.type === "region") return form.destinations.some((e) => e.kind === "region" && e.region === item.name);
    return false;
  }

  function toggleDestinationChoice(item: SearchDestination) {
    if (item.type === "country") {
      setForm((prev) => {
        const exists = prev.destinations.some((e) => e.kind === "country" && e.countryCode === item.code);
        return {
          ...prev,
          destinations: exists
            ? prev.destinations.filter((e) => !(e.kind === "country" && e.countryCode === item.code))
            : [...prev.destinations, { kind: "country", country: item.name, countryCode: item.code, cities: [] }],
        };
      });
    } else if (item.type === "region") {
      setForm((prev) => {
        const exists = prev.destinations.some((e) => e.kind === "region" && e.region === item.name);
        return {
          ...prev,
          destinations: exists
            ? prev.destinations.filter((e) => !(e.kind === "region" && e.region === item.name))
            : [...prev.destinations, { kind: "region", region: item.name }],
        };
      });
    }
  }

  function citiesOptionsFor(entry: Extract<DestinationEntry, { kind: "country" }>) {
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

  function updateCountryEntry(
    index: number,
    updater: (entry: Extract<DestinationEntry, { kind: "country" }>) => DestinationEntry,
  ) {
    setForm((prev) => ({
      ...prev,
      destinations: prev.destinations.map((entry, i) =>
        i === index && entry.kind === "country" ? updater(entry) : entry,
      ),
    }));
  }

  function toggleEntryCity(index: number, city: string) {
    updateCountryEntry(index, (entry) => ({
      ...entry,
      cities: entry.cities.includes(city) ? entry.cities.filter((c) => c !== city) : [...entry.cities, city],
    }));
  }

  function addEntryCity(index: number, city: string) {
    updateCountryEntry(index, (entry) =>
      entry.cities.includes(city) ? entry : { ...entry, cities: [...entry.cities, city] },
    );
  }

  function removeDestinationEntry(index: number) {
    setForm((prev) => ({ ...prev, destinations: prev.destinations.filter((_, i) => i !== index) }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function isDestinationStepValid(): boolean {
    return form.destinations.length > 0;
  }

  function isDatesStepValid(): boolean {
    return hasActiveDateSearch(toSearchInput(form.dates));
  }

  function isPostStepValid(step: 0 | 1 | 2): boolean {
    if (step === 0) return isDestinationStepValid();
    if (step === 1) return isDatesStepValid();
    return true;
  }

  function isFormValid(): boolean {
    return isDestinationStepValid() && isDatesStepValid();
  }

  function openPostModal() {
    requireAuth(() => {
      resetForm();
      setEditingPostId(null);
      setPostStep(0);
      setPostDestQuery("");
      setPostError(null);
      setIsModalOpen(true);
    });
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    // Guards against any stray submit event reaching the form while the user is still
    // mid-wizard (only the last step renders an actual type="submit" button, but this
    // makes it structurally impossible for a post to be created before then regardless).
    if (postStep !== 2) return;
    if (!isFormValid()) return;

    const countryDestinations: Destination[] = form.destinations
      .filter((entry): entry is Extract<DestinationEntry, { kind: "country" }> => entry.kind === "country")
      .map((entry) => ({ mode: "focused", country: entry.country, countryCode: entry.countryCode, cities: entry.cities }));
    const chosenRegions = form.destinations
      .filter((entry): entry is Extract<DestinationEntry, { kind: "region" }> => entry.kind === "region")
      .map((entry) => entry.region);
    const destinations: Destination[] = [
      ...countryDestinations,
      ...(chosenRegions.length > 0 ? [{ mode: "broad" as const, regions: chosenRegions }] : []),
    ];

    const date: TripDate =
      form.dates.mode === "specific"
        ? { mode: "focused", startDate: form.dates.startDate, endDate: form.dates.endDate }
        : { mode: "broad", months: form.dates.months };

    requireAuth(() => {
      setPostError(null);
      setIsSavingPost(true);
      const input = { destinations, date, vibes: form.vibes, bio: form.bio };
      const save = editingPostId ? editPost(editingPostId, input) : addPost(input);
      save.then((error) => {
        setIsSavingPost(false);
        if (error) {
          setPostError(error);
          return;
        }
        resetForm();
        setEditingPostId(null);
        setIsModalOpen(false);
      });
    });
  }

  // Destination/dates trigger buttons + their dropdown panels are shared between the
  // compact sticky-header search bar (shown once the user has searched) and the large,
  // centered first-run prompt (shown before that) — same behavior, different sizing, so
  // the two surfaces can't drift apart. Plain functions (not components) so calling them
  // inline doesn't remount the DOM/reset focus on every render.
  function renderDestinationTrigger(size: "sm" | "lg") {
    const hasSelection = selectedDestinations.length > 0;
    return (
      <div
        className={`flex min-w-0 flex-1 items-center transition ${
          size === "lg" ? "border-b border-slate-100 sm:border-b-0 sm:border-r" : "border-r border-slate-100"
        } ${openHeroField === "destination" ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
      >
        <button
          type="button"
          onClick={() => {
            const opening = openHeroField !== "destination";
            if (opening) setDestinationPickerCloseOnSelect(selectedDestinations.length === 0);
            setOpenHeroField(openHeroField === "destination" ? null : "destination");
          }}
          className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left ${
            size === "lg" ? "px-4 py-4" : "px-3 py-2.5"
          }`}
        >
          <span
            className={`flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-400 ${size === "lg" ? "text-xs" : "text-[10px]"}`}
          >
            <IconMapPin className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} />
            Destination
          </span>
          <span className={`w-full truncate font-semibold text-slate-900 ${size === "lg" ? "text-base" : "text-sm"}`}>
            {hasSelection ? selectedDestinations.map((d) => d.name).join(" + ") : "Anywhere"}
          </span>
        </button>

        {hasSelection && (
          <button
            type="button"
            onClick={() => {
              setDestinationPickerCloseOnSelect(false);
              setOpenHeroField("destination");
            }}
            aria-label="Choose more destinations"
            className={`mr-2 flex shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 active:scale-90 ${
              size === "lg" ? "h-7 w-7" : "h-6 w-6"
            }`}
          >
            <IconPlus className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
          </button>
        )}
      </div>
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
            <button
              type="button"
              onClick={() => setSelectedDestinations([])}
              className="ml-1 text-xs font-semibold text-slate-400 transition hover:text-slate-700 hover:underline"
            >
              Clear
            </button>
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
            <MonthCarousel
              months={monthOptions}
              selected={dateSearchDraft.months}
              formatMonth={formatMonth}
              currentMonth={currentMonthKey()}
              onToggle={(month) =>
                setDateSearchDraft((d) => ({
                  ...d,
                  months: d.months.includes(month) ? d.months.filter((m) => m !== month) : [...d.months, month],
                }))
              }
            />
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
              {!currentUser && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => router.push("/sign-in")}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 active:scale-95"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/sign-up")}
                    className="rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition active:scale-95 active:bg-orange-600"
                  >
                    Sign up
                  </button>
                </div>
              )}
              {currentUser && (
                <div ref={profileMenuRef} className="relative">
                  <button
                    type="button"
                    aria-label="Profile"
                    aria-haspopup="menu"
                    aria-expanded={showProfileMenu}
                    onClick={() => setShowProfileMenu((v) => !v)}
                    className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-bold text-slate-600 transition active:scale-95 active:bg-slate-200"
                  >
                    <Avatar url={currentUser.avatarUrl} initials={currentUser.avatar} className="h-9 w-9 text-xs" />
                  </button>

                  {showProfileMenu && (
                    <div
                      role="menu"
                      className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      <div className="border-b border-slate-100 px-3 py-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{currentUser.name}</p>
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowProfileMenu(false);
                          router.push("/profile");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <IconUser className="h-4 w-4 text-slate-400" />
                        My Profile
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          logout();
                          setShowProfileMenu(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                      >
                        <IconLogOut className="h-4 w-4" />
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              )}
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

            {/* "More filters" as an inline row pushing content down, rather than a
                floating dropdown — merges the trip-style filter in alongside gender
                and age, all in one place. */}
            {openHeroField === "filters" && (
              <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">More filters</p>
                  <button
                    type="button"
                    onClick={clearMoreFilters}
                    className="text-xs font-semibold text-slate-400 transition hover:text-slate-700 hover:underline"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Gender</label>
                  <div className="flex overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
                    {(["All", ...GENDERS] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setGenderFilter(option)}
                        className={`flex-1 py-2 text-xs font-semibold transition ${
                          genderFilter === option
                            ? "bg-orange-50 text-orange-700"
                            : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {option === "All" ? "Any" : option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Age</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={ageMinFilter}
                      onChange={(e) => setAgeMinFilter(e.target.value)}
                      placeholder="Min"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                    <span className="text-xs text-slate-400">to</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={ageMaxFilter}
                      onChange={(e) => setAgeMaxFilter(e.target.value)}
                      placeholder="Max"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>
      )}

      {/* Main content */}
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">
        {!hasSearched ? (
          <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
            <div className="absolute inset-x-0 top-0 flex items-center justify-end gap-2">
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => router.push("/profile")}
                  aria-label="My profile"
                  className="overflow-hidden rounded-full transition active:scale-95"
                >
                  <Avatar url={currentUser.avatarUrl} initials={currentUser.avatar} className="h-10 w-10 text-sm" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => router.push("/sign-in")}
                    className="rounded-full px-3.5 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 active:scale-95"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/sign-up")}
                    className="rounded-full bg-orange-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95 active:bg-orange-600"
                  >
                    Sign up
                  </button>
                </>
              )}
            </div>
            <h1
              style={{ viewTransitionName: "logo" }}
              className="text-5xl font-extrabold tracking-tight text-slate-900"
            >
              trip<span className="text-orange-500">hop</span>
            </h1>

            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Where&apos;s your next trip{currentUser ? `, ${currentUser.firstName}` : ""}?
              </h2>
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
                  selectedDestinations={selectedDestinations}
                  closeOnSelect={destinationPickerCloseOnSelect}
                  onSelect={(dest) => withViewTransition(() => toggleSelectedDestination(dest))}
                  onClear={() => withViewTransition(() => setSelectedDestinations([]))}
                  onClose={() => setOpenHeroField(null)}
                />
              )}

              {openHeroField === "dates" && (
                <DatePickerOverlay
                  draft={dateSearchDraft}
                  onDraftChange={setDateSearchDraft}
                  monthOptions={monthOptions}
                  currentMonth={currentMonthKey()}
                  formatMonth={formatMonth}
                  onAutoApply={(next) =>
                    withViewTransition(() => {
                      setAppliedDateSearch(next);
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
                      setOpenHeroField(null);
                    })
                  }
                  onClear={() =>
                    withViewTransition(() => {
                      setDateSearchDraft(EMPTY_DATE_SEARCH);
                      setAppliedDateSearch(null);
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
            <div className="px-1">
              <h1 className="text-lg font-bold text-slate-900">Trips looking for a travel partner</h1>
              <p className="text-xs text-slate-500">Browse trips and reach out to plan together.</p>
            </div>

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
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
                  {currentUser && post.userId === currentUser.id && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditPost(post);
                        }}
                        aria-label="Edit trip"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-400 ring-1 ring-slate-200 transition hover:text-slate-700 active:scale-90"
                      >
                        <IconEdit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Delete this trip post?")) deletePost(post.id);
                        }}
                        aria-label="Delete trip"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-400 ring-1 ring-slate-200 transition hover:text-rose-600 active:scale-90"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSavedPost(post.id);
                    }}
                    aria-label={savedPostIds.has(post.id) ? "Remove from saved" : "Save trip"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-90 ${
                      savedPostIds.has(post.id)
                        ? "bg-rose-500 text-white"
                        : "bg-white/90 text-slate-400 ring-1 ring-slate-200 hover:text-rose-500"
                    }`}
                  >
                    <IconHeart className="h-4 w-4" filled={savedPostIds.has(post.id)} />
                  </button>
                </div>

                {/* 1. Destination — primary header */}
                <div
                  className={`flex min-w-0 items-start gap-1.5 ${
                    currentUser && post.userId === currentUser.id ? "pr-28" : "pr-9"
                  }`}
                >
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
                  <Avatar
                    url={post.user.avatarUrl}
                    initials={initials(post.user.name)}
                    colorClass={post.user.avatarColor}
                    className="h-9 w-9 text-xs"
                  />
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
            <div className="px-1">
              <h1 className="text-lg font-bold text-slate-900">Where trips are happening</h1>
              <p className="text-xs text-slate-500">Tap a pin to see who&apos;s heading there.</p>
            </div>

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
                    <Avatar
                      url={focusedMapPost.user.avatarUrl}
                      initials={initials(focusedMapPost.user.name)}
                      colorClass={focusedMapPost.user.avatarColor}
                      className="h-10 w-10 text-xs"
                    />
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
          onClick={openPostModal}
          aria-label="Create new post"
          className="fixed bottom-6 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/30 transition active:scale-95 active:bg-orange-600"
        >
          <IconPlus className="h-6 w-6" />
        </button>
      )}

      {/* Create Post Modal (slide-over) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          <div className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 sm:h-[85dvh] sm:max-w-lg sm:rounded-3xl sm:shadow-2xl">
            <form onSubmit={handleSubmit} className="flex h-full flex-col">
              {/* Step header: back/close + progress dots */}
              <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3 sm:pt-4">
                <button
                  type="button"
                  onClick={() =>
                    postStep === 0
                      ? setIsModalOpen(false)
                      : withViewTransition(() => setPostStep((s) => (s - 1) as 0 | 1 | 2))
                  }
                  aria-label={postStep === 0 ? "Close" : "Back"}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95 active:bg-white/20"
                >
                  {postStep === 0 ? <IconX className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
                </button>
                <div className="flex flex-1 gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition ${i <= postStep ? "bg-orange-500" : "bg-white/15"}`}
                    />
                  ))}
                </div>
              </div>

              {/* Step content */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {postStep === 0 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-white">Where are you going?</h2>
                      <p className="text-xs text-slate-400">Search countries or regions — pick as many as you like.</p>
                    </div>

                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={postDestQuery}
                        onChange={(e) => setPostDestQuery(e.target.value)}
                        placeholder="Search countries or regions…"
                        className="w-full rounded-2xl border border-white/10 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-orange-400/60 focus:ring-2 focus:ring-orange-400/30"
                      />
                    </div>

                    {postDestinationCards.length === 0 ? (
                      <p className="text-center text-sm text-slate-400">No matches found</p>
                    ) : (
                      <PostDestinationCarousel
                        items={postDestinationCards}
                        isSearching={postDestQuery.trim() !== ""}
                        isSelected={isDestinationChosen}
                        onSelect={toggleDestinationChoice}
                      />
                    )}

                    {form.destinations.map((entry, index) => {
                      const key = entry.kind === "country" ? `country:${entry.countryCode}` : `region:${entry.region}`;
                      const label = entry.kind === "country" ? entry.country : entry.region;
                      return (
                        <div key={key} className="rounded-xl bg-white/5 ring-1 ring-inset ring-white/10">
                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-sm font-medium text-white">{label}</span>
                            <button
                              type="button"
                              onClick={() => removeDestinationEntry(index)}
                              aria-label={`Remove ${label}`}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
                            >
                              <IconX className="h-3 w-3" />
                            </button>
                          </div>

                          {entry.kind === "country" &&
                            (() => {
                              const { cityOptions } = citiesOptionsFor(entry);
                              return (
                                <div className="border-t border-white/10 px-3 pb-3 pt-2">
                                  <Combobox
                                    options={cityOptions}
                                    onSelect={(opt) => addEntryCity(index, opt.value)}
                                    placeholder={`Add specific places in ${entry.country}…`}
                                    emptyMessage="No matching cities"
                                  />

                                  {entry.cities.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {entry.cities.map((city) => (
                                        <span
                                          key={city}
                                          className="flex items-center gap-1 rounded-full bg-white/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white"
                                        >
                                          {city}
                                          <button
                                            type="button"
                                            onClick={() => toggleEntryCity(index, city)}
                                            aria-label={`Remove ${city}`}
                                            className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/20"
                                          >
                                            <IconX className="h-2.5 w-2.5" />
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                        </div>
                      );
                    })}
                  </div>
                )}

                {postStep === 1 && (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-inset ring-white/10">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Destination</p>
                      <p className="line-clamp-2 text-sm font-medium text-white">
                        {getDestinationEntriesSummary(form.destinations)}
                      </p>
                    </div>

                    <div>
                      <h2 className="text-lg font-bold text-white">When&apos;s the trip?</h2>
                      <p className="text-xs text-slate-400">Give travelers a sense of your timing.</p>
                    </div>
                    <DateSearchFields
                      draft={form.dates}
                      onDraftChange={(updater) => setForm((p) => ({ ...p, dates: updater(p.dates) }))}
                      monthOptions={monthOptions}
                      currentMonth={currentMonthKey()}
                      formatMonth={formatMonth}
                    />
                  </div>
                )}

                {postStep === 2 && (
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2 rounded-xl bg-white/5 px-3 py-2 ring-1 ring-inset ring-white/10">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Destination</p>
                        <p className="line-clamp-2 text-sm font-medium text-white">
                          {getDestinationEntriesSummary(form.destinations)}
                        </p>
                      </div>
                      <div className="border-t border-white/10 pt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Dates</p>
                        <p className="line-clamp-2 text-sm font-medium text-white">{getDateSearchLabel(form.dates)}</p>
                      </div>
                    </div>

                    <div>
                      <h2 className="text-lg font-bold text-white">Add some style</h2>
                      <p className="text-xs text-slate-400">Optional finishing touches.</p>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-300">
                        Trip style / vibe (optional)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {TRIP_STYLES.map((vibe) => (
                          <button
                            key={vibe}
                            type="button"
                            onClick={() => toggleFormVibe(vibe)}
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                              form.vibes.includes(vibe)
                                ? "bg-orange-500 text-white ring-orange-500"
                                : "bg-white/10 text-slate-200 ring-white/20 hover:bg-white/20"
                            }`}
                          >
                            {vibe}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">Bio / description</label>
                      <textarea
                        value={form.bio}
                        onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                        placeholder="Tell potential travel partners about your plans, pace, and what you're looking for..."
                        rows={4}
                        className="w-full resize-none rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Step footer */}
              <div className="border-t border-white/10 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {postStep === 2 && postError && (
                  <p className="mb-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300">
                    {postError}
                  </p>
                )}
                {postStep < 2 ? (
                  <button
                    type="button"
                    disabled={!isPostStepValid(postStep)}
                    onClick={() => withViewTransition(() => setPostStep((s) => (s + 1) as 0 | 1 | 2))}
                    className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!isFormValid() || isSavingPost}
                    className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                  >
                    {isSavingPost ? "Saving…" : editingPostId ? "Save changes" : "Post trip"}
                  </button>
                )}
              </div>
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
                {currentUser && viewPost.userId === currentUser.id && (
                  <>
                    <button
                      type="button"
                      onClick={() => startEditPost(viewPost)}
                      aria-label="Edit trip"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:text-slate-900 active:scale-90"
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Delete this trip post?")) deletePost(viewPost.id);
                      }}
                      aria-label="Delete trip"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:text-rose-600 active:scale-90"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </>
                )}
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
              {/* Destination — wrapped chips rather than one heading, so posts with many
                  countries/regions read as a scannable list instead of a wall of text. */}
              <div className="flex items-start gap-2">
                <IconMapPin className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
                <div className="flex flex-wrap gap-1.5">
                  {viewPostDestinationChips?.chips.map((chip, i) => (
                    <span
                      key={i}
                      className="max-w-full truncate rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700 ring-1 ring-inset ring-orange-600/20"
                    >
                      {chip}
                    </span>
                  ))}
                  {!!viewPostDestinationChips?.moreCount && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-500">
                      +{viewPostDestinationChips.moreCount} more
                    </span>
                  )}
                </div>
              </div>

              {/* Dates */}
              <div className="mt-2 flex items-center gap-1.5 pl-[26px] text-base font-medium text-slate-600">
                <IconCalendar className="h-4 w-4 shrink-0 text-slate-400" />
                {getDateLabel(viewPost.date)}
              </div>

              {viewPost.createdAt && (
                <p className="mt-1 pl-[26px] text-xs text-slate-400">
                  Posted {formatRelativeTime(viewPost.createdAt)}
                </p>
              )}

              {/* User info */}
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <Avatar
                  url={viewPost.user.avatarUrl}
                  initials={initials(viewPost.user.name)}
                  colorClass={viewPost.user.avatarColor}
                  className="h-12 w-12 text-base"
                />
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{viewPost.user.name}</span>
                    {" · "}
                    {viewPost.user.age}
                    {" · "}
                    {formatGender(viewPost.user.gender)}
                  </p>
                  {viewPost.user.about && (
                    <p className="mt-0.5 text-xs italic text-slate-500">&ldquo;{viewPost.user.about}&rdquo;</p>
                  )}
                </div>
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
              {revealedContact ? (
                <a
                  href={revealedContact}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-emerald-600"
                >
                  <IconWhatsApp className="h-4 w-4" />
                  Message on WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    requireAuth(() => {
                      revealContact(viewPost.id).then((contact) => setRevealedContact(contact));
                    })
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-emerald-600"
                >
                  <IconWhatsApp className="h-4 w-4" />
                  {currentUser ? "Show WhatsApp contact" : "Log in to contact"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trip Map modal */}
      {viewPost && isTripMapOpen && (
        <div className="fixed inset-0 z-[1300] flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-900/40 sm:p-4">
          <div className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-white sm:h-[80dvh] sm:rounded-3xl sm:shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="min-w-0 truncate text-sm font-bold text-slate-900">
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
