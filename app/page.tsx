"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import { IconPlus } from "./components/icons";
import type { FeedMapPoint, FeedMapPost } from "./components/TripMap";
import Combobox from "./components/Combobox";
import CreatePostModal from "./components/CreatePostModal";
import DateSearchFields from "./components/DateSearchFields";
import { FeedList } from "./components/FeedList";
import { FeedMapView } from "./components/FeedMapView";
import HeroSearch from "./components/HeroSearch";
import { PostDetailView, UserProfileOverlay } from "./components/PostDetailView";
import TopNavBar from "./components/TopNavBar";
import { getPopularDestinations } from "./data/popularDestinations";
import {
  geocodePlace,
  geocodeSuggestions,
  getAllCountries,
  getCitiesOfCountry,
  getCountryByCode,
  REGION_CENTROIDS,
  REGIONS,
  type Region,
} from "./lib/geo";
import { hasActiveDateSearch, type DateSearchInput } from "./lib/relevance";
import { useAuth } from "./context/AuthContext";
import { useUnreadMessageCount } from "./lib/messagesStore";
import { usePostsStore, type PostsFilters } from "./lib/postsStore";
import { useClerkSupabaseClient } from "./lib/supabase/useClerkSupabaseClient";

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
  /** Whether this post's author opted in to sharing their WhatsApp number for it. */
  shareContact: boolean;
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

// bbox/countryCode on the "place" variant carry a picked Mapbox geocoding suggestion's
// already-resolved result (see geocodeSuggestions() in lib/geo.ts) through to the
// search_posts() RPC (supabase/migrations/0013_search_posts_rpc.sql) for cross-border
// bbox-overlap matching — set once, at selection time, never re-resolved later.
export type SearchDestination =
  | { type: "country"; code: string; name: string }
  | { type: "city"; name: string; countryCode: string; countryName: string }
  | { type: "region"; name: Region }
  | { type: "place"; name: string; placeType: string; countryCode?: string; bbox?: [number, number, number, number] };

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

export type DestinationEntry =
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

export type FormState = {
  destinations: DestinationEntry[];
  dates: DateSearchUI;
  vibes: TripVibe[];
  bio: string;
  shareContact: boolean;
  /** Only used when shareContact is checked and the user has no number saved yet. */
  contactDraft: string;
};

const EMPTY_FORM: FormState = {
  destinations: [],
  dates: EMPTY_DATE_SEARCH,
  vibes: [],
  bio: "",
  shareContact: false,
  contactDraft: "",
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

// A single scrollTo() loses the race against whatever else settles right after the
// target content lands — images finishing, the sticky header's layout, Next's own
// post-navigation scroll handling. Reasserting for a handful of frames outlasts all of
// that instead of guessing which one goes last.
function reassertScrollTo(y: number, framesLeft = 10) {
  window.scrollTo(0, y);
  if (framesLeft > 1) requestAnimationFrame(() => reassertScrollTo(y, framesLeft - 1));
}

// Persists the hero/feed search across a full route unmount (visiting /profile or
// /messages and coming back) so returning to "/" resumes exactly where the user left
// off instead of re-showing the first-run hero. sessionStorage rather than localStorage
// — this is "resume this browsing session," not a permanent preference, and should
// naturally clear itself once the tab closes.
const FEED_STATE_STORAGE_KEY = "triphop:feedState";

type StoredFeedState = {
  hasSearched: boolean;
  view: "feed" | "map";
  selectedDestinations: SearchDestination[];
  appliedDateSearch: DateSearchUI | null;
  // vibeFilter, genderFilter, ageMin/MaxFilter, and showSavedOnly are deliberately NOT
  // persisted here. Destination and dates are always visible in the search bar's two
  // trigger boxes, so restoring them is unmistakable. The rest live behind the
  // collapsed "More filters" panel with no always-visible indicator of their own — a
  // narrow vibe/gender/age filter (or "saved only") silently surviving a navigation
  // reads as "most of my posts disappeared" rather than "a filter is still on" (this
  // bit a real user: three posts left, no filter visible, because vibeFilter had
  // silently carried over as "Road Trip"). These always reset to their defaults on a
  // fresh mount instead.
};

function readStoredFeedState(): StoredFeedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FEED_STATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredFeedState) : null;
  } catch {
    return null;
  }
}

