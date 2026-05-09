async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (userId, passcode) => request('/api/auth/login', { method: 'POST', body: { userId, passcode } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  users: () => request('/api/users'),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PATCH', body }),

  seasons: () => request('/api/seasons'),
  createSeason: (body) => request('/api/seasons', { method: 'POST', body }),
  updateSeason: (id, body) => request(`/api/seasons/${id}`, { method: 'PATCH', body }),
  standings: (id) => request(`/api/seasons/${id}/standings`),

  tracks: () => request('/api/tracks'),
  createTrack: (body) => request('/api/tracks', { method: 'POST', body }),

  races: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/races${q ? `?${q}` : ''}`);
  },
  createRace: (body) => request('/api/races', { method: 'POST', body }),
  deleteRace: (id) => request(`/api/races/${id}`, { method: 'DELETE' }),

  records: () => request('/api/stats/records'),
};
