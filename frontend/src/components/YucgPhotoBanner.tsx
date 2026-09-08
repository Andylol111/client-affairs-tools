type YucgPhotoBannerProps = {
  /** Path under /public, e.g. /yucg-bg/pauli-murray-tower.jpg */
  imageSrc: string;
  alt?: string;
  title?: string;
  subtitle?: string;
  /** hero = tall page header; strip = compact band */
  variant?: 'hero' | 'strip';
  className?: string;
};

/**
 * YUCG-style photo banner: campus/team imagery with Yale-blue tint (matches yaleconsulting.org).
 */
export default function YucgPhotoBanner({
  imageSrc,
  alt = '',
  title,
  subtitle,
  variant = 'hero',
  className = '',
}: YucgPhotoBannerProps) {
  const variantClass = variant === 'strip' ? 'yucg-photo-banner--strip' : 'yucg-photo-banner--hero';

  return (
    <div
      className={`yucg-photo-banner ${variantClass} ${className}`.trim()}
      style={{ ['--yucg-banner-image' as string]: `url(${imageSrc})` }}
      role={title ? 'region' : 'presentation'}
      aria-label={title || undefined}
    >
      {(title || subtitle) && (
        <div className="yucg-photo-banner__content">
          {title && <h2 className="yucg-photo-banner__title">{title}</h2>}
          {subtitle && <p className="yucg-photo-banner__subtitle">{subtitle}</p>}
        </div>
      )}
      {alt && !title && <span className="sr-only">{alt}</span>}
    </div>
  );
}
