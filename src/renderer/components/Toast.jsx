import React from 'react';
import styles from './Toast.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Editorial "saved to library" toast. Two-line receipt card with a
// stacked thumbnail cluster (the most recent save front-most, earlier
// ones fanned behind) and an inline Undo.
//
//   records — the saves in this toast session, most-recent-first. The
//             cluster shows up to three; Undo trashes all of them.
//   count   — total saved this session (drives the label + subtitle).
//
// When `records` is empty the pill renders as an empty dark shell. The
// toast window stays mounted at opacity 0 between toasts; the shell keeps
// the dark glass material visible the instant opacity flips to 1, so we
// never see raw light-mode vibrancy through the show → render gap.
export default function Toast({ records = [], count = 1, onUndo, onOpen }) {
  if (!records.length) {
    return <div className={styles.toast} aria-hidden="true" />;
  }

  const multi = count > 1;
  const lead = records[0];
  // Up to three covers. Render back-to-front so the most recent save
  // (index 0 → .c0) paints on top of the older ones behind it.
  const covers = records.slice(0, 3).map((r, i) => ({ r, i })).reverse();
  const title = multi ? `Saved ${count} to library` : 'Saved to library';
  const sub = multi ? `${count} images · just now` : '1 image · just now';

  return (
    <div className={styles.toast} role="status">
      {/* The whole pill opens the most recent save — cluster + text are
          one big click target. Undo stays a separate button beside it. */}
      <button
        type="button"
        className={styles.openArea}
        onClick={() => onOpen?.(lead)}
        aria-label="Open most recent save"
      >
        <span className={`${styles.cluster}${multi ? '' : ` ${styles.clusterSingle}`}`}>
          {covers.map(({ r, i }) => (
            <img
              key={r.id}
              src={fileUrl(r.thumb_path)}
              className={`${styles.cover} ${styles[`c${i}`]}`}
              alt=""
            />
          ))}
        </span>

        <span className={styles.body}>
          <span className={styles.h}>{title}</span>
          <span className={styles.s}>{sub}</span>
        </span>
      </button>

      <button type="button" className={styles.undo} onClick={() => onUndo?.()}>
        Undo
      </button>
    </div>
  );
}
