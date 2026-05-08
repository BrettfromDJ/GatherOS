import React from 'react';
import { Frame } from 'lucide-react';
import styles from './BoardGrid.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Boards are *scenes* — multiple images composed on a canvas — so
// the tile artwork is a 2x2 mosaic of the first image items, not the
// stacked fan we use for folders. Different visual idiom for a
// different conceptual object.
function BoardTile({ board, onClick, onContextMenu }) {
  const thumbs = Array.isArray(board.thumbs) ? board.thumbs.slice(0, 4) : [];
  const hasThumbs = thumbs.length > 0;
  return (
    <button
      type="button"
      className={styles.tile}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className={styles.tileArt}>
        {hasThumbs ? (
          <div
            className={`${styles.tileMosaic} ${styles[`tileMosaic${thumbs.length}`]}`}
            aria-hidden="true"
          >
            {thumbs.map((thumb, i) => (
              <img
                key={`${i}-${thumb}`}
                src={fileUrl(thumb)}
                className={styles.tileMosaicImg}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        ) : (
          <span className={styles.tileEmpty} aria-hidden="true">
            <Frame size={36} strokeWidth={1.4} />
          </span>
        )}
      </div>
      <div className={styles.tileMeta}>
        <span className={styles.tileName}>{board.name}</span>
      </div>
    </button>
  );
}

export default function BoardGrid({
  boards,
  onPickBoard,
  onCreateBoard,
  onContextMenu,
}) {
  if (!boards || boards.length === 0) {
    return (
      <div className={styles.empty}>
        <Frame size={36} strokeWidth={1.3} className={styles.emptyIcon} />
        <div className={styles.emptyTitle}>No boards yet</div>
        <div className={styles.emptyHint}>
          Boards are infinite canvases — drop images, sticky notes, and
          shapes anywhere you want.
        </div>
        {onCreateBoard && (
          <button
            type="button"
            className={styles.emptyAction}
            onClick={onCreateBoard}
          >
            Create your first board
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.scroll}>
      <div className={styles.grid}>
        {boards.map((board) => (
          <BoardTile
            key={board.id}
            board={board}
            onClick={() => onPickBoard(board.id)}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, board) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
