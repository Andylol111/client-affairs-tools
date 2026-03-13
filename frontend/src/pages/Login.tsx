import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// In dev, use same-origin so Vite proxy forwards /api to backend
const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || 'http://localhost:8000');

function BackToApp() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/')}
      className="absolute top-4 left-4 flex items-center gap-2 text-slate-600 hover:text-deep-navy font-medium text-sm"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

type LoginProps = {
  user: { email: string; name?: string; picture?: string } | null;
  onAuthChecked: boolean;
  onLoginSuccess?: (user: { email: string; name?: string; picture?: string }) => void;
};

export default function Login({ user, onAuthChecked, onLoginSuccess }: LoginProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const error = searchParams.get('error');

  useEffect(() => {
    if (token) {
      localStorage.setItem('yucg_token', token);
      localStorage.setItem('yucg_token_time', String(Date.now()));
      // Parse user from JWT so Welcome shows immediately after redirect
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.email) {
          onLoginSuccess?.({
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
          });
        }
      } catch {
        /* ignore */
      }
      window.history.replaceState({}, '', '/');
      navigate('/', { replace: true });
      window.dispatchEvent(new CustomEvent('yucg-login', { detail: { token } }));
    }
  }, [token, navigate, onLoginSuccess]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE}/api/auth/google`;
  };

  // Already logged in: show welcome and option to go to app
  if (onAuthChecked && user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 relative">
        <BackToApp />
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
              <img src="/yucg-logo.png" alt="YUCG" className="h-12 w-auto" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-deep-navy mb-2">Welcome back, {user.name || user.email?.split('@')[0] || 'User'}!</h1>
          <p className="text-center text-slate-600 text-sm mb-6">You are logged in.</p>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 rounded-lg bg-[#1a2f5a] hover:bg-[#1e3a6e] text-white font-medium transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 relative">
      <BackToApp />
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md border border-slate-200">
        <div className="flex justify-center mb-6">
          <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
            <img src="/yucg-logo.png" alt="YUCG" className="h-12 w-auto" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-deep-navy mb-2">YUCG Outreach</h1>
        <p className="text-center text-slate-600 text-sm mb-8">Yale Undergraduate Consulting Group</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error === 'invalid_callback' && 'Invalid login attempt. Please try again.'}
            {error === 'token_exchange_failed' && 'Authentication failed. Please try again.'}
            {error === 'no_access_token' && 'Could not get access. Please try again.'}
            {error === 'userinfo_failed' && 'Could not load your profile. Please try again.'}
            {error === 'no_email' && 'No email from Google. Please use an account with email.'}
            {error === 'domain_not_allowed' && 'Only @yale.edu email addresses are allowed to sign in.'}
            {error === 'oauth_not_configured' && (
              <>
                Google OAuth is not configured. Add to <code className="bg-slate-100 px-1 rounded">backend/.env</code>:
                <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-x-auto">
{`GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback`}
                </pre>
                Get credentials at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">Google Cloud Console</a> → Create OAuth 2.0 Client ID (Web application) → Add redirect URI above.
              </>
            )}
            {!['invalid_callback', 'token_exchange_failed', 'no_access_token', 'userinfo_failed', 'no_email', 'domain_not_allowed', 'oauth_not_configured'].includes(error) && error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-medium text-slate-800 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        <p className="mt-6 text-center text-xs text-slate-500">
          Secure login via Google. Your credentials are never stored.
        </p>
        <p className="mt-2 text-center text-xs text-amber-600">
          If you see &quot;Waiting for localhost&quot;, run: <code className="bg-slate-100 px-1 rounded text-xs">cd backend && source venv/bin/activate && python -m uvicorn main:app --reload --port 8000</code>
        </p>
      </div>
    </div>
  );
}
