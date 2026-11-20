// public-document: invoice, receipt and statement data by unguessable token (no login).
// The browser renders the page and builds the PDF from this data.
//   GET  ?type=invoice|receipt|statement&token=...
//   POST { action: "pay", token }   -> { url } checkout link (only when online payments are enabled)
import { adminClient, getSettings, publicCompany } from "../_shared/admin.ts";
import { errorResponse, json, preflight } from "../_shared/cors.ts";
import { hubtelCheckout, paystack } from "../_shared/payments.ts";

const TOKEN = /^[a-f0-9]{24,64}$/;

async function invoiceByToken(token: string) {
  const admin = adminClient();
  const { data: inv } = await admin.from("invoices")
    .select("id, invoice_no, status, issue_date, due_date, period_start, period_end, subtotal, discount_total, tax_total, total, amount_paid, amount_credited, balance, notes, terms, payment_terms, customer_id, job_order_id, contract_id")
    .eq("public_token", token).neq("status", "draft").maybeSingle();
  if (!inv) return null;
  const [lines, taxes, customer, contacts] = await Promise.all([
    admin.from("invoice_lines").select("description, quantity, unit_price, discount, line_total").eq("invoice_id", inv.id).order("sort_order"),
    admin.from("invoice_taxes").select("name, rate, amount").eq("invoice_id", inv.id),
    admin.from("customers").select("display_name, customer_code, phone, company_phone, email, company_email, residential_address, digital_address, tin").eq("id", inv.customer_id).single(),
    admin.from("customer_contacts").select("name, position").eq("customer_id", inv.customer_id).eq("is_primary", true).limit(1),
  ]);
  return { ...inv, lines: lines.data ?? [], taxes: taxes.data ?? [], customer: customer.data, attention: contacts.data?.[0] ?? null };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const admin = adminClient();
  const settings = await getSettings();
  const company = publicCompany(settings);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const token = url.searchParams.get("token") ?? "";
    if (!TOKEN.test(token)) return errorResponse("Invalid link", 404);

    if (type === "invoice") {
      const invoice = await invoiceByToken(token);
      if (!invoice) return errorResponse("Invoice not found", 404);
      const { customer_id: _c, job_order_id: _j, contract_id: _k, ...safe } = invoice;
      return json({ company, invoice: safe, pay_enabled: settings.online_payments_enabled && Number(invoice.balance) > 0 && invoice.status !== "void" });
    }
    if (type === "receipt") {
      const { data: r } = await admin.from("receipts").select("receipt_no, amount, issued_at, payment_id, customer_id").eq("public_token", token).maybeSingle();
      if (!r) return errorResponse("Receipt not found", 404);
      const [pay, allocs, customer] = await Promise.all([
        admin.from("payments").select("payment_date, method_code, reference, unallocated_amount, payment_methods(name)").eq("id", r.payment_id).single(),
        admin.from("payment_allocations").select("amount, invoices(invoice_no, balance)").eq("payment_id", r.payment_id),
        admin.from("customers").select("display_name, customer_code, phone, company_phone, email").eq("id", r.customer_id).single(),
      ]);
      return json({ company, receipt: { receipt_no: r.receipt_no, amount: r.amount, issued_at: r.issued_at, payment: pay.data, allocations: allocs.data ?? [], customer: customer.data } });
    }
    if (type === "statement") {
      const { data: link } = await admin.from("public_links").select("customer_id, params, expires_at").eq("token", token).eq("doc_type", "statement").maybeSingle();
      if (!link || new Date(link.expires_at) < new Date()) return errorResponse("This statement link has expired", 404);
      const from = String(link.params.from); const to = String(link.params.to);
      const [rows, customer] = await Promise.all([
        admin.rpc("rpt_customer_statement", { p_customer_id: link.customer_id, p_from: from, p_to: to }),
        admin.from("customers").select("display_name, customer_code, phone, company_phone, email, residential_address, digital_address").eq("id", link.customer_id).single(),
      ]);
      if (rows.error) return errorResponse(rows.error.message, 500);
      return json({ company, statement: { from, to, customer: customer.data, rows: rows.data } });
    }
    return errorResponse("Unknown document type", 404);
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { action?: string; token?: string };
    if (body.action !== "pay" || !TOKEN.test(body.token ?? "")) return errorResponse("Invalid request");
    if (!settings.online_payments_enabled) return errorResponse("Online payment is not enabled", 403);
    const invoice = await invoiceByToken(body.token!);
    if (!invoice || Number(invoice.balance) <= 0) return errorResponse("Nothing to pay on this invoice", 400);
    // Hubtel caps clientReference at 32 characters and refuses one it has seen before.
    const reference = "P" + crypto.randomUUID().replace(/-/g, "").slice(0, 20) + Date.now().toString(36);
    /* Hubtel does not sign its callback, so the callback URL carries a secret of ours instead.
       It goes to Hubtel over TLS at checkout and appears nowhere else, so a caller that presents
       it is Hubtel answering about this one session. */
    const callbackToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? settings.public_app_url).replace(/\/$/, "");
    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook`
      + `?provider=${encodeURIComponent(settings.payment_provider)}&token=${callbackToken}`;

    const { error } = await admin.from("payment_sessions").insert({
      reference, provider: settings.payment_provider, invoice_id: invoice.id,
      amount: invoice.balance, callback_token: callbackToken,
    });
    if (error) return errorResponse(error.message, 500);

    const request = {
      amount: Number(invoice.balance), email: invoice.customer?.email ?? invoice.customer?.company_email ?? null,
      phone: invoice.customer?.phone ?? invoice.customer?.company_phone ?? null, reference,
      description: `${settings.company_name} invoice ${invoice.invoice_no}`, callbackUrl: `${appUrl}/p/invoice/${body.token}?paid=1`, webhookUrl: fnUrl,
      metadata: {
        invoice_no: invoice.invoice_no, reference,
        customer_name: invoice.customer?.display_name ?? null,
      },
    };
    try {
      const url = settings.payment_provider === "hubtel" ? await hubtelCheckout.initialize(request) : await paystack.initialize(request);
      return json({ url });
    } catch (e) {
      await admin.from("payment_sessions").update({ status: "failed" }).eq("reference", reference);
      return errorResponse((e as Error).message, 502);
    }
  }
  return errorResponse("Method not allowed", 405);
});
