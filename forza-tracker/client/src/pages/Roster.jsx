import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Roster() {
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});

  useEffect(() => { api.users().then(setUsers); }, []);

  const setDraft = (id, patch) => setDrafts(d => ({ ...d, [id]: { ...users.find(u => u.id === id), ...d[id], ...patch } }));

  const save = async (id) => {
    const body = drafts[id];
    if (!body) return;
    const updated = await api.updateUser(id, {
      display_name: body.display_name,
      gamertag: body.gamertag,
      color: body.color,
    });
    setUsers(us => us.map(u => u.id === id ? updated : u));
    setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
  };

  return (
    <>
      <h1>Roster</h1>
      <p className="subtitle">Edit driver names, gamertags, and colors. Each driver's color shows up everywhere.</p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Color</th>
              <th>Display name</th>
              <th>Gamertag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const d = drafts[u.id];
              const dirty = !!d;
              return (
                <tr key={u.id}>
                  <td>
                    <input
                      type="color"
                      value={d?.color ?? u.color}
                      onChange={e => setDraft(u.id, { color: e.target.value })}
                      style={{ width: 40, height: 32, padding: 0, background: 'transparent', border: 'none' }}
                    />
                  </td>
                  <td>
                    <input
                      value={d?.display_name ?? u.display_name}
                      onChange={e => setDraft(u.id, { display_name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={d?.gamertag ?? u.gamertag}
                      onChange={e => setDraft(u.id, { gamertag: e.target.value })}
                    />
                  </td>
                  <td>
                    <button onClick={() => save(u.id)} disabled={!dirty}>Save</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
