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

/**
 * The Sales API keys, which are NOT the SMS keys. HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET are
 * the Programmable SMS credentials and are deliberately not accepted here: Hubtel answers them
 * with a bare 401 on the checkout endpoint, which is a miserable thing to have to diagnose.
 */
function hubtelAuth(): string {
  const id = Deno.env.get("HUBTEL_API_ID");
  const secret = Deno.env.get("HUBTEL_API_KEY");
  if (!id || !secret) {
    throw new Error(
      "HUBTEL_API_ID and HUBTEL_API_KEY are not set. These are the Sales API keys, created under " +
      "Manage > Programmable Integrations, and are different from the SMS keys.",
    );
  }
  return "Basic " + btoa(`${id}:${secret}`);
}

/** Read a response without assuming it is JSON: an auth failure often carries no body at all. */
async function readJson(res: Response): Promise<{ parsed: Record<string, unknown> | null; text: string }> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return { parsed: null, text: "" };
  try { return { parsed: JSON.parse(text) as Record<string, unknown>, text }; } catch { return { parsed: null, text }; }
}

/** Hubtel names the wallet in PaymentDetails.Channel, e.g. mtn-gh, vodafone-gh, tigo-gh. */
function mapHubtelChannel(channel: string | undefined, paymentType: string | undefined): string {
  const c = (channel ?? "").toLowerCase();
  if (c.startsWith("mtn")) return "mtn_momo";
  if (c.startsWith("vodafone") || c.startsWith("telecel")) return "telecel_cash";
  if (c.startsWith("tigo") || c.startsWith("airtel") || c.startsWith("at")) return "at_money";
  const t = (paymentType ?? "").toLowerCase();
  if (t.includes("card")) return "card";
  if (t.includes("mobilemoney")) return "mtn_momo";
  return "card";
}

/** The documented shape of the Online Checkout callback. */
interface HubtelCallback {
  ResponseCode?: string;
  Status?: string;
  Data?: {
    CheckoutId?: string;
    SalesInvoiceId?: string;
    ClientReference?: string;
    Status?: string;
    Amount?: number;
    CustomerPhoneNumber?: string;
    PaymentDetails?: { MobileMoneyNumber?: string; PaymentType?: string; Channel?: string };
    Description?: string;
  };
}

export const hubtelCheckout = {
  /**
   * Open a hosted checkout and return the URL to send the customer to. This endpoint needs no IP
   * allow-listing, which is what makes Hubtel workable from an Edge Function at all.
   */
  async initialize(req: CheckoutRequest): Promise<string> {
    const merchant = Deno.env.get("HUBTEL_MERCHANT_ACCOUNT");
    if (!merchant) throw new Error("HUBTEL_MERCHANT_ACCOUNT is not set");
    // Hubtel caps clientReference at 32 characters and rejects a repeat, so ours is generated per attempt.
    const reference = req.reference.slice(0, 32);
    const base = (Deno.env.get("HUBTEL_CHECKOUT_URL") ?? "https://payproxyapi.hubtel.com/items/initiate").replace(/\/$/, "");

    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: hubtelAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        totalAmount: Number(req.amount.toFixed(2)),
        description: req.description.slice(0, 100),
        callbackUrl: req.webhookUrl,
        returnUrl: req.callbackUrl,
        cancellationUrl: req.callbackUrl,
        merchantAccountNumber: merchant,
        clientReference: reference,
        PayeeName: typeof req.metadata.customer_name === "string" ? req.metadata.customer_name : undefined,
        PayeeMobileNumber: req.phone ?? undefined,
        PayeeEmail: req.email ?? undefined,
      }),
    });

    const { parsed, text } = await readJson(res);
    const body = (parsed ?? {}) as {
      responseCode?: string; status?: string; message?: string;
      data?: { checkoutUrl?: string; checkoutId?: string; clientReference?: string };
    };

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Hubtel rejected the credentials (HTTP " + res.status + "). Check that HUBTEL_API_ID and " +
        "HUBTEL_API_KEY are the Sales API keys, not the SMS keys, and that HUBTEL_MERCHANT_ACCOUNT " +
        "is the account number shown for Web Checkout.",
      );
    }
    if (!res.ok || body.responseCode !== "0000" || !body.data?.checkoutUrl) {
      const detail = body.message ?? body.status
        ?? (text ? text.slice(0, 200) : `HTTP ${res.status} with an empty body`);
      throw new Error(`Hubtel refused the checkout: ${detail}`);
    }
    return body.data.checkoutUrl;
  },

  /**
   * Read a callback. This says only what Hubtel claims; it proves nothing on its own, because the
   * callback is unsigned and anyone who learns the URL could post to it. The caller must still
   * check the secret in the URL and that the amount matches the session.
   */
  parseCallback(rawBody: string): VerifiedPayment | null {
    const cb = JSON.parse(rawBody) as HubtelCallback;
    const d = cb.Data;
    const paid = cb.ResponseCode === "0000" && (cb.Status ?? d?.Status ?? "").toLowerCase() === "success";
    if (!paid || !d?.ClientReference) return null;
    return {
      reference: String(d.ClientReference),
      amount: Number(d.Amount ?? 0),
      methodCode: mapHubtelChannel(d.PaymentDetails?.Channel, d.PaymentDetails?.PaymentType),
      metadata: {
        checkout_id: d.CheckoutId ?? null,
        sales_invoice_id: d.SalesInvoiceId ?? null,
        payer_phone: d.CustomerPhoneNumber ?? d.PaymentDetails?.MobileMoneyNumber ?? null,
        description: d.Description ?? null,
      },
    };
  },

  /**
   * Ask Hubtel directly whether a reference was paid. Hubtel only answers this from an IP address
   * they have allow-listed, and an Edge Function's outbound IP is neither fixed nor knowable, so a
   * refusal here is expected and must not be read as "not paid" — hence the three-way answer.
   */
  async confirm(reference: string): Promise<"paid" | "not-paid" | "unavailable"> {
    const merchant = Deno.env.get("HUBTEL_MERCHANT_ACCOUNT");
    if (!merchant) return "unavailable";
    const url = `https://api-txnstatus.hubtel.com/transactions/${merchant}/status?clientReference=${encodeURIComponent(reference)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: hubtelAuth() } });
      if (res.status === 401 || res.status === 403 || res.status === 404) return "unavailable";
      if (!res.ok) return "unavailable";
      const { parsed } = await readJson(res);
      const body = (parsed ?? {}) as { responseCode?: string; data?: { status?: string } | { status?: string }[] };
      const row = Array.isArray(body.data) ? body.data[0] : body.data;
      const status = (row?.status ?? "").toLowerCase();
      if (status === "paid" || status === "success") return "paid";
      if (status === "unpaid" || status === "failed" || status === "cancelled") return "not-paid";
      return "unavailable";
    } catch {
      return "unavailable";   // a network refusal is not evidence either way
    }
  },
};
