/**
 * Rigid horizontal tab menu (Outreach, Admin, Profile primary tabs).
 */
type Tab = { id: string; label: string };

type AppTabMenuProps = {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export default function AppTabMenu({ tabs, active, onChange, className = '' }: AppTabMenuProps) {
  return (
    <div className={`app-tab-menu ${className}`.trim()} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`app-tab-menu-item ${active === tab.id ? 'app-tab-menu-item--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
