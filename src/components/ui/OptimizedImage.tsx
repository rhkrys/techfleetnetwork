/**
 * <OptimizedImage> — drop-in <img> replacement.
 *
 * - Emits <picture> with a <source type="image/webp"> when a sibling .webp
 *   exists (vite-plugin-image-optimizer convention: `foo.png` → `foo.png?as=webp`).
 * - Forces `loading="lazy"` + `decoding="async"` by default (override per-use).
 * - Requires explicit `width`/`height` for CLS safety (WCAG 2.4 / Web Vitals CLS).
 * - Falls back to plain <img> if no webp companion is provided.
 *
 * Usage:
 *   <OptimizedImage src={heroPng} webp={heroWebp} alt="..." width={1280} height={720} />
 *
 * Brand: Tech Fleet — never use `<img alt="">` for non-decorative imagery
 * (WCAG 1.1.1). Decorative images must pass `alt=""` explicitly.
 */
import { type ImgHTMLAttributes, forwardRef } from "react";

export interface OptimizedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** Required for CLS protection. */
  width: number;
  /** Required for CLS protection. */
  height: number;
  /** Required alt text — empty string for purely decorative imagery. */
  alt: string;
  /** Optional sibling WebP URL. When provided, rendered as <source> in <picture>. */
  webp?: string;
}

export const OptimizedImage = forwardRef<HTMLImageElement, OptimizedImageProps>(
  function OptimizedImage(
    { webp, src, alt, width, height, loading = "lazy", decoding = "async", ...rest },
    ref
  ) {
    const img = (
      <img
        ref={ref}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        {...rest}
      />
    );

    if (!webp) return img;

    return (
      <picture>
        <source type="image/webp" srcSet={webp} />
        {img}
      </picture>
    );
  }
);
