-- 0024: record what the customer was actually charged, alongside what the invoice was for.
--
-- Hubtel adds its transaction fee on top of the amount we ask for when the customer bears the
-- fee, so a GH¢ 1.00 invoice comes back as GH¢ 1.01 charged. The invoice is still settled for
-- GH¢ 1.00 — the extra penny went to Hubtel, never to us, and crediting it would overstate what
-- we received and leave the customer's statement wrong by the size of the fee.

alter table public.payment_sessions
  add column if not exists gross_amount numeric(14,2);

comment on column public.payment_sessions.gross_amount is
  'What the customer was charged, including any provider fee they bore. The invoice is settled for `amount`.';
comment on column public.payment_sessions.amount is
  'What the invoice was for, and what gets credited to the customer.';

-- What is already recorded was charged at face value, so gross and net are the same.
update public.payment_sessions set gross_amount = amount where gross_amount is null and status = 'paid';
