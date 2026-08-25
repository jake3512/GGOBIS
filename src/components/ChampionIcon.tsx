export function ChampionIcon({
  src,
  name,
  className,
}: {
  src: string;
  name: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN icons, no next/image domain config needed
    <img
      src={src}
      alt={name}
      className={className}
      loading="lazy"
      // Data Dragon's rune-icon path in particular has been reported to
      // mishandle requests carrying a Referer from an unrecognized site
      // (returns a malformed response instead of a clean 4xx) — omitting
      // the Referer sidesteps that regardless of the exact cause.
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
