// Cérebro do webhook — universal, não conhece nenhum gateway nem banco.
//
// Garantias:
// - Toda chamada fica registrada via storage.registrarLog (best-effort).
// - Idempotência: pedido já processado responde 200 sem reconfirmar.
// - Valor: aceita recebido >= esperado (juros de parcelamento somam ao
//   total); rejeita pagamento A MENOR.
// - Condições transitórias respondem 5xx para o gateway reentregar.
// - Falha na notificação nunca derruba a confirmação.
import type { Notificador, Storage, WebhookOpts } from './types.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function criarLog(storage: Storage, notificador?: Notificador) {
  // Registra e, em rejeição/erro com chave, avisa o notificador.
  // Tudo best-effort: diagnóstico nunca derruba o fluxo.
  return async (chave: string | null, resultado: string, detalhe: string, payload?: unknown) => {
    try {
      await storage.registrarLog(chave, resultado, detalhe, payload)
    } catch (e) {
      console.error('registrarLog falhou:', e)
    }
    if ((resultado === 'rejeitado' || resultado === 'erro') && chave && notificador) {
      try {
        await notificador.problema({ chave, resultado, detalhe })
      } catch (e) {
        console.error('notificador.problema falhou:', e)
      }
    }
  }
}

/** Cria o handler HTTP do webhook: `Deno.serve(criarWebhook({...}))`. */
export function criarWebhook(opts: WebhookOpts): (req: Request) => Promise<Response> {
  const {
    gateway,
    storage,
    notificador,
    statusPendente = 'pendente',
    toleranciaCentavos = 1,
    aceitaValorMaior = true,
  } = opts

  const log = criarLog(storage, notificador)

  return async (req: Request): Promise<Response> => {
    try {
      const v = await gateway.verificar(req)

      switch (v.tipo) {
        case 'ignorar':
          return json({ ok: true, skipped: v.detalhe })
        case 'invalido':
          await log(null, 'rejeitado', v.detalhe, v.payload)
          return json({ error: v.detalhe }, 400)
        case 'erro':
          await log(null, 'erro', v.detalhe, v.payload)
          return json({ error: v.detalhe }, 500)
        case 'nao_pago':
          await log(v.chave, 'rejeitado', v.detalhe, v.payload)
          return json({ error: 'payment not confirmed' }, 400)
      }

      // v.tipo === 'pago'
      const { chave, valorCentavos: recebido, metodo, payload } = v

      let pedido
      try {
        pedido = await storage.buscarPedido(chave)
      } catch (e) {
        await log(chave, 'erro', `consulta pedido: ${e}`, payload)
        return json({ error: 'pedido lookup failed' }, 500)
      }
      if (!pedido) {
        await log(chave, 'rejeitado', 'pedido não encontrado', payload)
        return json({ error: 'pedido not found' }, 400)
      }
      if (pedido.status !== statusPendente) {
        await log(chave, 'ignorado', `status já era '${pedido.status}'`, payload)
        return json({ ok: true, skipped: 'already processed' })
      }

      const esperado = Math.round(Number(pedido.valorTotal ?? 0) * 100)
      if (recebido < esperado - toleranciaCentavos) {
        await log(chave, 'rejeitado', `valor a menor: recebido ${recebido}, esperado ${esperado}`, payload)
        return json({ error: 'amount below expected', recebido, esperado }, 400)
      }
      if (!aceitaValorMaior && recebido > esperado + toleranciaCentavos) {
        await log(chave, 'rejeitado', `valor a maior: recebido ${recebido}, esperado ${esperado}`, payload)
        return json({ error: 'amount above expected', recebido, esperado }, 400)
      }

      try {
        await storage.confirmarPedido(chave, metodo)
      } catch (e) {
        await log(chave, 'erro', `confirmar pedido: ${e}`, payload)
        return json({ error: 'update failed' }, 500)
      }

      await log(chave, 'confirmado', `pago via ${metodo} (recebido ${recebido}, esperado ${esperado})`, payload)

      if (notificador) {
        try {
          await notificador.confirmado({ chave, metodo, valorCentavos: recebido })
        } catch (e) {
          await log(chave, 'notificacao_erro', String(e))
        }
      }

      return json({ ok: true })
    } catch (err) {
      console.error('webhook exception:', err)
      return json({ error: String(err) }, 500)
    }
  }
}
