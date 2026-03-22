/**
 * Login page - shown when user is NOT authenticated.
 * Handles both the sign-in form and OAuth callback (?token=xxx).
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getBackendOriginForOAuth } from '../api';

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const error = searchParams.get('error');

  // OAuth callback: we have token in URL → store it and redirect to app root
  useEffect(() => {
    if (token) {
      localStorage.setItem('yucg_token', token);
      localStorage.setItem('yucg_token_time', String(Date.now()));
      const appRoot = import.meta.env.VITE_APP_URL || window.location.origin;
      window.location.replace(appRoot.replace(/\/$/, '') + '/');
      return;
    }
  }, [token]);

  const handleGoogleLogin = () => {
    window.location.href = `${getBackendOriginForOAuth()}/api/auth/google`;
  };

  // Still processing OAuth callback (token in URL, about to redirect)
  if (token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-2 border-deep-navy border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-600">Signing you in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md border border-pale-sky">
        <div className="flex justify-center mb-6">
          <img
            src="/yucg-logo.png"
            alt="YUCG"
            className="h-12 w-auto block outline-none select-none"
            decoding="async"
          />
        </div>
        <h1 className="text-2xl font-bold text-center text-deep-navy mb-2">YUCG Outreach</h1>
        <p className="text-center text-slate-600 text-sm mb-8">Yale Undergraduate Consulting Group</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error === 'invalid_callback' &&
              'Sign-in session expired or the server restarted during login. Try again. If this persists, ensure JWT_SECRET in backend/.env matches across restarts and GOOGLE_REDIRECT_URI matches Google Cloud Console.'}
            {error === 'token_exchange_failed' && 'Authentication failed. Please try again.'}
            {error === 'no_access_token' && 'Could not get access. Please try again.'}
            {error === 'userinfo_failed' && 'Could not load your profile. Please try again.'}
            {error === 'no_email' && 'No email from Google. Please use an account with email.'}
            {error === 'domain_not_allowed' && 'Only @yale.edu email addresses are allowed to sign in.'}
            {error === 'account_deactivated' && 'Your account has been deactivated. Contact an admin.'}
            {error === 'callback_failed' && (
              <>Server error during sign-in. Check the backend logs. {searchParams.get('detail') && <span className="block mt-1 text-xs">({decodeURIComponent(searchParams.get('detail') || '')})</span>}</>
            )}
            {error === 'oauth_not_configured' && (
              <>
                Google OAuth is not configured. Add to <code className="bg-slate-100 px-1 rounded">backend/.env</code>:
                <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-x-auto">
{`GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback`}
                </pre>
                Get credentials at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">Google Cloud Console</a>.
              </>
            )}
            {!['invalid_callback', 'token_exchange_failed', 'no_access_token', 'userinfo_failed', 'no_email', 'domain_not_allowed', 'oauth_not_configured', 'account_deactivated', 'callback_failed'].includes(error) && error}
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
          Secure login via Google. Only @yale.edu accounts.
        </p>

        <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Yale Duo verification</h3>
          <p className="text-xs text-slate-600 mb-2">
            @yale.edu accounts require Duo two-factor authentication. When you sign in, you may be prompted to verify via the Duo Mobile app, a phone call, or passcode.
          </p>
          <a
            href="https://mfa.its.yale.edu"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-steel-blue hover:text-deep-navy hover:underline font-medium"
          >
            Manage Duo devices → mfa.its.yale.edu
          </a>
        </div>
      </div>
    </div>
  );
}
