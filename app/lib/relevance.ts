type FocusedDateInfo = { mode: "focused"; startDate: string; endDate: string };
type BroadDateInfo = { mode: "broad"; months: string[] };
type FlexibleDateInfo = { mode: "flexible"; earliest: string; latest: string };
export type PostDate = FocusedDateInfo | BroadDateInfo | FlexibleDateInfo;

export type DateSearchInput =
  | { mode: "specific"; startDate: string; endDate: string }
  | { mode: "flexible"; months: string[] };

// ---------- Day / month arithmetic ----------

function dayIndex(dateStr: string): number {
  return Math.round(new Date(dateStr).getTime() / 86_400_000);
}

function inclusiveDayCount(start: string, end: string): number {
  return dayIndex(end) - dayIndex(start) + 1;
}

function overlapDays(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
}

function daysInMonth(ym: string): number {
  const [year, month] = ym.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function monthDayRange(ym: string): [number, number] {
  const start = dayIndex(`${ym}-01`);
  return [start, start + daysInMonth(ym) - 1];
}

function monthsToDayCount(months: string[]): number {
  return months.reduce((sum, ym) => sum + daysInMonth(ym), 0);
}

function overlapWithMonths(rangeStart: number, rangeEnd: number, months: string[]): number {
  return months.reduce((sum, ym) => {
    const [mStart, mEnd] = monthDayRange(ym);
    return sum + overlapDays(rangeStart, rangeEnd, mStart, mEnd);
  }, 0);
}

function windowToMonths(start: string, end: string): string[] {
  const months: string[] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  const endCursor = new Date(end);
  endCursor.setDate(1);
  while (cursor <= endCursor) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

// ---------- Scenario 1: user searched "Specific Dates" ----------

function scoreSpecificVsFocused(sStart: number, sEnd: number, dS: number, post: FocusedDateInfo): number {
  const pStart = dayIndex(post.startDate);
  const pEnd = dayIndex(post.endDate);
  const dP = inclusiveDayCount(post.startDate, post.endDate);
  const overlap = overlapDays(sStart, sEnd, pStart, pEnd);
  if (overlap === 0) return 0;

  const coverage = overlap / dS;
  const precision = overlap / dP;
  const base = 65 * coverage + 35 * precision;

  if (sStart === pStart && sEnd === pEnd) return base + 25; // exact match
  if (sStart >= pStart && sEnd <= pEnd) return base + 15; // S contained within P
  return base;
}

function scoreSpecificVsBroad(sStart: number, sEnd: number, dS: number, post: BroadDateInfo): number {
  const overlap = overlapWithMonths(sStart, sEnd, post.months);
  if (overlap === 0) return 0;

  const coverage = overlap / dS;
  const totalActiveDays = monthsToDayCount(post.months);
  const precision = overlap / totalActiveDays;
  const base = 65 * coverage + 35 * precision;
  return base - 10; // user wanted exact dates, post is month-bound
}

function scoreSpecificVsFlexible(sStart: number, sEnd: number, dS: number, post: FlexibleDateInfo): number {
  const wStart = dayIndex(post.earliest);
  const wEnd = dayIndex(post.latest);
  const windowLength = wEnd - wStart + 1;

  if (sStart >= wStart && sEnd <= wEnd) {
    const coverage = 1;
    const precision = 1 - Math.abs(dS - windowLength) / Math.max(dS, windowLength);
    const base = 65 * coverage + 35 * precision;
    return base + 15; // window containment bonus
  }

  const overlap = overlapDays(sStart, sEnd, wStart, wEnd);
  if (overlap === 0) return 0;

  const coverage = overlap / dS;
  const precision = overlap / windowLength;
  return 65 * coverage + 35 * precision;
}

function scoreSpecificSearch(search: { startDate: string; endDate: string }, post: PostDate): number {
  const sStart = dayIndex(search.startDate);
  const sEnd = dayIndex(search.endDate);
  const dS = inclusiveDayCount(search.startDate, search.endDate);

  if (post.mode === "focused") return scoreSpecificVsFocused(sStart, sEnd, dS, post);
  if (post.mode === "broad") return scoreSpecificVsBroad(sStart, sEnd, dS, post);
  return scoreSpecificVsFlexible(sStart, sEnd, dS, post);
}

// ---------- Scenario 2: user searched "Flexible / Months" ----------

function scoreFlexibleVsFocused(months: string[], post: FocusedDateInfo): number {
  const pStart = dayIndex(post.startDate);
  const pEnd = dayIndex(post.endDate);
  const dP = inclusiveDayCount(post.startDate, post.endDate);
  const overlapDaysCount = overlapWithMonths(pStart, pEnd, months);
  if (overlapDaysCount === 0) return 0;

  const coverage = overlapDaysCount / dP;
  const precision = 1;
  return 65 * coverage + 35 * precision;
}

function scoreFlexibleVsBroad(months: string[], post: BroadDateInfo): number {
  const shared = months.filter((m) => post.months.includes(m));
  if (shared.length === 0) return 0;

  const coverage = shared.length / months.length;
  const precision = shared.length / post.months.length;
  const base = 65 * coverage + 35 * precision;

  const sSet = new Set(months);
  const pSet = new Set(post.months);
  const exactMatch = sSet.size === pSet.size && [...sSet].every((m) => pSet.has(m));
  return exactMatch ? base + 20 : base;
}

function scoreFlexibleVsFlexible(months: string[], post: FlexibleDateInfo): number {
  const windowMonths = windowToMonths(post.earliest, post.latest);
  const shared = months.filter((m) => windowMonths.includes(m));
  if (shared.length === 0) return 0;

  const coverage = shared.length / months.length;
  const precision = 0.8;
  return 65 * coverage + 35 * precision;
}

function scoreFlexibleSearch(search: { months: string[] }, post: PostDate): number {
  if (search.months.length === 0) return 0;

  if (post.mode === "focused") return scoreFlexibleVsFocused(search.months, post);
  if (post.mode === "broad") return scoreFlexibleVsBroad(search.months, post);
  return scoreFlexibleVsFlexible(search.months, post);
}

// ---------- Public API ----------

export function hasActiveDateSearch(search: DateSearchInput): boolean {
  if (search.mode === "specific") return Boolean(search.startDate && search.endDate);
  return search.months.length > 0;
}

export function computeRelevanceScore(search: DateSearchInput, post: PostDate): number {
  if (search.mode === "specific") {
    if (!search.startDate || !search.endDate) return 0;
    return scoreSpecificSearch(search, post);
  }
  return scoreFlexibleSearch(search, post);
}

export function rankByRelevance<T>(items: T[], search: DateSearchInput, getDate: (item: T) => PostDate): T[] {
  return items
    .map((item) => ({ item, score: computeRelevanceScore(search, getDate(item)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
