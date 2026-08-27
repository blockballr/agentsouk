function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// small rectangular editorial insert, always passed through the green duotone
// filter so every image reads as the same tonal family as the page
export function PhotoTile({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={cx(
        'duotone h-auto w-56 rounded-[14px] object-cover',
        className,
      )}
    />
  )
}