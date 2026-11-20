// request-payment: staff ask a customer to pay from the Record a payment screen.
//
// POST { customer_id, amount, phone, invoice_id? }
//   -> { sent: "prompt" | "link", reference, url?, note? }
//
// Two ways of asking. A prompt pushed to the payer's handset through Hubtel's Receive Money API,
// which needs that capability enabled on the merchant account and the caller's IP allow-listed;
// or a link sent by SMS, which works with the credentials already in place. Configuration decides
// which is tried, and a prompt Hubtel refuses for a reason staff cannot fix falls back to a link
// so the customer is still asked to pay.
//
// Every rule about who may ask, for how much, and against which invoice lives in
// open_payment_request. This function carries the gateway call and nothing else.
import { callerClient, getSettings } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { getCaller, hasRole } from "../_shared/auth.ts";
import { hubtelCheckout, hubtelPrompt, paystack } from "../_shared/payments.ts";

interface Body {
  customer_id?: string;
  amount?: unknown;
  phone?: string;
  invoice_id?: string | null;
}

interface Opened {
  reference: string;
  callback_token: string;
  amount: number;
  phone: string;
  mode: string;
  provider: string;
  customer_name: string | null;
  customer_email: string | null;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_token: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  /* The database checks the role again inside open_payment_request, which is what actually
     guards it; this is here so an unauthorised caller gets a clear 403 rather than a SQL error. */
  const caller = await getCaller(req);
  if (!caller) return errorResponse("Sign in first", 401);
  if (!hasRole(caller, "super_admin", "manager", "accountant", "sales_exec", "ops_officer")) {
    return errorResponse("You do not have permission to request a payment", 403);
  }

  const body = await req.json().catch(() => ({})) as Body;
  if (!body.customer_id) return errorResponse("Choose the customer", 400);

  const settings = await getSettings();
  const db = callerClient(req);

  // ---- open the session (all the rules are in here) ------------------------------------------
  const { data, error } = await db.rpc("open_payment_request", {
    p_customer_id: body.customer_id,
    p_amount: Number(body.amount),
    p_phone: body.phone ?? null,
    p_invoice_id: body.invoice_id ?? null,
  });
  if (error) return errorResponse(error.message, 400);
  const opened = data as unknown as Opened;

  const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? settings.public_app_url).replace(/\/$/, "");
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook`
    + `?provider=${encodeURIComponent(opened.provider)}&token=${opened.callback_token}`;
  const description = `${settings.company_name}${opened.invoice_no ? ` invoice ${opened.invoice_no}` : " payment"}`;

  const abandon = async (reason: string) => {
    await db.rpc("fail_payment_request", { p_reference: opened.reference, p_reason: reason });
  };

  // ---- a prompt straight to the handset, where that is switched on ----------------------------
  let note: string | undefined;
  if (opened.mode === "prompt" && opened.provider === "hubtel") {
    if (!hubtelPrompt.configured()) {
      note = "Mobile money prompts are switched on but the Hubtel keys for them are not set, so a link was sent instead.";
    } else {
      const sent = await hubtelPrompt.send({
        amount: opened.amount,
        phone: opened.phone,
        reference: opened.reference,
        description,
        webhookUrl,
        customerName: opened.customer_name,
        customerEmail: opened.customer_email,
      });

      if (sent.ok) {
        await db.rpc("notify_payment_request", {
          p_reference: opened.reference, p_url: null, p_channel: "prompt",
        });
        return json({ sent: "prompt", reference: opened.reference });
      }

      /* A number that is not a mobile money number would be just as unusable as a link, so that
         one stops here. Anything else - the capability not enabled, the IP not allow-listed,
         Hubtel down - is not something the staff member can fix, so a link goes instead. */
      if (!sent.retryAsLink) {
        await abandon(sent.reason);
        return errorResponse(sent.reason, 400);
      }
      note = `The mobile money prompt could not be sent (${sent.reason}), so a payment link was sent instead.`;
    }
  }

  // ---- otherwise, a link by SMS --------------------------------------------------------------
  const checkout = {
    amount: opened.amount,
    email: opened.customer_email,
    phone: opened.phone,
    reference: opened.reference,
    description,
    /* Paid from a link, the customer lands back on the invoice, which then shows it as settled.
       A payment on account has no invoice to return to, so they land on the site. */
    callbackUrl: opened.invoice_token ? `${appUrl}/p/invoice/${opened.invoice_token}?paid=1` : appUrl,
    webhookUrl,
    metadata: { customer_name: opened.customer_name, reference: opened.reference, invoice_no: opened.invoice_no },
  };

  let url: string;
  try {
    url = opened.provider === "hubtel" ? await hubtelCheckout.initialize(checkout) : await paystack.initialize(checkout);
  } catch (e) {
    const reason = (e as Error).message;
    await abandon(reason);
    return errorResponse(reason, 502);
  }

  const { error: smsError } = await db.rpc("notify_payment_request", {
    p_reference: opened.reference, p_url: url, p_channel: "link",
  });
  if (smsError) {
    /* The link is live, so the session is left pending rather than abandoned - the staff member
       can read it out or copy it. Saying the SMS failed matters: otherwise they would assume the
       customer has it. */
    return json({
      sent: "link", reference: opened.reference, url,
      note: `The payment link was created but the SMS could not be queued (${smsError.message}). The link is below.`,
    });
  }

  return json({ sent: "link", reference: opened.reference, url, note });
});
