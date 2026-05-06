// Tiny Resend wrapper. We avoid the `resend` npm package because it
// pulls in node-only deps; the REST API is two HTTP calls.
//
// In dev (RESEND_API_KEY = "stub") we log the email body to console
// instead of hitting Resend, so you can copy the magic-link URL out
// of `wrangler dev`'s output without configuring real email.

import type { Env } from './types';

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY === 'stub') {
    console.log('[email:stub] →', to, '|', subject);
    console.log(text || html);
    return { ok: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    return { ok: false, error: `resend ${r.status}: ${body}` };
  }
  return { ok: true };
}

export function magicLinkEmail(args: {
  appName: string;
  verifyUrl: string;
  expiresMinutes: number;
}): { subject: string; html: string; text: string } {
  const { appName, verifyUrl, expiresMinutes } = args;
  const subject = `Sign in to ${appName}`;
  const text = [
    `Click the link below to sign in to ${appName}:`,
    '',
    verifyUrl,
    '',
    `This link expires in ${expiresMinutes} minutes. If you didn't ask`,
    `to sign in, you can safely ignore this email.`,
  ].join('\n');
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 480px; margin: 40px auto; padding: 0 16px;">
  <h1 style="font-size: 18px; font-weight: 600;">Sign in to ${appName}</h1>
  <p>Click the button below to finish signing in. This link expires in ${expiresMinutes} minutes.</p>
  <p style="margin: 24px 0;">
    <a href="${verifyUrl}" style="display: inline-block; padding: 10px 18px; background: #0a0a0a; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500;">Open ${appName}</a>
  </p>
  <p style="color: #666; font-size: 13px;">If the button doesn't work, paste this into your browser:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
  <p style="color: #888; font-size: 12px; margin-top: 32px;">If you didn't ask to sign in, you can ignore this email.</p>
</body></html>`;
  return { subject, html, text };
}
