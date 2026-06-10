// Storage Supabase (Postgres) — as 3 funções que tocam o banco.
//
// Para usar OUTRO banco (MySQL, Mongo, Firebase...), não mexa no core:
// crie um arquivo como este implementando a interface Storage de
// core/types.ts. São só estas 3 funções (~30 linhas).
//
// Schema mínimo esperado em storage/schema.sql.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Pedido, Storage } from '../core/types.ts'

export interface SupabaseStorageConfig {
  url: string
  /** Service role key — o webhook roda no servidor, nunca no navegador. */
  serviceRoleKey: string
  /** Nomes customizados (defaults compatíveis com storage/schema.sql). */
  tabelaPedidos?: string
  tabelaLog?: string
  colunaChave?: string
  /**
   * Se a sua confirmação precisa ser mais que um UPDATE (ex: marcar
   * registros filhos juntos), crie uma function no Postgres e informe o
   * nome aqui — ela recebe (p_chave text, p_metodo text) e roda atômica.
   */
  rpcConfirmar?: string
}

export function supabaseStorage(cfg: SupabaseStorageConfig): Storage {
  const supabase = createClient(cfg.url, cfg.serviceRoleKey)
  const tPedidos = cfg.tabelaPedidos ?? 'pedidos'
  const tLog = cfg.tabelaLog ?? 'webhook_log'
  const cChave = cfg.colunaChave ?? 'chave_pedido'

  return {
    async buscarPedido(chave): Promise<Pedido | null> {
      const { data, error } = await supabase
        .from(tPedidos)
        .select('valor_total, status')
        .eq(cChave, chave)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return { valorTotal: Number(data.valor_total), status: data.status }
    },

    async confirmarPedido(chave, metodo) {
      if (cfg.rpcConfirmar) {
        const { error } = await supabase.rpc(cfg.rpcConfirmar, { p_chave: chave, p_metodo: metodo })
        if (error) throw new Error(error.message)
        return
      }
      const { error } = await supabase
        .from(tPedidos)
        .update({ status: 'pago', metodo_pagamento: metodo, pago_em: new Date().toISOString() })
        .eq(cChave, chave)
        .eq('status', 'pendente')
      if (error) throw new Error(error.message)
    },

    async registrarLog(chave, resultado, detalhe, payload) {
      const { error } = await supabase
        .from(tLog)
        .insert({ chave, resultado, detalhe, payload: payload ?? null })
      if (error) throw new Error(error.message)
    },
  }
}
