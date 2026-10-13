import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../state';
import { Logo } from '../components/ui';
import { ThemeToggle } from '../themes/ThemeToggle'; // design experiment (temporary)

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (signup && password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { user } = signup ? await api.signup(email, password) : await api.login(email, password);
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-theme"><ThemeToggle /></div> {/* design experiment (temporary) */}
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <Logo size={32} />
          <span>Georgie Flashcards</span>
        </div>
        <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="sub">{signup ? 'Your folders and cards are saved to your account.' : 'Log in to keep studying.'}</p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {signup && <span className="muted small">At least 8 characters.</span>}
        </div>
        {signup && (
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
        </button>
        <div className="auth-switch">
          {signup ? (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
