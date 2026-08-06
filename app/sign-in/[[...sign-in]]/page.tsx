"use client";

import { useRouter } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { IconX } from "../../components/icons";

export default function SignInPage() {
  const router = useRouter();

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Cancel"
        className="fixed right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900 active:scale-95"
      >
        <IconX className="h-4 w-4" />
      </button>
      <div className="flex flex-col items-center gap-4">
        {/* Unmistakable "returning user" framing — Clerk's own copy inside the widget
            can be easy to skim past, so this sits above it as the headline. */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your existing TripHop account.</p>
        </div>
        <SignIn signUpUrl="/sign-up" />
      </div>
    </div>
  );
}
