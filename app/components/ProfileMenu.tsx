import type { RefObject } from "react";
import type { useRouter } from "next/navigation";
import { IconLogOut, IconUser } from "./icons";
import Avatar from "./Avatar";
import type { AuthUser } from "../context/AuthContext";

export type ProfileMenuProps = {
  size: "sm" | "lg";
  currentUser: AuthUser | null;
  showProfileMenu: boolean;
  setShowProfileMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  router: ReturnType<typeof useRouter>;
  logout: () => void;
};

// Avatar + [My Profile, Log out] dropdown. Shared by the feed header and the hero, so
// tapping the avatar behaves identically on both surfaces (the hero used to jump
// straight to /profile). Only one of the two is mounted at a time (hasSearched), so
// they can safely share showProfileMenu / profileMenuRef.
export default function ProfileMenu({
  size,
  currentUser,
  showProfileMenu,
  setShowProfileMenu,
  profileMenuRef,
  router,
  logout,
}: ProfileMenuProps) {
  if (!currentUser) return null;
  const avatarSize = size === "lg" ? "h-10 w-10 text-sm" : "h-9 w-9 text-xs";
  return (
    <div ref={profileMenuRef} className="relative">
      <button
        type="button"
        aria-label="Profile"
        aria-haspopup="menu"
        aria-expanded={showProfileMenu}
        onClick={() => setShowProfileMenu((v) => !v)}
        className={`flex items-center justify-center overflow-hidden rounded-full bg-slate-100 font-bold text-slate-600 transition active:scale-95 active:bg-slate-200 ${avatarSize}`}
      >
        <Avatar url={currentUser.avatarUrl} initials={currentUser.avatar} className={avatarSize} />
      </button>

      {showProfileMenu && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-900">{currentUser.name}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setShowProfileMenu(false);
              router.push("/profile");
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <IconUser className="h-4 w-4 text-slate-400" />
            My Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              logout();
              setShowProfileMenu(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
          >
            <IconLogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
