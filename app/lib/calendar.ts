export function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function calculateAge(birthDateISO: string): number {
  const birth = new Date(birthDateISO);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toISO(year, month, day));
  }
  return cells;
}

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export type DateRange = { startDate: string; endDate: string };

export function pickRangeDate(current: DateRange, iso: string): DateRange {
  const { startDate, endDate } = current;
  if (!startDate || (startDate && endDate)) {
    return { startDate: iso, endDate: "" };
  }
  if (iso < startDate) {
    return { startDate: iso, endDate: "" };
  }
  return { startDate, endDate: iso };
}
