-- Rollback of V021: removes the issued-invoice columns of invoice requests (the native invoices stay: they are accounting records).
ALTER TABLE public.ioeti_ws_invoice_request DROP COLUMN IF EXISTS payment_terms_policy;
ALTER TABLE public.ioeti_ws_invoice_request DROP COLUMN IF EXISTS issued_by;
ALTER TABLE public.ioeti_ws_invoice_request DROP COLUMN IF EXISTS issued_at;
ALTER TABLE public.ioeti_ws_invoice_request DROP COLUMN IF EXISTS invoice;
