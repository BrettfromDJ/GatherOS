// AI proxy. The desktop app used to require BYOK (bring-your-own-key)
// for OpenAI features. With this proxy the Worker holds the master
// key and forwards requests on behalf of any session whose license is
// entitled. Usage is metered per-user-per-month into ai_usage_monthly,
// with a soft cap that warns but does not block (fail-open).
//
// Routes:
//   POST /ai/chat   { model, messages, response_format?, max_tokens? }
//   POST /ai/embed  { input, model? }
//   GET  /ai/usage   → { yyyymm, total_tokens, request_count, soft_cap, over_cap }

import { Hono, type Context } from 'hono';
import type { Env } from './types';
import { bearer, userFromSession } from './auth';

type AiContext = Context<{ Bindings: Env }>;

export const aiRoutes = new Hono<{ Bindings: Env }>();

// Soft monthly cap (combined chat + embedding tokens). Over the cap we
// keep serving requests but flag the response so the renderer can warn
// the user. Tuned for an "average" power user: ~2000 saves analyzed +
// many semantic searches stays comfortably under this.
const MONTHLY_TOKEN_CAP = 4_000_000;

// Image generation lives on a separate cost axis from chat / embed —
// per-image, not per-token. Tracked + capped independently so the two
// dimensions don't interfere. 30/month at medium quality covers
// everyday creative iteration without exposing the per-image cost
// curve that would let one user run up a noticeable bill.
const MONTHLY_IMAGE_CAP = 30;

// Allowlists keep the proxy from being abused as a generic OpenAI
// gateway. Anything not on these lists is rejected with 400.
const ALLOWED_CHAT_MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);
const ALLOWED_EMBED_MODELS = new Set(['text-embedding-3-small']);

const OPENAI_BASE = 'https://api.openai.com/v1';

type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';

const ENTITLED_SUB_STATUSES = new Set<SubscriptionStatus>([
  'active',
  'past_due',
  'trialing',
]);

