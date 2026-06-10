// Adaptador InfinitePay.
//
// A InfinitePay chama o webhook com { order_nsu, transaction_nsu,
// capture_method, invoice_slug }. O aviso sozinho NÃO prova pagamento:
// a confirmação real vem da API payment_check — que exige handle e,
// quando presente, o slug (sem eles responde 404).
//
// Testado em produção. Não há sandbox público da InfinitePay.
import type { Gateway, Verificacao } from '../core/types.ts'

export interface InfinitePayConfig {
  /** Seu handle (usuário) InfinitePay — o mesmo do link de pagamento. */
  handle: string
}

export function infinitePay(cfg: InfinitePayConfig): Gateway {
  return {
    nome: 'infinitepay',

    async verificar(req: Request): Promise<Verificacao> {
      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return { tipo: 'invalido', detalhe: 'JSON inválido' }
      }

      const chave = (body.order_nsu as string) ?? null
      const transactionNsu = body.transaction_nsu
      if (!chave || !transactionNsu) {
        return { tipo: 'invalido', detalhe: 'payload sem order_nsu/transaction_nsu', payload: body }
      }

      const res = await fetch('https://api.infinitepay.io/invoices/public/checkout/payment_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: cfg.handle,
          order_nsu: chave,
          transaction_nsu: transactionNsu,
          ...(body.invoice_slug ? { slug: body.invoice_slug } : {}),
        }),
      })

      if (!res.ok) {
        // Transitório: 5xx induz a InfinitePay a reentregar o webhook
        return { tipo: 'erro', detalhe: `payment_check HTTP ${res.status}`, payload: body }
      }

      const check = await res.json()
      if (!check.paid) {
        return { tipo: 'nao_pago', chave, detalhe: 'payment_check: paid=false', payload: { body, check } }
      }

      return {
        tipo: 'pago',
        chave,
        // payment_check responde amount já em centavos
        valorCentavos: Number(check.amount ?? 0),
        metodo: (body.capture_method as string) ?? 'cartao',
        payload: body,
      }
    },
  }
}
