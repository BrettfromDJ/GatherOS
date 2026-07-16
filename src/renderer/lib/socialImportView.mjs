const TERMINAL_STAGES = new Set(['complete', 'stopped', 'failed']);
const ACTIVE_STAGES = new Set(['starting', 'scanning', 'saving', 'stopping']);

const PLATFORM_LABELS = {
  x: 'X',
  instagram: 'Instagram',
};

const MODE_LABELS = {
  'catch-up': 'Catch-up',
  fixed: 'Fixed count',
  all: 'All available',
};

const STAGE_LABELS = {
  starting: 'Starting import',
  scanning: 'Scanning',
  saving: 'Saving',
  stopping: 'Stopping after current item',
  complete: 'Import complete',
  stopped: 'Import stopped',
  failed: 'Import failed',
};

export function isTerminalStage(stage) {
  return TERMINAL_STAGES.has(stage);
}

export function isActiveStage(stage) {
  return ACTIVE_STAGES.has(stage);
}

export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || 'Social';
}

export function modeLabel(mode) {
  return MODE_LABELS[mode] || 'Import';
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || 'Importing';
}

export function pluralize(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainder).padStart(2, '0')}`
    : `${remainder}s`;
}

export function toSocialImportView(snapshot, {
  now = Date.now(),
  stalledAfterMs = 30_000,
} = {}) {
  if (!snapshot?.runId || !snapshot.platform) return null;
  const stage = snapshot.stage || 'starting';
  const startedAt = Number.isFinite(snapshot.startedAt) ? snapshot.startedAt : now;
  const lastUpdateAt = Number.isFinite(snapshot.lastProgressAt)
    ? snapshot.lastProgressAt
    : (Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : now);
  const terminal = isTerminalStage(stage);
  const elapsedMs = Math.max(0, now - startedAt);
  const stalled = !terminal && isActiveStage(stage)
    && (snapshot.stalled === true || now - lastUpdateAt >= stalledAfterMs);
  return {
    ...snapshot,
    stage,
    scanned: Math.max(0, Number(snapshot.scanned) || 0),
    saved: Math.max(0, Number(snapshot.saved) || 0),
    known: Math.max(0, Number(snapshot.known) || 0),
    failed: Math.max(0, Number(snapshot.failed) || 0),
    platformName: platformLabel(snapshot.platform),
    modeName: modeLabel(snapshot.mode),
    stageName: stageLabel(stage),
    elapsedMs,
    elapsed: formatElapsed(elapsedMs),
    stalled,
    terminal,
    headline: terminal
      ? stageLabel(stage)
      : `Importing ${platformLabel(snapshot.platform)}`,
  };
}

export const SOCIAL_IMPORT_TERMINAL_STAGES = TERMINAL_STAGES;
