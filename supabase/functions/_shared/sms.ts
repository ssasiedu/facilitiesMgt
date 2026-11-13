// SMS provider adapters: Hubtel (default), Arkesel and mNotify. Keys come from Edge Function secrets.
import { smsSegments } from "./render.ts";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  cost?: number;
  raw: unknown;
  error?: string;
}

export interface SmsAdapter {
  name: string;
  send(to: string, message: string, senderId: string): Promise<SendResult>;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export const hubtelSms: SmsAdapter = {
  name: "hubtel",
  async send(to, message, senderId) {
    const url = new URL("https://smsc.hubtel.com/v1/messages/send");
    url.searchParams.set("clientid", env("HUBTEL_CLIENT_ID"));
    url.searchParams.set("clientsecret", env("HUBTEL_CLIENT_SECRET"));
    url.searchParams.set("from", senderId);
    url.searchParams.set("to", to);
    url.searchParams.set("content", message);
    const res = await fetch(url, { method: "GET" });
    const raw = await readBody(res) as Record<string, unknown>;
    const ok = res.ok && (raw?.status === 0 || raw?.status === "0" || typeof raw?.messageId === "string");
    return { ok, messageId: (raw?.messageId as string) ?? undefined, cost: Number(raw?.rate ?? 0) || undefined, raw, error: ok ? undefined : `Hubtel ${res.status}` };
  },
};

export const arkeselSms: SmsAdapter = {
  name: "arkesel",
  async send(to, message, senderId) {
    const res = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: { "api-key": env("ARKESEL_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ sender: senderId, message, recipients: [to] }),
    });
    const raw = await readBody(res) as Record<string, unknown>;
    const ok = res.ok && raw?.status === "success";
    const data = (raw?.data as Array<Record<string, unknown>> | undefined)?.[0];
    return { ok, messageId: data?.id as string | undefined, raw, error: ok ? undefined : `Arkesel ${res.status}` };
  },
};

export const mnotifySms: SmsAdapter = {
  name: "mnotify",
  async send(to, message, senderId) {
    const res = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(env("MNOTIFY_API_KEY"))}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: [to], sender: senderId, message, is_schedule: false, schedule_date: "" }),
    });
    const raw = await readBody(res) as Record<string, unknown>;
    const ok = res.ok && (raw?.status === "success" || raw?.code === "2000");
    const summary = raw?.summary as Record<string, unknown> | undefined;
    return { ok, messageId: summary?._id as string | undefined, cost: Number(summary?.credit_used ?? 0) || undefined, raw, error: ok ? undefined : `mNotify ${res.status}` };
  },
};

export function smsAdapter(provider: string | undefined | null): SmsAdapter {
  switch ((provider ?? Deno.env.get("SMS_PROVIDER") ?? "hubtel").toLowerCase()) {
    case "arkesel": return arkeselSms;
    case "mnotify": return mnotifySms;
    default: return hubtelSms;
  }
}

export { smsSegments };
