type AvatarProps = {
  url?: string | null;
  initials: string;
  colorClass?: string;
  className?: string;
};

// Shared everywhere a user's avatar circle is rendered — a real photo (synced from
// Clerk's account photo, see AuthContext.tsx) when set, otherwise initials on a
// gradient. Plain <img> rather than next/image: avatars come from Clerk's own CDN
// (an arbitrary external host), which next/image would otherwise need configured
// via remotePatterns.
export default function Avatar({ url, initials, colorClass, className = "" }: AvatarProps) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        colorClass ?? "bg-gradient-to-br from-orange-400 to-pink-500"
      } ${className}`}
    >
      {initials}
    </div>
  );
}
