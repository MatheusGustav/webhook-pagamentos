// Adaptador InfinitePay.
//
// A InfinitePay chama o webhook com { order_nsu, transaction_nsu,
// capture_method, invoice_slug }. O aviso sozinho NÃO prova pagamento:
// a confirmação real vem da API payment_check — que exige handle e,
// quando presente, o slug (sem eles responde 404).
//
// Testado em produção. Não há sandbox público da InfinitePay.
import type { CheckoutGateway, Gateway, PedidoCheckout, Verificacao } from '../core/types.ts'

export interface InfinitePayConfig {
  /** Seu handle (usuário) InfinitePay — o mesmo do link de pagamento. */
  handle: string
}

export interface InfinitePayCheckoutConfig extends InfinitePayConfig {
  /** Para onde o cliente volta depois de pagar (ex: https://seusite.com/obrigado). */
  urlRetorno?: string
  /** URL do SEU webhook — a InfinitePay chama ela quando o pagamento confirmar. */
  webhookUrl?: string
}

/** Cria links de pagamento no Checkout Integrado da InfinitePay. */
export function infinitePayCheckout(cfg: InfinitePayCheckoutConfig): CheckoutGateway {
  return {
    nome: 'infinitepay',

    async criarLink(pedido: PedidoCheckout): Promise<string> {
      const telefone = (pedido.cliente?.telefone ?? '').replace(/\D/g, '')
      const payload: Record<string, unknown> = {
        handle: cfg.handle,
        order_nsu: pedido.chave,
        items: pedido.itens.map((i) => ({
          quantity: i.quantidade ?? 1,
          price: i.precoCentavos,
          description: i.nome,
        })),
        ...(cfg.urlRetorno && { redirect_url: cfg.urlRetorno }),
        ...(cfg.webhookUrl && { webhook_url: cfg.webhookUrl }),
        ...(pedido.metodo && { payment_methods: pedido.metodo === 'pix' ? ['pix'] : ['credit'] }),
        ...(pedido.cliente && {
          customer: {
            ...(pedido.cliente.nome && { name: pedido.cliente.nome }),
            ...(pedido.cliente.email && { email: pedido.cliente.email }),
            ...(telefone && { phone_number: telefone }),
          },
        }),
      }

      const res = await fetch('https://api.checkout.infinitepay.io/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`InfinitePay /links HTTP ${res.status}: ${JSON.stringify(data)}`)

      const url = data.url ?? data.link ?? data.checkout_url ?? data.payment_url
      if (!url) throw new Error(`InfinitePay não retornou URL: ${JSON.stringify(data)}`)
      return url
    },
  }
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

      // URL nova do Checkout Integrado (a antiga api.infinitepay.io/invoices/... será desativada)
      const res = await fetch('https://api.checkout.infinitepay.io/payment_check', {
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
