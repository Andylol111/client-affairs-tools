import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Scraper from './pages/Scraper';
import EmailStudio from './pages/EmailStudio';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Analytics from './pages/Analytics';
import Outreach from './pages/Outreach';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import LoginPage from './pages/LoginPage';
import MainApp from './pages/MainApp';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';

// In dev, use same-origin so Vite proxy forwards /api to backend
const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || 'http://localhost:8000');

function AppContent() {
  const [user, setUser] = useState<{ id?: number; email: string; name?: string; picture?: string; role?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Process OAuth callback immediately - token in URL means we just came back from Google
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (window.location.pathname === '/login' && token) {
      localStorage.setItem('yucg_token', token);
      localStorage.setItem('yucg_token_time', String(Date.now()));
      // Stay on current origin (avoids localhost vs 127.0.0.1 splitting localStorage). Override with VITE_APP_URL if needed.
      const appRoot = import.meta.env.VITE_APP_URL || window.location.origin;
      window.location.replace(appRoot.replace(/\/$/, '') + '/');
      return;
    }
  }, []);

  const checkAuth = () => {
    const token = localStorage.getItem('yucg_token');
    if (!token) {
      setAuthLoading(false);
      setUser(null);
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem('yucg_token');
        localStorage.removeItem('yucg_token_time');
        setUser(null);
      } else if (payload.email) {
        setUser({ email: payload.email, name: payload.name, picture: payload.picture, role: payload.role });
      }
    } catch {
      /* ignore */
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser({ ...data.user, role: data.user.role || 'standard' });
        } else {
          // API said not authenticated - fallback: trust JWT if valid (handles backend restart / JWT_SECRET change)
          const payload = (() => {
            try {
              const p = JSON.parse(atob(token.split('.')[1]));
              return p?.email && p?.exp && p.exp * 1000 > Date.now() ? p : null;
            } catch {
              return null;
            }
          })();
          if (payload) {
            setUser({ email: payload.email, name: payload.name, picture: payload.picture, role: payload.role || 'standard' });
          } else {
            localStorage.removeItem('yucg_token');
            localStorage.removeItem('yucg_token_time');
            setUser(null);
          }
        }
      })
      .catch(() => {
        // Network error or API unreachable - keep user from JWT if valid
        const token = localStorage.getItem('yucg_token');
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.email && payload.exp && payload.exp * 1000 > Date.now()) {
              setUser({ email: payload.email, name: payload.name, picture: payload.picture, role: payload.role || 'standard' });
            } else {
              setUser(null);
            }
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        setAuthLoading(false);
      });
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('yucg_token');
    localStorage.removeItem('yucg_token_time');
    setUser(null);
  };

  // Loading: show spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center max-w-md">
          <div className="animate-spin w-10 h-10 border-2 border-deep-navy border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
          <p className="text-xs text-slate-500 mt-4">
            If this hangs, the backend may not be running. From the project folder run:
          </p>
          <code className="block mt-2 p-3 bg-slate-200 rounded text-xs text-left overflow-x-auto">
            ./start-all.sh
          </code>
          <p className="text-xs text-slate-500 mt-2">
            Or: <code className="bg-slate-200 px-1 rounded">cd backend && source venv/bin/activate && uvicorn main:app --port 8000</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Login page - only when NOT authenticated */}
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      {/* All other routes - require auth, show MainApp */}
      <Route
        path="/*"
        element={
          user ? (
            <MainApp user={user} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="scraper" element={<Scraper />} />
        <Route path="studio" element={<EmailStudio />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/:id" element={<CampaignDetail />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="outreach" element={<Outreach />} />
        <Route path="admin" element={<Admin />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Navigate to="/profile?tab=settings" replace />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
