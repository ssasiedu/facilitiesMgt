// Payment gateway adapters (Paystack and Hubtel). Both support Ghana Mobile Money and cards.
export interface CheckoutRequest {
  amount: number;          // GHS
  email: string | null;
  phone: string | null;
  reference: string;       // our idempotency reference
  description: string;
  callbackUrl: string;     // where the customer returns to
  webhookUrl: string;
  metadata: Record<string, unknown>;
}

export interface VerifiedPayment {
  reference: string;
  amount: number;          // GHS
  methodCode: string;      // payment_methods.code
  metadata: Record<string, unknown>;
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mapPaystackChannel(channel: string | undefined, bank: string | undefined): string {
  if (channel === "mobile_money") {
    const b = (bank ?? "").toUpperCase();
    if (b.includes("MTN")) return "mtn_momo";
    if (b.includes("VOD") || b.includes("TELECEL")) return "telecel_cash";
    if (b.includes("ATL") || b.includes("AIRTEL") || b.includes("TIGO")) return "at_money";
    return "mtn_momo";
  }
  if (channel === "bank" || channel === "bank_transfer") return "bank_transfer";
  return "card";
}

export const paystack = {
  async initialize(req: CheckoutRequest): Promise<string> {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set");
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: req.email ?? `customer+${req.reference}@example.com`, amount: Math.round(req.amount * 100), currency: "GHS",
        reference: req.reference, callback_url: req.callbackUrl, metadata: req.metadata, channels: ["mobile_money", "card", "bank_transfer"],
      }),
    });
    const body = await res.json() as { status: boolean; message: string; data?: { authorization_url: string } };
    if (!res.ok || !body.status || !body.data) throw new Error(`Paystack: ${body.message}`);
    return body.data.authorization_url;
  },
  async verifyWebhook(rawBody: string, signature: string | null): Promise<VerifiedPayment | null> {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret || !signature) return null;
    const expected = await hmacSha512Hex(secret, rawBody);
    if (expected !== signature) throw new Error("Invalid Paystack signature");
    const event = JSON.parse(rawBody) as { event: string; data: Record<string, unknown> };
    if (event.event !== "charge.success") return null;
    const d = event.data;
    const auth = d.authorization as Record<string, string> | undefined;
    return { reference: String(d.reference), amount: Number(d.amount) / 100, methodCode: mapPaystackChannel(String(d.channel), auth?.bank), metadata: (d.metadata as Record<string, unknown>) ?? {} };
  },
};

function hubtelAuth(): string {
  const id = Deno.env.get("HUBTEL_CLIENT_ID");
  const secret = Deno.env.get("HUBTEL_CLIENT_SECRET");
  if (!id || !secret) throw new Error("HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET are not set");
  return "Basic " + btoa(`${id}:${secret}`);
}

export const hubtelCheckout = {
  async initialize(req: CheckoutRequest): Promise<string> {
    const merchant = Deno.env.get("HUBTEL_MERCHANT_ACCOUNT");
    if (!merchant) throw new Error("HUBTEL_MERCHANT_ACCOUNT is not set");
    const res = await fetch("https://payproxyapi.hubtel.com/items/initiate", {
      method: "POST",
      headers: { Authorization: hubtelAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        totalAmount: Number(req.amount.toFixed(2)), description: req.description, callbackUrl: req.webhookUrl, returnUrl: req.callbackUrl,
        cancellationUrl: req.callbackUrl, merchantAccountNumber: merchant, clientReference: req.reference,
      }),
    });
    const body = await res.json() as { responseCode?: string; data?: { checkoutUrl: string }; message?: string };
    if (!res.ok || !body.data?.checkoutUrl) throw new Error(`Hubtel: ${body.message ?? res.status}`);
    return body.data.checkoutUrl;
  },
  /** Hubtel callbacks are not signed, so the transaction is confirmed with Hubtel's status API before it is recorded. */
  async verifyCallback(rawBody: string): Promise<VerifiedPayment | null> {
    const cb = JSON.parse(rawBody) as { Data?: { ClientReference?: string } };
    const ref = cb.Data?.ClientReference;
    const merchant = Deno.env.get("HUBTEL_MERCHANT_ACCOUNT");
    if (!ref || !merchant) return null;
    const res = await fetch(`https://api-txnstatus.hubtel.com/transactions/${merchant}/status?clientReference=${encodeURIComponent(ref)}`, {
      headers: { Authorization: hubtelAuth() },
    });
    const body = await res.json() as { data?: { status?: string; amount?: number; paymentMethod?: string } };
    if (!res.ok || body.data?.status?.toLowerCase() !== "paid") return null;
    const pm = (body.data.paymentMethod ?? "").toLowerCase();
    const methodCode = pm.includes("mtn") ? "mtn_momo" : pm.includes("vodafone") || pm.includes("telecel") ? "telecel_cash"
      : pm.includes("airtel") || pm.includes("tigo") ? "at_money" : pm.includes("card") ? "card" : "mtn_momo";
    return { reference: ref, amount: Number(body.data.amount ?? 0), methodCode, metadata: {} };
  },
};
