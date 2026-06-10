// Notificador Telegram.
//
// Cria um bot no @BotFather, pega o token, adiciona o bot a um chat/grupo
// e descobre o chat_id (ex: encaminhe uma mensagem para @userinfobot).
//
// Mensagens em texto puro de propósito: parse_mode Markdown quebra com
// caracteres comuns em nomes/chaves e é a causa nº 1 de notificação perdida.
import type { Notificador } from '../core/types.ts'

export interface TelegramConfig {
  botToken: string
  chatId: string
  /** Personaliza a mensagem de confirmação (ex: buscar itens do pedido no seu banco). */
  mensagemConfirmado?: (info: { chave: string; metodo: string; valorCentavos: number }) => string | Promise<string>
}

async function enviar(cfg: TelegramConfig, texto: string) {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text: texto }),
  })
  if (!res.ok) throw new Error(`Telegram sendMessage HTTP ${res.status}: ${await res.text()}`)
}

export function telegram(cfg: TelegramConfig): Notificador {
  return {
    async confirmado(info) {
      const texto = cfg.mensagemConfirmado
        ? await cfg.mensagemConfirmado(info)
        : `🔔 Pedido confirmado!\n\n🔑 ${info.chave}\n💰 R$ ${(info.valorCentavos / 100).toFixed(2)}\n💳 ${info.metodo}`
      await enviar(cfg, texto)
    },

    async problema(info) {
      await enviar(
        cfg,
        `⚠️ Problema no webhook de pagamento\n\n🔑 Pedido: ${info.chave}\n❌ ${info.resultado}: ${info.detalhe}`,
      )
    },
  }
}
