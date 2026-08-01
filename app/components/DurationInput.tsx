"use client";

export type DurationUnit = "Days" | "Weeks" | "Months";
export type DurationValue = { amount: string; unit: DurationUnit };

export const DURATION_UNITS: DurationUnit[] = ["Days", "Weeks", "Months"];
const UNITS = DURATION_UNITS;

export default function DurationInput({
  value,
  onChange,
  label = "Optional: trip duration",
}: {
  value: DurationValue;
  onChange: (value: DurationValue) => void;
  label?: string | null;
}) {
  return (
    <div>
      {label && <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>}
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          placeholder="e.g. 10"
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />
        <select
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as DurationUnit })}
          className="shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
