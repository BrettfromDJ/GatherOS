// Tiny pending-adds queue for "Add to space" actions that fire while
// the user is NOT viewing the target board. App pushes here and
// navigates to the board; BoardView consumes the queue on mount and
// dispatches the regular moodmark:add-saves-to-board event so the
// placement logic stays in one place (viewport-centred drop).

let pending = [];
const listeners = new Set();

export function pushPending(boardId, ids) {
  pending.push({ boardId, ids });
  listeners.forEach((fn) => fn());
}

export function consumePending(boardId) {
  const taken = pending.filter((p) => p.boardId === boardId);
  pending = pending.filter((p) => p.boardId !== boardId);
  return taken;
}
