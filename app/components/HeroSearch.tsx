import type { Dispatch, RefObject, SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import { IconCalendar, IconMapPin, IconPlus, IconSliders } from "./icons";
import DestinationPanel from "./DestinationPanel";
import DatesPanel from "./DatesPanel";
import ProfileMenu from "./ProfileMenu";
import type { AuthUser } from "../context/AuthContext";
import type { DateSearchUI, Gender, SearchDestination, TripVibe } from "../page";

type DestinationResults = {
  countries: SearchDestination[];
  regions: SearchDestination[];
  cities: SearchDestination[];
  places: SearchDestination[];
};

type OpenHeroField = "destination" | "dates" | "filters" | null;

type SharedProps = {
  heroRef: RefObject<HTMLDivElement | null>;
  openHeroField: OpenHeroField;
  setOpenHeroField: (value: OpenHeroField) => void;
  selectedDestinations: SearchDestination[];
  setSelectedDestinations: (value: SearchDestination[] | ((prev: SearchDestination[]) => SearchDestination[])) => void;
  destinationQuery: string;
  setDestinationQuery: (value: string) => void;
  destinationResults: DestinationResults;
  destinationKey: (d: SearchDestination) => string;
  toggleSelectedDestination: (dest: SearchDestination) => void;
  appliedDateSearch: DateSearchUI | null;
  dateSearchDraft: DateSearchUI;
  setDateSearchDraft: (value: DateSearchUI | ((prev: DateSearchUI) => DateSearchUI)) => void;
  setAppliedDateSearch: (value: DateSearchUI | null) => void;
  monthOptions: string[];
  formatMonth: (ym: string) => string;
  currentMonthKey: () => string;
  emptyDateSearch: DateSearchUI;
  getDateSearchLabel: (search: DateSearchUI | null) => string;
};

type CompactVariantProps = SharedProps & {
  variant: "compact";
  hasMoreFiltersActive: boolean;
  clearMoreFilters: () => void;
  vibeFilter: TripVibe | "All";
  setVibeFilter: Dispatch<SetStateAction<TripVibe | "All">>;
  genderFilter: Gender | "All";
  setGenderFilter: Dispatch<SetStateAction<Gender | "All">>;
  ageMinFilter: string;
  setAgeMinFilter: Dispatch<SetStateAction<string>>;
  ageMaxFilter: string;
  setAgeMaxFilter: Dispatch<SetStateAction<string>>;
  tripStyles: TripVibe[];
  genders: Gender[];
};

type FullVariantProps = SharedProps & {
  variant: "full";
  currentUser: AuthUser | null;
  router: ReturnType<typeof useRouter>;
  showProfileMenu: boolean;
  setShowProfileMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  logout: () => void;
  onSearch: () => void;
};

export type HeroSearchProps = CompactVariantProps | FullVariantProps;

// Destination/dates trigger buttons + their dropdown panels are shared between the
// compact sticky-header search bar (shown once the user has searched) and the large,
// centered first-run prompt (shown before that) — same behavior, different sizing, so
// the two surfaces can't drift apart.
function renderDestinationTrigger(size: "sm" | "lg", props: SharedProps) {
  const { openHeroField, setOpenHeroField, selectedDestinations } = props;
  const hasSelection = selectedDestinations.length > 0;
  const content = (
    <div
      className={`flex min-w-0 flex-1 items-center transition ${
        size === "lg" ? "border-b border-slate-100 sm:border-b-0 sm:border-r" : "border-r border-slate-100"
      } ${openHeroField === "destination" ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
    >
      <button
        type="button"
        onClick={() => setOpenHeroField(openHeroField === "destination" ? null : "destination")}
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
          onClick={() => setOpenHeroField("destination")}
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
  return content;
}

function renderDatesTrigger(size: "sm" | "lg", props: SharedProps) {
  const { openHeroField, setOpenHeroField, appliedDateSearch, setDateSearchDraft, getDateSearchLabel } = props;
  return (
    <button
      type="button"
      onClick={() => {
        if (openHeroField !== "dates") setDateSearchDraft(appliedDateSearch ?? props.emptyDateSearch);
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

function renderPanels(props: SharedProps) {
  const {
    openHeroField,
    selectedDestinations,
    setSelectedDestinations,
    destinationQuery,
    setDestinationQuery,
    destinationResults,
    destinationKey,
    toggleSelectedDestination,
    setOpenHeroField,
    dateSearchDraft,
    setDateSearchDraft,
    setAppliedDateSearch,
    monthOptions,
    formatMonth,
    currentMonthKey,
    emptyDateSearch,
  } = props;
  return (
    <>
      <DestinationPanel
        isOpen={openHeroField === "destination"}
        selectedDestinations={selectedDestinations}
        setSelectedDestinations={setSelectedDestinations}
        destinationQuery={destinationQuery}
        setDestinationQuery={setDestinationQuery}
        destinationResults={destinationResults}
        destinationKey={destinationKey}
        toggleSelectedDestination={toggleSelectedDestination}
        setOpenHeroField={setOpenHeroField}
      />
      <DatesPanel
        isOpen={openHeroField === "dates"}
        dateSearchDraft={dateSearchDraft}
        setDateSearchDraft={setDateSearchDraft}
        setAppliedDateSearch={setAppliedDateSearch}
        setOpenHeroField={setOpenHeroField}
        monthOptions={monthOptions}
        formatMonth={formatMonth}
        currentMonthKey={currentMonthKey}
        emptyDateSearch={emptyDateSearch}
      />
    </>
  );
}

function CompactHeroSearch(props: CompactVariantProps) {
  const {
    heroRef,
    openHeroField,
    setOpenHeroField,
    hasMoreFiltersActive,
    clearMoreFilters,
    vibeFilter,
    setVibeFilter,
    genderFilter,
    setGenderFilter,
    ageMinFilter,
    setAgeMinFilter,
    ageMaxFilter,
    setAgeMaxFilter,
    tripStyles,
    genders,
  } = props;
  return (
    // Hero Search
    <div ref={heroRef} className="relative mx-auto max-w-lg px-4 pb-3">
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 items-stretch overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          {renderDestinationTrigger("sm", props)}
          {renderDatesTrigger("sm", props)}
        </div>
        <button
          type="button"
          onClick={() => setOpenHeroField(openHeroField === "filters" ? null : "filters")}
          aria-label={hasMoreFiltersActive ? "More filters (active)" : "More filters"}
          className={`relative flex shrink-0 items-center justify-center rounded-2xl border px-3 transition ${
            openHeroField === "filters"
              ? "border-orange-300 bg-orange-50 text-orange-600"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <IconSliders className="h-4 w-4" />
          {hasMoreFiltersActive && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" />
          )}
        </button>
      </div>

      {renderPanels(props)}

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
            {tripStyles.map((vibe) => (
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
              {(["All", ...genders] as const).map((option) => (
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
  );
}

function FullHeroSearch(props: FullVariantProps) {
  const {
    heroRef,
    openHeroField,
    currentUser,
    router,
    showProfileMenu,
    setShowProfileMenu,
    profileMenuRef,
    logout,
    onSearch,
  } = props;
  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
      <div className="absolute inset-x-0 top-0 flex items-center justify-end gap-2">
        {currentUser ? (
          <ProfileMenu
            size="lg"
            currentUser={currentUser}
            showProfileMenu={showProfileMenu}
            setShowProfileMenu={setShowProfileMenu}
            profileMenuRef={profileMenuRef}
            router={router}
            logout={logout}
          />
        ) : (
          // Single auth entry point (/sign-in handles new accounts too), sized to match
          // the avatar pill it replaces once the user is logged in.
          <button
            type="button"
            onClick={() => router.push("/sign-in")}
            className="flex h-10 items-center rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition active:scale-95 active:bg-slate-200"
          >
            Log in
          </button>
        )}
      </div>
      <h1 style={{ viewTransitionName: "logo" }} className="text-5xl font-extrabold tracking-tight text-slate-900">
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
          {renderDestinationTrigger("lg", props)}
          {renderDatesTrigger("lg", props)}
        </div>

        {renderPanels(props)}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="w-full max-w-sm rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-orange-600"
      >
        Search trips
      </button>
    </div>
  );
}

export default function HeroSearch(props: HeroSearchProps) {
  if (props.variant === "compact") return <CompactHeroSearch {...props} />;
  return <FullHeroSearch {...props} />;
}
