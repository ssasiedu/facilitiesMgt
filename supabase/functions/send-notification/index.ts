// send-notification: drains the notification outbox (called every minute by pg_cron through pg_net).
// Auth: header x-cron-secret = CRON_SECRET, or a Super Admin JWT (used by "Send test SMS" to flush immediately).
import { adminClient, getSettings } from "../_shared/admin.ts";
import { corsHeaders, errorResponse, json, preflight } from "../_shared/cors.ts";
import { getCaller, hasRole, safeEqual } from "../_shared/auth.ts";
import { smsAdapter, smsSegments } from "../_shared/sms.ts";
import { sendEmail, textToHtml } from "../_shared/email.ts";
import { renderTemplate } from "../_shared/render.ts";

interface OutboxRow {
  id: string;
  channel: "sms" | "email";
  recipient_phone: string | null;
  recipient_email: string | null;
  subject: string | null;
  body: string;
  variables: Record<string, unknown>;
  attempts: number;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Use POST", 405);

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  const authorised = (cronSecret && given && safeEqual(given, cronSecret)) || hasRole(await getCaller(req), "super_admin");
  if (!authorised) return errorResponse("Not authorised", 401);

  const admin = adminClient();
  const settings = await getSettings();
  const sms = smsAdapter(settings.sms_provider);
  const senderId = Deno.env.get("SMS_SENDER_ID") || settings.sms_sender_id;
  const summary = { processed: 0, sent: 0, failed: 0 };
  const started = Date.now();

  // keep draining in batches for up to ~45 seconds (the next cron tick picks up the rest)
  while (Date.now() - started < 45_000) {
    const { data: rows, error } = await admin.rpc("claim_notifications", { p_limit: 25 });
    if (error) return errorResponse(`claim_notifications: ${error.message}`, 500);
    const batch = (rows ?? []) as OutboxRow[];
    if (batch.length === 0) break;

    await Promise.all(batch.map(async (n) => {
      summary.processed++;
      const body = n.body || renderTemplate("", n.variables ?? {});
      try {
        if (n.channel === "sms") {
          if (!n.recipient_phone) throw new Error("No phone number");
          const seg = smsSegments(body);
          const r = await sms.send(n.recipient_phone, body, senderId);
          await admin.rpc("complete_notification", {
            p_id: n.id, p_success: r.ok, p_provider: sms.name, p_message_id: r.messageId ?? null, p_response: r.raw ?? null,
            p_cost: r.cost ?? null, p_segments: seg.segments, p_error: r.error ?? null,
          });
          r.ok ? summary.sent++ : summary.failed++;
        } else {
          if (!n.recipient_email) throw new Error("No email address");
          const r = await sendEmail({ to: n.recipient_email, subject: n.subject ?? settings.company_name, text: body,
            html: textToHtml(body, settings.brand_color, settings.company_name) }, settings.email_provider);
          await admin.rpc("complete_notification", {
            p_id: n.id, p_success: r.ok, p_provider: r.provider, p_message_id: r.messageId ?? null, p_response: r.raw ?? null,
            p_cost: null, p_segments: null, p_error: r.error ?? null,
          });
          r.ok ? summary.sent++ : summary.failed++;
        }
      } catch (e) {
        summary.failed++;
        await admin.rpc("complete_notification", {
          p_id: n.id, p_success: false, p_provider: n.channel === "sms" ? sms.name : settings.email_provider, p_message_id: null,
          p_response: null, p_cost: null, p_segments: null, p_error: (e as Error).message,
        });
      }
    }));
  }
  return json(summary, 200);
});

export { corsHeaders };
