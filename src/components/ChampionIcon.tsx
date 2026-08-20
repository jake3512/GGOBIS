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
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
