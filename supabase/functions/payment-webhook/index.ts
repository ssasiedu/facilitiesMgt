// payment-webhook: receives Paystack / Hubtel notifications, verifies them and records the payment + receipt.
// Idempotent on the provider reference (payments.provider_ref is unique and record_payment returns the existing row).
//   Paystack:  POST /functions/v1/payment-webhook?provider=paystack   (header x-paystack-signature)
//   Hubtel:    POST /functions/v1/payment-webhook?provider=hubtel     (confirmed with Hubtel's status API)
import { adminClient } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { hubtelCheckout, paystack, type VerifiedPayment } from "../_shared/payments.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Use POST", 405);
  const provider = new URL(req.url).searchParams.get("provider") ?? "paystack";
  const raw = await req.text();

  let verified: VerifiedPayment | null;
  try {
    verified = provider === "hubtel" ? await hubtelCheckout.verifyCallback(raw) : await paystack.verifyWebhook(raw, req.headers.get("x-paystack-signature"));
  } catch (e) {
    return errorResponse((e as Error).message, 401);
  }
  if (!verified) return json({ ignored: true });

  const admin = adminClient();
  const { data: session } = await admin.from("payment_sessions").select("*").eq("reference", verified.reference).maybeSingle();
  if (!session) return json({ ignored: true, reason: "unknown reference" });
  if (session.status === "paid") return json({ duplicate: true });

  const { data: invoice, error: invErr } = await admin.from("invoices").select("id, customer_id, balance").eq("id", session.invoice_id).single();
  if (invErr || !invoice) return errorResponse("Invoice not found", 404);

  const allocate = Math.min(Number(invoice.balance), verified.amount);
  const { data: result, error } = await admin.rpc("record_payment", {
    p_customer_id: invoice.customer_id,
    p_amount: verified.amount,
    p_method: verified.methodCode,
    p_date: new Date().toISOString().slice(0, 10),
    p_reference: verified.reference,
    p_bank_account_id: null,
    p_allocations: allocate > 0 ? [{ invoice_id: invoice.id, amount: allocate }] : [],
    p_notes: `Online payment via ${provider}`,
    p_provider: provider,
    p_provider_ref: `${provider}:${verified.reference}`,
  });
  if (error) return errorResponse(`record_payment: ${error.message}`, 500);
  await admin.from("payment_sessions").update({ status: "paid", payment_id: (result as { payment_id: string }).payment_id, completed_at: new Date().toISOString() })
    .eq("reference", verified.reference);
  return json({ ok: true, result });
});
