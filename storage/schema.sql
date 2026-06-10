-- Schema mínimo para o storage Supabase/Postgres.
-- Adapte nomes via SupabaseStorageConfig se suas tabelas forem diferentes.

CREATE TABLE IF NOT EXISTS public.pedidos (
  id               BIGSERIAL PRIMARY KEY,
  chave_pedido     TEXT NOT NULL UNIQUE,          -- identificador enviado ao gateway (order_nsu / external_reference)
  valor_total      NUMERIC(10,2) NOT NULL,        -- valor esperado em reais
  status           TEXT NOT NULL DEFAULT 'pendente',  -- pendente | pago | cancelado | ...
  metodo_pagamento TEXT,
  pago_em          TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log de toda chamada do webhook: diagnóstico de pedidos presos em 'pendente'.
CREATE TABLE IF NOT EXISTS public.webhook_log (
  id        BIGSERIAL PRIMARY KEY,
  chave     TEXT,
  resultado TEXT NOT NULL,   -- confirmado | rejeitado | ignorado | erro | notificacao_erro
  detalhe   TEXT,
  payload   JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_chave  ON public.webhook_log (chave);
CREATE INDEX IF NOT EXISTS idx_webhook_log_criado ON public.webhook_log (criado_em DESC);

-- RLS: o webhook usa a service role key (passa por cima do RLS).
-- Bloqueia tudo para anon/authenticated — libere leituras conforme SEU app precisar.
ALTER TABLE public.pedidos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;
