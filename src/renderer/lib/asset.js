import { fileUrl } from './fileUrl.js';

// Resolve a save's image to a URL by logical *variant* rather than by a
// raw file path. This is the seam the whole storage roadmap rides on:
//
//   - today every variant resolves to a local `moodmark-file://` URL,
//   - once images are optimized, `preview` becomes a real medium render,
//   - once originals are offloaded to the cloud, only THIS function
//     changes (return an https:// signed URL) — every caller keeps
//     asking by id + variant and nothing else moves.
//
// Variants degrade gracefully so the entire existing library — which has
// only `thumb_path` + `file_path` and no `preview_path` yet — renders
// exactly as before:
//
//   thumb    → thumb  ▸ preview ▸ original
//   preview  → preview ▸ original ▸ thumb
//   original → original ▸ preview ▸ thumb
//
// `record` is a save row ({ file_path, thumb_path, preview_path }).
export function resolveAsset(record, variant = 'original') {
  if (!record) return null;
  const { file_path: original, thumb_path: thumb, preview_path: preview } = record;
  switch (variant) {
    case 'thumb':
      return fileUrl(thumb || preview || original);
    case 'preview':
      return fileUrl(preview || original || thumb);
    case 'original':
    default:
      return fileUrl(original || preview || thumb);
  }
}
