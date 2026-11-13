// Email adapters: Resend by default, SMTP as a fallback.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import type { SendResult } from "./sms.ts";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function textToHtml(text: string, brand = "#0F766E", company = ""): string {
  const body = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + brand + '">$1</a>').replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${brand};color:#fff;padding:16px 24px;font-weight:600;font-size:18px">${escapeHtml(company)}</td></tr>
<tr><td style="padding:24px;color:#1c1917;font-size:15px;line-height:1.6">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendResend(msg: EmailMessage): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!key || !from) return { ok: false, raw: null, error: "RESEND_API_KEY / EMAIL_FROM not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  const raw = await res.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: res.ok, messageId: raw?.id as string | undefined, raw, error: res.ok ? undefined : `Resend ${res.status}` };
}

async function sendSmtp(msg: EmailMessage): Promise<SendResult> {
  const host = Deno.env.get("SMTP_HOST");
  if (!host) return { ok: false, raw: null, error: "SMTP_HOST not set" };
  const client = new SMTPClient({
    connection: {
      hostname: host,
      port: Number(Deno.env.get("SMTP_PORT") ?? 465),
      tls: (Deno.env.get("SMTP_SECURE") ?? "true") === "true",
      auth: { username: Deno.env.get("SMTP_USER") ?? "", password: Deno.env.get("SMTP_PASS") ?? "" },
    },
  });
  try {
    await client.send({ from: Deno.env.get("EMAIL_FROM") ?? Deno.env.get("SMTP_USER") ?? "", to: msg.to, subject: msg.subject, content: msg.text, html: msg.html });
    return { ok: true, raw: { smtp: "sent" } };
  } catch (e) {
    return { ok: false, raw: null, error: `SMTP: ${(e as Error).message}` };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Sends with the configured provider and falls back to SMTP when Resend fails. */
export async function sendEmail(msg: EmailMessage, provider?: string | null): Promise<SendResult & { provider: string }> {
  const choice = (provider ?? Deno.env.get("EMAIL_PROVIDER") ?? "resend").toLowerCase();
  if (choice === "smtp") return { ...(await sendSmtp(msg)), provider: "smtp" };
  const first = await sendResend(msg);
  if (first.ok || !Deno.env.get("SMTP_HOST")) return { ...first, provider: "resend" };
  return { ...(await sendSmtp(msg)), provider: "smtp" };
}
