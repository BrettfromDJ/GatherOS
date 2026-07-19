// Maps AI-proxy error reasons into friendly, user-facing copy.
//
// Every AI IPC handler returns { ok: false, reason, detail } on
// failure, where `reason` is the proxy's machine code (e.g.
// 'not_entitled') and `detail` is the raw "AI proxy <reason>" string.
// Surfacing `detail` directly leaks codes like "AI proxy not_entitled"
// into the UI — which is exactly what an out-of-trial user hits when
// they click auto-tag, since the buttons only gate on "is there a
// session", not "is the license still entitled". Translate the known
// reasons here so the copy stays friendly (and sentence case).

const MESSAGES = {
  // Trial ended / subscription lapsed. The session token is still
  // valid so the app runs, but the proxy declines AI calls (402).
  not_entitled:
    'Your trial has ended — subscribe in Settings to keep using AI features.',
  // Session missing or revoked (401). Shouldn't normally reach a
  // signed-in user, but covers a revoked session mid-use.
  unauthenticated: 'Sign in again to use AI features.',
  // Monthly token cap for chat / embed (429).
  monthly_cap_reached:
    "You've reached this month's AI limit. It resets at the start of next month.",
  // Upstream OpenAI hiccup (502) — transient, retry-friendly.
  upstream_error: 'The AI service is temporarily unavailable. Try again in a moment.',
  upstream_network: 'The AI service is temporarily unavailable. Try again in a moment.',
  upstream_response: 'The AI service returned an unexpected response. Try again in a moment.',
};

// Resolve a friendly message for a failed AI call. `fallback` is the
// feature-specific default (e.g. 'Could not generate tags'); we prefer
// a mapped message, then the fallback, and only fall back to `detail`
// as a last resort so raw codes never surface on their own.
export function aiErrorMessage(reason, { fallback, detail } = {}) {
  if (reason && MESSAGES[reason]) return MESSAGES[reason];
  return fallback || detail || 'Something went wrong. Try again.';
}
