import { useNavigate, useLocation } from 'react-router-dom';

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === '/' || location.pathname === '/login') return null;

  return (
    <button
      onClick={() => navigate(-1)}
      className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-deep-navy dark:hover:text-[var(--text-primary)] font-medium text-sm mb-4 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}
