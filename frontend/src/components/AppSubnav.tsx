/**
 * Rigid segmented sub-navigation (Scraper modes, Profile settings sections, etc.).
 */
type Item = { id: string; label: string };

type AppSubnavProps = {
  items: Item[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export default function AppSubnav({ items, active, onChange, className = '' }: AppSubnavProps) {
  return (
    <div className={`app-subnav ${className}`.trim()} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={`app-subnav-item ${active === item.id ? 'app-subnav-item--active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
