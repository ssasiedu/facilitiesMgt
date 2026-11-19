// payment-webhook: receives a provider's notification, satisfies itself that it is real, and
// records the payment and its receipt.
//
//   Hubtel:    POST /functions/v1/payment-webhook?provider=hubtel&token=<session secret>
//   Paystack:  POST /functions/v1/payment-webhook?provider=paystack   (header x-paystack-signature)
//
// Paystack signs its webhooks, so the signature settles it. Hubtel does not sign, and its status
// API only answers allow-listed IP addresses, which an Edge Function cannot offer. A Hubtel
// callback is therefore trusted only when all three of these hold:
//
//   1. the URL carries the secret we handed Hubtel when the checkout was opened,
//   2. the client reference names a session that is still pending,
//   3. the amount equals, to the pesewa, what that session was opened for.
//
// Hubtel's status API is still consulted; where it answers, that is recorded, and where it says
// plainly that the reference was not paid, the callback is refused outright.
//
// Recording is idempotent: payments.provider_ref is unique and a settled session is never settled
// twice, so a provider retrying its callback cannot pay an invoice down a second time.
import { adminClient } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { hubtelCheckout, paystack, type VerifiedPayment } from "../_shared/payments.ts";

/** Compare two secrets without letting the time taken reveal how much of the guess was right. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Use POST", 405);

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "hubtel";
  const token = url.searchParams.get("token") ?? "";
  const raw = await req.text();
  const admin = adminClient();

  // ---- what the provider says happened -------------------------------------------------------
  let claimed: VerifiedPayment | null;
  try {
    claimed = provider === "hubtel"
      ? hubtelCheckout.parseCallback(raw)
      : await paystack.verifyWebhook(raw, req.headers.get("x-paystack-signature"));
  } catch (e) {
    return errorResponse((e as Error).message, 401);
  }
  // Not a success notification: a cancellation or a pending step. Nothing to record.
  if (!claimed) return json({ ignored: true });

  // ---- the session it claims to be about ------------------------------------------------------
  const { data: session } = await admin.from("payment_sessions").select("*").eq("reference", claimed.reference).maybeSingle();
  if (!session) return json({ ignored: true, reason: "unknown reference" });
  if (session.status === "paid") return json({ duplicate: true });
  if (session.status !== "pending") return json({ ignored: true, reason: `session is ${session.status}` });

  let verifiedBy = provider === "paystack" ? "signature" : "";

  if (provider === "hubtel") {
    // 1. the secret only Hubtel was given
    if (!session.callback_token || !token || !sameSecret(token, session.callback_token)) {
      return errorResponse("Callback secret does not match", 401);
    }
    // 2. the amount this session was opened for, exactly
    if (Math.abs(Number(session.amount) - claimed.amount) > 0.005) {
      await admin.from("payment_sessions").update({
        status: "failed",
        failure_reason: `Callback said GH¢ ${claimed.amount.toFixed(2)}, the session was opened for GH¢ ${Number(session.amount).toFixed(2)}`,
      }).eq("reference", claimed.reference);
      return errorResponse("Amount does not match the session", 409);
    }
    verifiedBy = "token+amount";

    // 3. Hubtel's own word, where their status API will speak to us at all
    const confirmed = await hubtelCheckout.confirm(claimed.reference);
    if (confirmed === "not-paid") {
      await admin.from("payment_sessions").update({
        status: "failed", failure_reason: "Hubtel's status API says this reference was not paid",
      }).eq("reference", claimed.reference);
      return errorResponse("Hubtel does not show this reference as paid", 409);
    }
    if (confirmed === "paid") verifiedBy = "token+amount+status_api";
  }

  // ---- record it -----------------------------------------------------------------------------
  const { data: invoice, error: invErr } = await admin.from("invoices").select("id, customer_id, balance").eq("id", session.invoice_id).single();
  if (invErr || !invoice) return errorResponse("Invoice not found", 404);

  // The balance can have moved since checkout opened — someone may have paid cash meanwhile. Pay
  // down what is still owed and leave any excess as customer credit, which record_payment handles.
  const allocate = Math.min(Number(invoice.balance), claimed.amount);
  const { data: result, error } = await admin.rpc("record_payment", {
    p_customer_id: invoice.customer_id,
    p_amount: claimed.amount,
    p_method: claimed.methodCode,
    p_date: new Date().toISOString().slice(0, 10),
    p_reference: claimed.reference,
    p_bank_account_id: null,
    p_allocations: allocate > 0 ? [{ invoice_id: invoice.id, amount: allocate }] : [],
    p_notes: `Online payment via ${provider}`,
    p_provider: provider,
    p_provider_ref: `${provider}:${claimed.reference}`,
  });
  if (error) {
    await admin.from("payment_sessions").update({ failure_reason: `record_payment: ${error.message}` }).eq("reference", claimed.reference);
    return errorResponse(`record_payment: ${error.message}`, 500);
  }

  await admin.from("payment_sessions").update({
    status: "paid",
    payment_id: (result as { payment_id: string }).payment_id,
    completed_at: new Date().toISOString(),
    verified_by: verifiedBy,
    provider_ref: typeof claimed.metadata.checkout_id === "string" ? claimed.metadata.checkout_id : null,
  }).eq("reference", claimed.reference);

  return json({ ok: true, verified_by: verifiedBy, result });
});
