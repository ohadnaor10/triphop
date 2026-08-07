"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// The profile view itself lives as an overlay on the home page (see the "User Profile
// overlay" in app/page.tsx) rather than a route — a route change would unmount
// HomePageContent and lose hasSearched/filters/scroll, so "back" couldn't return to
// exactly where the visit started. This route exists only so a bookmarked or shared
// /users/<id> link still resolves: it forwards straight into the /?user=<id> overlay.
export default function UserProfileRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/?user=${id}`);
  }, [id, router]);

  return null;
}
