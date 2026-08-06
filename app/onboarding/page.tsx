"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";
import { calculateAge } from "../lib/calendar";
import { useClerkSupabaseClient } from "../lib/supabase/useClerkSupabaseClient";
import type { Gender } from "../page";

const MIN_AGE = 13;
const MAX_AGE = 120;

function isValidBirthDate(birthDate: string): boolean {
  if (!birthDate) return false;
  const age = calculateAge(birthDate);
  return age >= MIN_AGE && age <= MAX_AGE;
}

export default function OnboardingPage() {
  const { currentUser } = useAuth();
  const { openUserProfile } = useClerk();
  const supabase = useClerkSupabaseClient();
  const router = useRouter();
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [about, setAbout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isValid = gender !== "" && isValidBirthDate(birthDate);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentUser || !isValid) return;
    setIsSaving(true);
    setError(null);
    const { error } = await supabase.from("profiles").upsert({
      id: currentUser.id,
      name: currentUser.name,
      birth_date: birthDate,
      age: calculateAge(birthDate),
      gender,
      about: about.trim() || null,
    });
    setIsSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/");
  }

  if (!currentUser) return null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Set up your profile</h1>
        <p className="mt-1 text-sm text-slate-500">A few details so other travelers know who they&apos;re planning with.</p>

        <div className="mt-5 flex items-center gap-3">
          <Avatar url={currentUser.avatarUrl} initials={currentUser.avatar} className="h-14 w-14 text-lg" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{currentUser.name}</p>
            <button
              type="button"
              onClick={() => openUserProfile()}
              className="text-xs font-semibold text-orange-600 transition hover:text-orange-700 hover:underline"
            >
              {currentUser.avatarUrl ? "Change photo" : "Add a profile photo (optional)"}
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Birth date{birthDate && isValidBirthDate(birthDate) ? ` · Age ${calculateAge(birthDate)}` : ""}
            </label>
            <input
              type="date"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
              autoFocus
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Gender</label>
            <div className="flex gap-2">
              {(["Male", "Female"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setGender(option)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition ${
                    gender === option
                      ? "bg-orange-50 text-orange-700 ring-orange-500"
                      : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">About you (optional)</label>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="A short line about yourself for other travelers…"
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={!isValid || isSaving}
            className="mt-1 w-full rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isSaving ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
