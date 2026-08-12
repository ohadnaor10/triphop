import { IconChevronLeft, IconSearch, IconWhatsApp, IconX } from "./icons";
import Combobox from "./Combobox";
import DateSearchFields from "./DateSearchFields";
import type { SubmitEvent } from "react";
import type { DateSearchUI, DestinationEntry, FormState, SearchDestination, TripVibe } from "../page";

export type CreatePostModalProps = {
  isOpen: boolean;
  onClose: () => void;
  editingPostId: string | null;
  postStep: 0 | 1 | 2;
  setPostStep: (updater: (s: 0 | 1 | 2) => 0 | 1 | 2) => void;
  withViewTransition: (fn: () => void) => void;
  handleSubmit: (e: SubmitEvent) => void;
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  postDestQuery: string;
  setPostDestQuery: (value: string) => void;
  postDestinationCards: SearchDestination[];
  isDestinationChosen: (item: SearchDestination) => boolean;
  toggleDestinationChoice: (item: SearchDestination) => void;
  removeDestinationEntry: (index: number) => void;
  citiesOptionsFor: (entry: Extract<DestinationEntry, { kind: "country" }>) => {
    cityOptions: { value: string; label: string }[];
  };
  addEntryCity: (index: number, city: string) => void;
  toggleEntryCity: (index: number, city: string) => void;
  getDestinationEntriesSummary: (entries: DestinationEntry[]) => string;
  monthOptions: string[];
  currentMonthKey: () => string;
  formatMonth: (ym: string) => string;
  getDateSearchLabel: (search: DateSearchUI | null) => string;
  toggleFormVibe: (vibe: TripVibe) => void;
  tripStyles: TripVibe[];
  myWhatsapp: string | null;
  isPostStepValid: (step: 0 | 1 | 2) => boolean;
  isFormValid: () => boolean;
  isSavingPost: boolean;
  postError: string | null;
};

// Multi-step slide-over for creating (or editing) a post: destination -> dates -> style/bio/contact.
export default function CreatePostModal({
  isOpen,
  onClose,
  editingPostId,
  postStep,
  setPostStep,
  withViewTransition,
  handleSubmit,
  form,
  setForm,
  postDestQuery,
  setPostDestQuery,
  postDestinationCards,
  isDestinationChosen,
  toggleDestinationChoice,
  removeDestinationEntry,
  citiesOptionsFor,
  addEntryCity,
  toggleEntryCity,
  getDestinationEntriesSummary,
  monthOptions,
  currentMonthKey,
  formatMonth,
  getDateSearchLabel,
  toggleFormVibe,
  tripStyles,
  myWhatsapp,
  isPostStepValid,
  isFormValid,
  isSavingPost,
  postError,
}: CreatePostModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 sm:h-[85dvh] sm:max-w-lg sm:rounded-3xl sm:shadow-2xl">
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          {/* Step header: back/close + progress dots */}
          <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3 sm:pt-4">
            <button
              type="button"
              onClick={() =>
                postStep === 0 ? onClose() : withViewTransition(() => setPostStep((s) => (s - 1) as 0 | 1 | 2))
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
                  <div className="flex flex-col gap-1">
                    {postDestinationCards.map((d) => (
                      <button
                        key={`${d.type}:${d.type === "country" ? d.code : d.name}`}
                        type="button"
                        onClick={() => toggleDestinationChoice(d)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                          isDestinationChosen(d)
                            ? "bg-orange-500/20 text-orange-300 ring-1 ring-inset ring-orange-400/40"
                            : "text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
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
                    {tripStyles.map((vibe) => (
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

                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={form.shareContact}
                      onChange={(e) => setForm((p) => ({ ...p, shareContact: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/30 bg-white/10 accent-emerald-500"
                    />
                    <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                      <IconWhatsApp className="h-3.5 w-3.5 text-emerald-400" />
                      Share my WhatsApp number on this post
                    </span>
                  </label>

                  {form.shareContact && !myWhatsapp && (
                    <div className="mt-2.5 border-t border-white/10 pt-2.5">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        You haven&apos;t added a number yet — enter one to share it here
                      </label>
                      <input
                        type="tel"
                        value={form.contactDraft}
                        onChange={(e) => setForm((p) => ({ ...p, contactDraft: e.target.value }))}
                        placeholder="e.g. +1 555 000 1111"
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30"
                      />
                      <p className="mt-1 text-[11px] text-slate-400">
                        Saved to your profile too, so you won&apos;t need to enter it again next time.
                      </p>
                    </div>
                  )}
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
  );
}