function writeStoredFeedState(state: StoredFeedState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(FEED_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-browsing / storage-full edge cases can throw here — losing the "resume
    // where I left off" niceties isn't worth crashing the app over.
  }
}

// Separate key from the search/filter state above: this changes on every scroll tick
// (high write frequency) while the filters above only change on deliberate user action,
// so keeping them apart avoids re-serializing the filter blob on every scroll pixel.
const FEED_SCROLL_STORAGE_KEY = "triphop:feedScroll";

type StoredFeedScroll = { scrollY: number; loadedCount: number };

function readStoredFeedScroll(): StoredFeedScroll | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FEED_SCROLL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredFeedScroll) : null;
  } catch {
    return null;
  }
}

function writeStoredFeedScroll(state: StoredFeedScroll) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(FEED_SCROLL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // See writeStoredFeedState.
  }
}

function clearStoredFeedScroll() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(FEED_SCROLL_STORAGE_KEY);
  } catch {
    // See writeStoredFeedState.
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
  const supabase = useClerkSupabaseClient();
  const unreadMessageCount = useUnreadMessageCount();
  // Read once, synchronously, on first mount — before anything below initializes off
  // of it. Not a useMemo: this must run exactly once per mount (a fresh reference on
  // every render would defeat the point of a single stable "what did we resume" value).
  const [restoredFeedState] = useState(() => readStoredFeedState());
  const [restoredFeedScroll] = useState(() => readStoredFeedScroll());

  const [revealedContact, setRevealedContact] = useState<string | null>(null);
  const [view, setView] = useState<"feed" | "map">(restoredFeedState?.view ?? "feed");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDestinations, setSelectedDestinations] = useState<SearchDestination[]>(
    restoredFeedState?.selectedDestinations ?? [],
  );
  const [destinationQuery, setDestinationQuery] = useState("");
  const [vibeFilter, setVibeFilter] = useState<TripVibe | "All">("All");
  const [appliedDateSearch, setAppliedDateSearch] = useState<DateSearchUI | null>(
    restoredFeedState?.appliedDateSearch ?? null,
  );
  const [dateSearchDraft, setDateSearchDraft] = useState<DateSearchUI>(EMPTY_DATE_SEARCH);
  const [genderFilter, setGenderFilter] = useState<Gender | "All">("All");
  const [ageMinFilter, setAgeMinFilter] = useState("");
  const [ageMaxFilter, setAgeMaxFilter] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [postStep, setPostStep] = useState<0 | 1 | 2>(0);
  const [postDestQuery, setPostDestQuery] = useState("");
  const [viewPostId, setViewPostId] = useState<string | null>(null);
  // A user profile is an overlay on top of whatever's already showing (feed, map, or
  // even an open post-detail view) rather than a route change — routing away and back
  // would unmount this whole component and lose hasSearched/filters/scroll, exactly the
  // thing "back" should never do. See the profile overlay near the other modals below.
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [isTripMapOpen, setIsTripMapOpen] = useState(false);
  const [tripMapPoints, setTripMapPoints] = useState<GeoPoint[]>([]);
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  // Referentially stable unless one of these state values actually changes (all are
  // useState values themselves, so this only produces a new object when a filter really
  // changed) — usePostsStore depends on it to know when to re-run its search.
  const filters: PostsFilters = useMemo(
    () => ({
      destinations: selectedDestinations,
      vibe: vibeFilter,
      gender: genderFilter,
      ageMin: ageMinFilter,
      ageMax: ageMaxFilter,
      savedOnly: showSavedOnly,
      dateSearch: appliedDateSearch ? toSearchInput(appliedDateSearch) : null,
    }),
    [selectedDestinations, vibeFilter, genderFilter, ageMinFilter, ageMaxFilter, showSavedOnly, appliedDateSearch],
  );
  const { posts, loading, savedPostIds, hasMore, loadingMore, loadMore, addPost, editPost, removePost, toggleSaved, revealContact } =
    usePostsStore(filters);

  // Whether anything in the collapsed "More filters" panel is narrowing the feed —
  // shown as a dot on its trigger, since none of these (unlike destination/dates) have
  // any other on-screen indicator of their own once the panel is closed.
  const hasMoreFiltersActive =
    vibeFilter !== "All" || genderFilter !== "All" || ageMinFilter.trim() !== "" || ageMaxFilter.trim() !== "";

  const [openHeroField, setOpenHeroField] = useState<"destination" | "dates" | "filters" | null>(null);
  // Whether the user has performed their first search yet — gates the full-screen,
  // centered destination/dates prompt (see below) that replaces the feed on first run,
  // so a first-time visitor sees an inviting, focused "what do I search for" moment
  // instead of a wall of posts with no context. Restored from sessionStorage so
  // navigating to /profile or /messages and back resumes the feed instead of
  // re-showing the hero — only an explicit tap on the logo (see the header below)
  // should ever bring the hero back.
  const [hasSearched, setHasSearched] = useState(restoredFeedState?.hasSearched ?? false);
  const heroRef = useRef<HTMLDivElement>(null);

  // Persist the hero/feed search whenever it meaningfully changes, so a later mount
  // (after visiting /profile or /messages) can resume it via restoredFeedState above.
  // Only the fields with an always-visible on-screen representation — see
  // StoredFeedState above for why vibe/gender/age/savedOnly are excluded.
  useEffect(() => {
    writeStoredFeedState({ hasSearched, view, selectedDestinations, appliedDateSearch });
  }, [hasSearched, view, selectedDestinations, appliedDateSearch]);

  // The hero is a fixed, app-like screen: everything fits, so the page itself must not
  // scroll (rubber-banding there just detaches the search card from the wordmark). The
  // feed, once searched, scrolls normally again.
  useEffect(() => {
    if (hasSearched) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [hasSearched]);

  // Tracks how far into the feed the user has scrolled (and how many posts that took),
  // so the restore effect below can reload the same number of pages and land on the
  // same spot. A ref rather than a `posts.length` effect dependency — this only needs
  // the *current* count when a scroll event fires, not a reason to rebind the listener
  // on every page load.
  const postsLengthRef = useRef(posts.length);
  useEffect(() => {
    postsLengthRef.current = posts.length;
  }, [posts.length]);

  useEffect(() => {
    if (!hasSearched || view !== "feed") return;
    function handleScroll() {
      writeStoredFeedScroll({ scrollY: window.scrollY, loadedCount: postsLengthRef.current });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hasSearched, view]);

  // Restores the scroll position captured above: reloads pages until at least as many
  // posts are back as were loaded before, then scrolls. Runs at most once per mount
  // (restoredScrollDoneRef), so it never fights the user's own scrolling afterward, and
  // bails immediately if there's nothing to restore.
  const restoredScrollDoneRef = useRef(false);
  useEffect(() => {
    if (restoredScrollDoneRef.current) return;
    if (!restoredFeedScroll || !hasSearched || view !== "feed") {
      restoredScrollDoneRef.current = true;
      return;
    }
    if (loading) return; // wait for the initial fetch to resolve
    if (posts.length < restoredFeedScroll.loadedCount && hasMore) {
      if (!loadingMore) loadMore();
      return;
    }
    restoredScrollDoneRef.current = true;
    requestAnimationFrame(() => reassertScrollTo(restoredFeedScroll.scrollY));
  }, [restoredFeedScroll, hasSearched, view, loading, posts.length, hasMore, loadingMore, loadMore]);

  // Switching to the map view unmounts the feed list, so returning to it always lands
  // back at the top unless the scroll position is captured first — the store's posts
  // stay in memory across the toggle, so (unlike the cross-page restore above) there's
  // no reload-more-pages step needed, just capture-then-reassert.
  const feedScrollBeforeMapRef = useRef<number | null>(null);
  function switchToMapView() {
    if (view === "feed") feedScrollBeforeMapRef.current = window.scrollY;
    setView("map");
  }
  function switchToFeedView() {
    setView("feed");
    const targetY = feedScrollBeforeMapRef.current;
    if (targetY === null) return;
    feedScrollBeforeMapRef.current = null;
    requestAnimationFrame(() => reassertScrollTo(targetY));
  }

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [postError, setPostError] = useState<string | null>(null);
  const [isSavingPost, setIsSavingPost] = useState(false);

  // Whether the signed-in user already has a WhatsApp number on file — determines
  // whether checking "share contact" on a post needs an inline number field too. Reset
  // synchronously on user change (not in an effect) per the pattern used elsewhere in
  // this file — see revealedForPostId below.
  const [myWhatsapp, setMyWhatsapp] = useState<string | null>(null);
  const [myWhatsappForUserId, setMyWhatsappForUserId] = useState<string | null>(null);
  if ((currentUser?.id ?? null) !== myWhatsappForUserId) {
    setMyWhatsappForUserId(currentUser?.id ?? null);
    setMyWhatsapp(null);
  }

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    supabase.rpc("get_my_whatsapp").then(({ data, error }) => {
      if (cancelled || error) return;
      setMyWhatsapp(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase]);

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

  // Same pattern for /?user=<id> — the old standalone /users/[id] route redirects here
  // so a shared/bookmarked profile link still opens the right overlay.
  const userParam = searchParams.get("user");
  const [handledUserParam, setHandledUserParam] = useState<string | null>(null);
  if (userParam && userParam !== handledUserParam) {
    setHandledUserParam(userParam);
    setHasSearched(true);
    setViewUserId(userParam);
  }

  useEffect(() => {
    if (handledPostParam || handledUserParam) router.replace("/");
  }, [handledPostParam, handledUserParam, router]);

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

  // Stops the click from bubbling into a containing post card/row (which opens the
  // post-detail view instead) before opening that user's profile overlay.
  function goToUserProfile(userId: string, e?: { stopPropagation: () => void }) {
    e?.stopPropagation();
    setViewUserId(userId);
  }

  type ViewedProfile = {
    name: string;
    age: number | null;
    gender: Gender | null;
    avatarColor: string | null;
    avatarUrl: string | null;
    about: string | null;
  };
  const [viewedProfile, setViewedProfile] = useState<ViewedProfile | null>(null);
  const [viewedProfileLoading, setViewedProfileLoading] = useState(false);

  // Reset synchronously on render when the viewed user changes, rather than in an
  // effect (https://react.dev/learn/you-might-not-need-an-effect) — same pattern as
  // revealedForPostId below.
  const [profileFetchedForUserId, setProfileFetchedForUserId] = useState<string | null>(null);
  if (viewUserId !== profileFetchedForUserId) {
    setProfileFetchedForUserId(viewUserId);
    setViewedProfile(null);
    setViewedProfileLoading(viewUserId !== null);
  }

  useEffect(() => {
    if (!viewUserId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("name, age, gender, avatar_color, avatar_url, about")
      .eq("id", viewUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setViewedProfile(
          error || !data
            ? null
            : {
                name: data.name,
                age: data.age,
                gender: data.gender,
                avatarColor: data.avatar_color,
                avatarUrl: data.avatar_url,
                about: data.about,
              },
        );
        setViewedProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewUserId, supabase]);

  const viewedUserPosts = useMemo(
    () => (viewUserId ? posts.filter((p) => p.userId === viewUserId) : []),
    [posts, viewUserId],
  );

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
        shareContact: post.shareContact,
        contactDraft: "",
      });
      setEditingPostId(post.id);
      setPostStep(0);
      setPostDestQuery("");
      setPostError(null);
      setViewPostId(null);
      setIsModalOpen(true);
    });
  }

  // Fetches the next page of posts once the sentinel at the bottom of the feed list
  // scrolls into view, instead of a manual "load more" click.
  // A callback ref rather than a plain useRef+useEffect pair: the sentinel div only
  // exists in the DOM while hasMore is true AND the user has actually reached the feed
  // (it's conditionally rendered, gated behind view === "feed" further down) — neither
  // of which necessarily changes the *effect's own* dependencies (view, loadMore) at the
  // moment the div actually mounts (e.g. the hero-screen-to-feed transition is driven by
  // a separate hasSearched flag). A plain effect can end up creating its observer before
  // the div exists and then never re-running once it does. A callback ref instead fires
  // exactly when React attaches/detaches the node, so the observer is always created
  // against a real element.
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  const loadMoreSentinelRef = useCallback((node: HTMLDivElement | null) => {
    loadMoreObserverRef.current?.disconnect();
    if (!node) return;
    loadMoreObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMoreRef.current();
    });
    loadMoreObserverRef.current.observe(node);
  }, []);

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
          results.map((r) => ({
            type: "place" as const,
            name: r.name,
            placeType: r.placeType,
            countryCode: r.countryCode,
            bbox: r.bbox,
          })),
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
    // Nothing until the user actually types — an alphabetical wall of every country on
    // earth isn't a useful starting point. Prefix match rather than substring, so "un"
    // surfaces "United Arab Emirates" but not "Brunei" or "Hungary" (both merely contain
    // "un") — a search-as-you-type list should read top-to-bottom as "starts with what I
    // typed," not "contains it anywhere."
    if (q === "") return { countries: [], regions: [], cities: [], places: [] };
    const countries: SearchDestination[] = getAllCountries()
      .filter((c) => c.name.toLowerCase().startsWith(q))
      .slice(0, 8)
      .map((c) => ({ type: "country" as const, code: c.isoCode, name: c.name }));
    const regions: SearchDestination[] = REGIONS.filter((r) => r.toLowerCase().startsWith(q)).map((r) => ({
      type: "region" as const,
      name: r,
    }));
    const cities = allPostCities.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
    // Drop Mapbox suggestions that duplicate a country/city/region already surfaced locally.
    const knownNames = new Set(
      [...countries, ...regions, ...cities].map((d) => d.name.toLowerCase()),
    );
    const places = q.length < 2 ? [] : placeSuggestions.filter((p) => !knownNames.has(p.name.toLowerCase()));
    return { countries, regions, cities, places };
  }, [destinationQuery, allPostCities, placeSuggestions]);

  // Post-creation destination picker: same country/region search as the feed's
  // destination panel (see renderDestinationPanel), restricted to country/region rows
  // since cities are handled per-country below (see the "add specific places" reveal).
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
    Promise.all(posts.map((post) => getFeedMapPost(post))).then((results) => {
      if (!cancelled) setMapMarkers(results.filter((r): r is FeedMapPost => r !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [posts]);

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

  // Sharing is opt-in per post — checking the box with no number already on file
  // requires typing one in right there before the post can go out.
  function isContactStepValid(): boolean {
    return !form.shareContact || Boolean(myWhatsapp) || form.contactDraft.trim() !== "";
  }

  function isPostStepValid(step: 0 | 1 | 2): boolean {
    if (step === 0) return isDestinationStepValid();
    if (step === 1) return isDatesStepValid();
    return isContactStepValid();
  }

  function isFormValid(): boolean {
    return isDestinationStepValid() && isDatesStepValid() && isContactStepValid();
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

      (async () => {
        // A freshly-typed number needs saving to the profile before the post can
        // reference it — same RPC path used by onboarding/account settings.
        if (form.shareContact && !myWhatsapp && form.contactDraft.trim() !== "") {
          const { error: whatsappError } = await supabase.rpc("update_whatsapp", {
            p_whatsapp: form.contactDraft.trim(),
          });
          if (whatsappError) {
            setIsSavingPost(false);
            setPostError(whatsappError.message);
            return;
          }
          setMyWhatsapp(form.contactDraft.trim());
        }

        const input = { destinations, date, vibes: form.vibes, bio: form.bio, shareContact: form.shareContact };
        const error = editingPostId ? await editPost(editingPostId, input) : await addPost(input);
        setIsSavingPost(false);
        if (error) {
          setPostError(error);
          return;
        }
        resetForm();
        setEditingPostId(null);
        setIsModalOpen(false);
      })();
    });
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {/* Top Navigation Bar — only shown once the user has searched; first-run keeps just
          the big centered wordmark rendered in the hero block below (see !hasSearched). */}
      {hasSearched && (
        <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur-md">
          <TopNavBar
            view={view}
            switchToFeedView={switchToFeedView}
            switchToMapView={switchToMapView}
            showSavedOnly={showSavedOnly}
            setShowSavedOnly={setShowSavedOnly}
            currentUser={currentUser}
            unreadMessageCount={unreadMessageCount}
            router={router}
            showProfileMenu={showProfileMenu}
            setShowProfileMenu={setShowProfileMenu}
            profileMenuRef={profileMenuRef}
            logout={logout}
            onLogoClick={() =>
              withViewTransition(() => {
                clearStoredFeedScroll();
                setHasSearched(false);
              })
            }
          />

          <HeroSearch
            variant="compact"
            heroRef={heroRef}
            openHeroField={openHeroField}
            setOpenHeroField={setOpenHeroField}
            selectedDestinations={selectedDestinations}
            setSelectedDestinations={setSelectedDestinations}
            destinationQuery={destinationQuery}
            setDestinationQuery={setDestinationQuery}
            destinationResults={destinationResults}
            destinationKey={destinationKey}
            toggleSelectedDestination={toggleSelectedDestination}
            appliedDateSearch={appliedDateSearch}
            dateSearchDraft={dateSearchDraft}
            setDateSearchDraft={setDateSearchDraft}
            setAppliedDateSearch={setAppliedDateSearch}
            monthOptions={monthOptions}
            formatMonth={formatMonth}
            currentMonthKey={currentMonthKey}
            emptyDateSearch={EMPTY_DATE_SEARCH}
            getDateSearchLabel={getDateSearchLabel}
            hasMoreFiltersActive={hasMoreFiltersActive}
            clearMoreFilters={clearMoreFilters}
            vibeFilter={vibeFilter}
            setVibeFilter={setVibeFilter}
            genderFilter={genderFilter}
            setGenderFilter={setGenderFilter}
            ageMinFilter={ageMinFilter}
            setAgeMinFilter={setAgeMinFilter}
            ageMaxFilter={ageMaxFilter}
            setAgeMaxFilter={setAgeMaxFilter}
            tripStyles={TRIP_STYLES}
            genders={GENDERS}
          />
        </header>
      )}

      {/* Main content */}
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">
        {!hasSearched ? (
          <HeroSearch
            variant="full"
            heroRef={heroRef}
            openHeroField={openHeroField}
            setOpenHeroField={setOpenHeroField}
            selectedDestinations={selectedDestinations}
            setSelectedDestinations={setSelectedDestinations}
            destinationQuery={destinationQuery}
            setDestinationQuery={setDestinationQuery}
            destinationResults={destinationResults}
            destinationKey={destinationKey}
            toggleSelectedDestination={toggleSelectedDestination}
            appliedDateSearch={appliedDateSearch}
            dateSearchDraft={dateSearchDraft}
            setDateSearchDraft={setDateSearchDraft}
            setAppliedDateSearch={setAppliedDateSearch}
            monthOptions={monthOptions}
            formatMonth={formatMonth}
            currentMonthKey={currentMonthKey}
            emptyDateSearch={EMPTY_DATE_SEARCH}
            getDateSearchLabel={getDateSearchLabel}
            currentUser={currentUser}
            router={router}
            showProfileMenu={showProfileMenu}
            setShowProfileMenu={setShowProfileMenu}
            profileMenuRef={profileMenuRef}
            logout={logout}
            onSearch={() => withViewTransition(() => setHasSearched(true))}
          />
        ) : view === "feed" ? (
          <FeedList
            posts={posts}
            loading={loading}
            hasMore={hasMore}
            loadingMore={loadingMore}
            loadMoreSentinelRef={loadMoreSentinelRef}
            currentUser={currentUser}
            savedPostIds={savedPostIds}
            toggleSavedPost={toggleSavedPost}
            startEditPost={startEditPost}
            deletePost={deletePost}
            setViewPostId={setViewPostId}
            goToUserProfile={goToUserProfile}
            vibeStyles={VIBE_STYLES}
            initials={initials}
            formatGender={formatGender}
            getDateLabel={getDateLabel}
            getDestinationLabel={getDestinationLabel}
          />
        ) : (
          <FeedMapView
            mapMarkers={mapMarkers}
            activeFocusedMapPostId={activeFocusedMapPostId}
            setFocusedMapPostId={setFocusedMapPostId}
            focusedMapPost={focusedMapPost}
            setViewPostId={setViewPostId}
            goToUserProfile={goToUserProfile}
            initials={initials}
            getDateLabel={getDateLabel}
            getDestinationLabel={getDestinationLabel}
          />
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
      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingPostId={editingPostId}
        postStep={postStep}
        setPostStep={setPostStep}
        withViewTransition={withViewTransition}
        handleSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        postDestQuery={postDestQuery}
        setPostDestQuery={setPostDestQuery}
        postDestinationCards={postDestinationCards}
        isDestinationChosen={isDestinationChosen}
        toggleDestinationChoice={toggleDestinationChoice}
        removeDestinationEntry={removeDestinationEntry}
        citiesOptionsFor={citiesOptionsFor}
        addEntryCity={addEntryCity}
        toggleEntryCity={toggleEntryCity}
        getDestinationEntriesSummary={getDestinationEntriesSummary}
        monthOptions={monthOptions}
        currentMonthKey={currentMonthKey}
        formatMonth={formatMonth}
        getDateSearchLabel={getDateSearchLabel}
        toggleFormVibe={toggleFormVibe}
        tripStyles={TRIP_STYLES}
        myWhatsapp={myWhatsapp}
        isPostStepValid={isPostStepValid}
        isFormValid={isFormValid}
        isSavingPost={isSavingPost}
        postError={postError}
      />

      {/* Full-screen Post Detail View */}
      {viewPost && (
        <PostDetailView
          viewPost={viewPost}
          viewPostDestinationChips={viewPostDestinationChips}
          currentUser={currentUser}
          requireAuth={requireAuth}
          router={router}
          savedPostIds={savedPostIds}
          toggleSavedPost={toggleSavedPost}
          startEditPost={startEditPost}
          deletePost={deletePost}
          goToUserProfile={goToUserProfile}
          revealedContact={revealedContact}
          revealContact={revealContact}
          setRevealedContact={setRevealedContact}
          onClose={() => setViewPostId(null)}
          isTripMapOpen={isTripMapOpen}
          setIsTripMapOpen={setIsTripMapOpen}
          tripMapPoints={tripMapPoints}
          vibeStyles={VIBE_STYLES}
          initials={initials}
          formatGender={formatGender}
          formatRelativeTime={formatRelativeTime}
          getDateLabel={getDateLabel}
          getDestinationLabel={getDestinationLabel}
        />
      )}

      {viewUserId && (
        <UserProfileOverlay
          viewUserId={viewUserId}
          setViewUserId={setViewUserId}
          viewedProfile={viewedProfile}
          viewedProfileLoading={viewedProfileLoading}
          viewedUserPosts={viewedUserPosts}
          setViewPostId={setViewPostId}
          requireAuth={requireAuth}
          router={router}
          initials={initials}
          formatGender={formatGender}
          getDateLabel={getDateLabel}
          getDestinationLabel={getDestinationLabel}
        />
      )}
    </div>
  );
}
