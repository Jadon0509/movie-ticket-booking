import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="navbar">
      <div className="container nav-inner">
        <Link to="/" className="brand">🎬 Yozigo Cinema</Link>
        <nav>
          <NavLink to="/" end>Movies</NavLink>
          {user && user.role === 'customer' && <NavLink to="/bookings">My bookings</NavLink>}
          {user?.role === 'admin' && (
            <>
              <NavLink to="/admin" end>Admin: Shows</NavLink>
              <NavLink to="/admin/movies">Admin: Movies</NavLink>
            </>
          )}
        </nav>
        <div className="nav-right">
          {user ? (
            <>
              <span className="muted">Hi, {user.name}{user.role === 'admin' ? ' (admin)' : ''}</span>
              <button className="btn small secondary" onClick={() => { logout(); nav('/'); }}>Log out</button>
            </>
          ) : (
            <>
              <Link className="btn small secondary" to="/login">Log in</Link>
              <Link className="btn small" to="/signup">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