function yyyymm(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

// Authenticated + entitled user, or a Response to return immediately.
async function requireEntitled(
  c: AiContext,
): Promise<{ userId: string } | Response> {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);

  const now = Date.now();
  const sub = await c.env.DB.prepare(
    `SELECT status FROM subscriptions
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
  )
    .bind(user.id)
    .first<{ status: SubscriptionStatus }>();
  const inTrial = user.trial_ends_at > now;
  const entitled = (sub && ENTITLED_SUB_STATUSES.has(sub.status)) || inTrial;
  if (!entitled) return c.json({ ok: false, error: 'not_entitled' }, 402);

  return { userId: user.id };
}

interface UsageRow {
  prompt_tokens: number;
  completion_tokens: number;
  embedding_tokens: number;
  total_tokens: number;
  request_count: number;
  image_count: number;
}

async function readUsage(
  env: Env,
  userId: string,
  bucket: string,
): Promise<UsageRow> {
  const row = await env.DB.prepare(
    `SELECT prompt_tokens, completion_tokens, embedding_tokens,
            total_tokens, request_count, image_count
       FROM ai_usage_monthly
      WHERE user_id = ? AND yyyymm = ?`,
  )
    .bind(userId, bucket)
    .first<UsageRow>();
  return (
    row || {
      prompt_tokens: 0,
      completion_tokens: 0,
      embedding_tokens: 0,
      total_tokens: 0,
      request_count: 0,
      image_count: 0,
    }
  );
}

async function recordImage(
  env: Env,
  userId: string,
  bucket: string,
): Promise<void> {
  const now = Date.now();
  // Same upsert pattern as recordUsage but bumping image_count
  // instead of token columns. token columns stay zero on this row
  // when an image generation is the only action — they accumulate
  // independently when chat/embed runs.
  await env.DB.prepare(
    `INSERT INTO ai_usage_monthly
       (user_id, yyyymm,
        prompt_tokens, completion_tokens, embedding_tokens,
        total_tokens, request_count, image_count, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, 1, 1, ?)
     ON CONFLICT(user_id, yyyymm) DO UPDATE SET
       request_count = request_count + 1,
       image_count   = image_count + 1,
       updated_at    = excluded.updated_at`,
  )
    .bind(userId, bucket, now)
    .run()
    .catch((err) => {
      console.error('[ai] recordImage failed:', err);
    });
}

async function recordUsage(
  env: Env,
  userId: string,
  bucket: string,
  delta: { prompt: number; completion: number; embedding: number },
): Promise<void> {
  const total = delta.prompt + delta.completion + delta.embedding;
  const now = Date.now();
  // Upsert: insert a fresh row at zero, then add the delta. SQLite
  // (D1) supports ON CONFLICT … DO UPDATE for primary-key collisions.
  await env.DB.prepare(
    `INSERT INTO ai_usage_monthly
       (user_id, yyyymm,
        prompt_tokens, completion_tokens, embedding_tokens,
        total_tokens, request_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, yyyymm) DO UPDATE SET
       prompt_tokens     = prompt_tokens     + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       embedding_tokens  = embedding_tokens  + excluded.embedding_tokens,
       total_tokens      = total_tokens      + excluded.total_tokens,
       request_count     = request_count     + 1,
       updated_at        = excluded.updated_at`,
  )
    .bind(
      userId,
      bucket,
      delta.prompt,
      delta.completion,
      delta.embedding,
      total,
      now,
    )
    .run()
    .catch((err) => {
      // Telemetry shouldn't break the request — log and move on.
      console.error('[ai] recordUsage failed:', err);
    });
}

aiRoutes.post('/chat', async (c) => {
  const auth = await requireEntitled(c);
  if (auth instanceof Response) return auth;

  type ChatBody = {
    model?: string;
    messages?: unknown;
    response_format?: unknown;
    max_tokens?: number;
  };
  const body: ChatBody = await c.req.json<ChatBody>().catch(() => ({}));

  const model = body.model || 'gpt-4o-mini';
  if (!ALLOWED_CHAT_MODELS.has(model)) {
    return c.json({ ok: false, error: 'model_not_allowed' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ ok: false, error: 'missing_messages' }, 400);
  }

  // Forward to OpenAI verbatim so the caller controls every field
  // (response_format, image_url detail, max_tokens, etc.) without the
  // proxy needing to know about each variant.
  const upstream = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      response_format: body.response_format,
      max_tokens: body.max_tokens,
    }),
  }).catch((err) => {
    console.error('[ai] chat upstream network error:', err);
    return null;
  });
  if (!upstream) return c.json({ ok: false, error: 'upstream_network' }, 502);

  const data = (await upstream.json().catch(() => ({}))) as {
    choices?: unknown;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    error?: { message?: string };
  };

  if (!upstream.ok) {
    return c.json(
      {
        ok: false,
        error: 'upstream_error',
        status: upstream.status,
        detail: data.error?.message,
      },
      502,
    );
  }

  const usage = data.usage || {};
  const bucket = yyyymm(Date.now());
  await recordUsage(c.env, auth.userId, bucket, {
    prompt: usage.prompt_tokens || 0,
    completion: usage.completion_tokens || 0,
    embedding: 0,
  });
  const after = await readUsage(c.env, auth.userId, bucket);

  return c.json({
    ok: true,
    choices: data.choices,
    usage: data.usage,
    quota: {
      total_tokens: after.total_tokens,
      soft_cap: MONTHLY_TOKEN_CAP,
      over_cap: after.total_tokens > MONTHLY_TOKEN_CAP,
    },
  });
});

aiRoutes.post('/embed', async (c) => {
  const auth = await requireEntitled(c);
  if (auth instanceof Response) return auth;

  type EmbedBody = { input?: string | string[]; model?: string };
  const body: EmbedBody = await c.req.json<EmbedBody>().catch(() => ({}));

  const model = body.model || 'text-embedding-3-small';
  if (!ALLOWED_EMBED_MODELS.has(model)) {
    return c.json({ ok: false, error: 'model_not_allowed' }, 400);
  }
  if (
    body.input == null ||
    (typeof body.input !== 'string' && !Array.isArray(body.input))
  ) {
    return c.json({ ok: false, error: 'missing_input' }, 400);
  }

  const upstream = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, input: body.input }),
  }).catch((err) => {
    console.error('[ai] embed upstream network error:', err);
    return null;
  });
  if (!upstream) return c.json({ ok: false, error: 'upstream_network' }, 502);

  const data = (await upstream.json().catch(() => ({}))) as {
    data?: unknown;
    usage?: { total_tokens?: number; prompt_tokens?: number };
    error?: { message?: string };
  };

  if (!upstream.ok) {
    return c.json(
      {
        ok: false,
        error: 'upstream_error',
        status: upstream.status,
        detail: data.error?.message,
      },
      502,
    );
  }

  // Embedding API reports usage as prompt_tokens (no completion).
  const tokens = data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0;
  const bucket = yyyymm(Date.now());
  await recordUsage(c.env, auth.userId, bucket, {
    prompt: 0,
    completion: 0,
    embedding: tokens,
  });
  const after = await readUsage(c.env, auth.userId, bucket);

  return c.json({
    ok: true,
    data: data.data,
    usage: data.usage,
    quota: {
      total_tokens: after.total_tokens,
      soft_cap: MONTHLY_TOKEN_CAP,
      over_cap: after.total_tokens > MONTHLY_TOKEN_CAP,
    },
  });
});

// Image generation. Forwarded to OpenAI's gpt-image-1, returned as
// base64 PNG. Quality is locked to 'medium' on the server side so a
// client can't ask for 'high' (which is ~4x more expensive); when /
// if we ever expose tier choice it'll be a separate authorised
// endpoint. Size is locked to 1024x1024 for the same reason.
aiRoutes.post('/image', async (c) => {
  const auth = await requireEntitled(c);
  if (auth instanceof Response) return auth;

  type ImageBody = {
    prompt?: string;
    // Optional source image as base64 (no data-url prefix). When
    // present, the worker routes to /v1/images/edits which produces
    // a true variation of the source — composition, palette, and
    // subject preserved. When absent, falls back to the text-to-image
    // /v1/images/generations endpoint.
    image_b64?: string;
    // Optional MIME type for the source image. Defaults to image/jpeg
    // since the desktop client downsizes via sharp before encoding.
    image_mime?: string;
  };
  const body: ImageBody = await c.req.json<ImageBody>().catch(() => ({}));

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return c.json({ ok: false, error: 'missing_prompt' }, 400);
  }
  if (prompt.length > 4000) {
    return c.json({ ok: false, error: 'prompt_too_long' }, 400);
  }

  const bucket = yyyymm(Date.now());
  // Cap is checked AFTER the request. Soft-fail: we serve the
  // generation but flag over_cap so the renderer can warn. Hard-stop
  // would feel punitive on a creative tool.

  let upstream: Response | null;
  if (body.image_b64) {
    // Image-to-image edit. multipart/form-data per OpenAI spec.
    const binary = atob(body.image_b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const mime = body.image_mime || 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const blob = new Blob([bytes], { type: mime });
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('quality', 'medium');
    form.append('n', '1');
    form.append('image', blob, `source.${ext}`);
    upstream = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.env.OPENAI_API_KEY}` },
      body: form,
    }).catch((err) => {
      console.error('[ai] image-edit upstream network error:', err);
      return null;
    });
  } else {
    // Pure text-to-image — kept as a fallback for callers that don't
    // have a source image (e.g. future "generate from prompt only").
    upstream = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      }),
    }).catch((err) => {
      console.error('[ai] image upstream network error:', err);
      return null;
    });
  }
  if (!upstream) return c.json({ ok: false, error: 'upstream_network' }, 502);

  const data = (await upstream.json().catch(() => ({}))) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };

  if (!upstream.ok) {
    return c.json(
      {
        ok: false,
        error: 'upstream_error',
        status: upstream.status,
        detail: data.error?.message,
      },
      502,
    );
  }

  const first = data.data?.[0];
  if (!first?.b64_json) {
    return c.json({ ok: false, error: 'upstream_response' }, 502);
  }

  await recordImage(c.env, auth.userId, bucket);
  const after = await readUsage(c.env, auth.userId, bucket);

  return c.json({
    ok: true,
    image: { b64_json: first.b64_json },
    quota: {
      image_count: after.image_count,
      image_soft_cap: MONTHLY_IMAGE_CAP,
      image_over_cap: after.image_count > MONTHLY_IMAGE_CAP,
    },
  });
});

aiRoutes.get('/usage', async (c) => {
  const auth = await requireEntitled(c);
  if (auth instanceof Response) return auth;

  const bucket = yyyymm(Date.now());
  const row = await readUsage(c.env, auth.userId, bucket);
  return c.json({
    ok: true,
    yyyymm: bucket,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    embedding_tokens: row.embedding_tokens,
    total_tokens: row.total_tokens,
    request_count: row.request_count,
    soft_cap: MONTHLY_TOKEN_CAP,
    over_cap: row.total_tokens > MONTHLY_TOKEN_CAP,
    image_count: row.image_count,
    image_soft_cap: MONTHLY_IMAGE_CAP,
    image_over_cap: row.image_count > MONTHLY_IMAGE_CAP,
  });
});
