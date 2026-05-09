import React, { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api } from './lib/api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Races from './pages/Races.jsx';
import LogRace from './pages/LogRace.jsx';
import Seasons from './pages/Seasons.jsx';
import Roster from './pages/Roster.jsx';
import Records from './pages/Records.jsx';

const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty">loading…</div>;

  return (
    <SessionContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onLogin={setUser} />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/races" element={<Races />} />
          <Route path="/log" element={<LogRace />} />
          <Route path="/seasons" element={<Seasons />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/records" element={<Records />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}

function Layout() {
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const logout = async () => {
    await api.logout();
    setUser(null);
    nav('/login');
  };
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Forza Tracker
          <small>Horizon 6 — Crew of 4</small>
        </div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/races">Race History</NavLink>
        <NavLink to="/log">Log a Race</NavLink>
        <NavLink to="/records">Records</NavLink>
        <NavLink to="/seasons">Seasons</NavLink>
        <NavLink to="/roster">Roster</NavLink>
        <div className="me">
          <span className="dot" style={{ background: user.color }} />
          <div style={{ flex: 1, lineHeight: 1.2 }}>
            <div style={{ color: 'var(--text)', fontSize: 13 }}>{user.display_name}</div>
            <div style={{ fontSize: 11 }}>{user.gamertag}</div>
          </div>
          <button className="ghost" onClick={logout} title="Log out">↩</button>
        </div>
      </aside>
      <main className="main">
        <RouterOutlet />
      </main>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
function RouterOutlet() { return <Outlet />; }
