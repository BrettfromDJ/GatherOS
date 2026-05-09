import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.users().then(setUsers).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!userId) return setError('Pick a driver.');
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(userId, passcode);
      onLogin(user);
    } catch (e) {
      setError('Wrong passcode.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>Forza Tracker</h1>
        <p>Pick your driver and enter the crew passcode.</p>
        <div className="users">
          {users.map(u => (
            <label key={u.id} className={`user-pick ${userId === u.id ? 'selected' : ''}`}>
              <input
                type="radio"
                name="user"
                style={{ display: 'none' }}
                checked={userId === u.id}
                onChange={() => setUserId(u.id)}
              />
              <span className="dot" style={{ background: u.color }} />
              <div style={{ flex: 1 }}>
                <div>{u.display_name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{u.gamertag}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="field">
          <label>Passcode</label>
          <input
            type="password"
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div style={{ color: 'var(--bad)', marginTop: 12, fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
          {busy ? 'Checking…' : 'Enter the lobby'}
        </button>
      </form>
    </div>
  );
}
