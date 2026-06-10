// Adaptador Mercado Pago.
//
// O MP notifica via query string E/OU body, com vários tipos de evento;
// só 'payment' interessa. O aviso traz apenas o id — a confirmação real
// vem de GET /v1/payments/{id}. A chave do pedido é o external_reference
// definido na criação do pagamento.
//
// Assinatura: se webhookSecret for configurado, valida o header
// x-signature (HMAC-SHA256 do manifest id/request-id/ts), conforme
// https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
import type { Gateway, Verificacao } from '../core/types.ts'

export interface MercadoPagoConfig {
  /** Access token (produção ou sandbox). */
  accessToken: string
  /** Assinatura secreta do webhook (recomendado; sem ela a validação é pulada). */
  webhookSecret?: string
}

async function assinaturaValida(req: Request, dataId: string, secret: string): Promise<boolean> {
  const sigHeader = req.headers.get('x-signature') || ''
  const reqId = req.headers.get('x-request-id') || ''
  if (!sigHeader || !reqId) return false

  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => p.trim().split('=').map((s) => s.trim())),
  ) as Record<string, string>
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === v1
}

export function mercadoPago(cfg: MercadoPagoConfig): Gateway {
  return {
    nome: 'mercadopago',

    async verificar(req: Request): Promise<Verificacao> {
      // Info pode vir na query string E no body — aceitar ambos.
      const url = new URL(req.url)
      const qsType = url.searchParams.get('type') || url.searchParams.get('topic')
      const qsId = url.searchParams.get('data.id') || url.searchParams.get('id')

      let body: Record<string, unknown> = {}
      try {
        body = await req.json()
      } catch { /* algumas notificações vêm sem body */ }

      const type = (body?.type as string) || qsType
      const dataId = String((body?.data as Record<string, unknown>)?.id || qsId || '')

      if (!dataId) return { tipo: 'ignorar', detalhe: 'notificação sem data.id' }
      if (type && type !== 'payment') return { tipo: 'ignorar', detalhe: `type=${type}` }

      if (cfg.webhookSecret && !(await assinaturaValida(req, dataId, cfg.webhookSecret))) {
        return { tipo: 'invalido', detalhe: 'assinatura x-signature inválida', payload: body }
      }

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      })
      if (!mpRes.ok) {
        // 404 de id desconhecido não é transitório; o resto é
        const transitorio = mpRes.status >= 500 || mpRes.status === 429
        return {
          tipo: transitorio ? 'erro' : 'invalido',
          detalhe: `GET /v1/payments/${dataId} HTTP ${mpRes.status}`,
          payload: body,
        }
      }
      const pay = await mpRes.json()

      const chave = (pay.external_reference as string) ?? null
      if (pay.status !== 'approved') {
        return { tipo: 'nao_pago', chave, detalhe: `status=${pay.status}`, payload: { dataId, status: pay.status } }
      }
      if (!chave) {
        return { tipo: 'invalido', detalhe: 'pagamento aprovado sem external_reference', payload: { dataId } }
      }

      const metodo = pay.payment_type_id === 'credit_card' ? 'cartao'
        : pay.payment_method_id === 'pix' ? 'pix'
        : (pay.payment_type_id as string) || 'mp'

      return {
        tipo: 'pago',
        chave,
        // transaction_amount vem em reais
        valorCentavos: Math.round(Number(pay.transaction_amount ?? 0) * 100),
        metodo,
        payload: { dataId, status: pay.status },
      }
    },
  }
}
