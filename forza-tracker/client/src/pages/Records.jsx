import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatLap } from '../lib/format.js';

export default function Records() {
  const [records, setRecords] = useState([]);
  useEffect(() => { api.records().then(setRecords); }, []);

  return (
    <>
      <h1>Records</h1>
      <p className="subtitle">Crew best lap on every track that's ever been raced.</p>
      <div className="panel">
        {records.length === 0 ? <div className="empty">No lap times logged yet.</div> : (
          <table>
            <thead>
              <tr>
                <th>Track</th>
                <th>Discipline</th>
                <th>Holder</th>
                <th className="num">Best lap</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.track || '—'}</strong></td>
                  <td>{r.discipline ? <span className={`tag ${r.discipline}`}>{r.discipline}</span> : '—'}</td>
                  <td>
                    <span className="driver"><span className="dot" style={{ background: r.color }} />{r.display_name}</span>
                  </td>
                  <td className="num">{formatLap(r.best_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
