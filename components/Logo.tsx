export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand raster, not a content image
    <img src="/logo.png" alt="" className={`rounded-[22%] object-cover ${className}`} aria-hidden="true" />
  );
}
