import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

function useAuthForm(action: (f: Record<string, string>) => Promise<void>) {
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true); setError('');
    try {
      await action(form);
      nav((loc.state as any)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function Login() {
  const { login, user } = useAuth();
  const { error, busy, submit } = useAuthForm((f) => login(f.email, f.password));
  if (user) return <Navigate to="/" replace />;
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Log in</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
      <button className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="muted">New here? <Link to="/signup">Create an account</Link></p>
    </form>
  );
}

export function Signup() {
  const { signup, user } = useAuth();
  const { error, busy, submit } = useAuthForm((f) => signup(f.name, f.email, f.password));
  if (user) return <Navigate to="/" replace />;
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Create account</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <label>Name<input name="name" required maxLength={100} autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password" />
        <small className="muted">At least 8 characters</small></label>
      <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      <p className="muted">Already have an account? <Link to="/login">Log in</Link></p>
    </form>
  );
}
