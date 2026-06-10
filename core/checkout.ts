// Handler HTTP de checkout — universal, não conhece nenhum gateway.
//
// O front chama com { chave, itens, cliente?, metodo? } e recebe { url }
// da página de pagamento. A chave enviada aqui é a MESMA que o webhook
// recebe depois — é ela que fecha o ciclo.
//
// CORS aberto por padrão: este endpoint é chamado pelo navegador.
// Ele não expõe nada sensível (tokens ficam no adaptador, no servidor).
import type { CheckoutGateway, ItemCheckout, PedidoCheckout } from './types.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function validar(body: Record<string, unknown>): string | null {
  if (!body.chave || typeof body.chave !== 'string') return 'chave do pedido é obrigatória'
  const itens = body.itens as ItemCheckout[] | undefined
  if (!Array.isArray(itens) || !itens.length) return 'itens é obrigatório (lista não vazia)'
  for (const i of itens) {
    if (!i.nome) return 'todo item precisa de nome'
    if (!Number.isInteger(i.precoCentavos) || i.precoCentavos <= 0) {
      return `item "${i.nome}": precoCentavos deve ser inteiro > 0 (centavos)`
    }
  }
  return null
}

/** Cria o handler HTTP do checkout: `Deno.serve(criarCheckout({ gateway }))`. */
export function criarCheckout(opts: { gateway: CheckoutGateway }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

    try {
      const body = await req.json().catch(() => null)
      if (!body) return json({ error: 'JSON inválido' }, 400)

      const erro = validar(body)
      if (erro) return json({ error: erro }, 400)

      const url = await opts.gateway.criarLink(body as PedidoCheckout)
      return json({ url })
    } catch (err) {
      console.error('checkout exception:', err)
      return json({ error: String(err) }, 500)
    }
  }
}
