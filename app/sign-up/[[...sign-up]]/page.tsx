"use client";

import { useRouter } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { IconX } from "../../components/icons";

export default function SignUpPage() {
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
        {/* Unmistakable "new account" framing — see sign-in's matching "Welcome back"
            headline; the two pages should never be confusable at a glance. */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">New to TripHop? Set up your account to start posting trips.</p>
        </div>
        <SignUp signInUrl="/sign-in" />
      </div>
    </div>
  );
}
