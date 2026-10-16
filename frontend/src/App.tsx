import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './auth';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import MovieDetail from './pages/MovieDetail';
import { Login, Signup } from './pages/AuthPages';
import ShowBooking from './pages/ShowBooking';
import MyBookings from './pages/MyBookings';
import AdminShows from './pages/AdminShows';
import AdminMovies from './pages/AdminMovies';
import AdminShowDetail from './pages/AdminShowDetail';

/** Front-end guard. The backend enforces the same rules independently. */
function Protected({ children, admin }: { children: ReactElement; admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (admin && user.role !== 'admin')
    return <div className="card"><h2>Admins only</h2><p>You do not have access to this page.</p><Link to="/">Back to home</Link></div>;
  return children;
}

export default function App() {
  return (
    <>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/movies/:id" element={<MovieDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/shows/:id" element={<Protected><ShowBooking /></Protected>} />
          <Route path="/bookings" element={<Protected><MyBookings /></Protected>} />
          <Route path="/admin" element={<Protected admin><AdminShows /></Protected>} />
          <Route path="/admin/movies" element={<Protected admin><AdminMovies /></Protected>} />
          <Route path="/admin/shows/:id" element={<Protected admin><AdminShowDetail /></Protected>} />
          <Route path="*" element={<div className="card"><h2>Page not found</h2><Link to="/">Back to home</Link></div>} />
        </Routes>
      </main>
    </>
  );
}
