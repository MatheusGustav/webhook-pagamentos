// Exemplo pronto: webhook InfinitePay rodando como Supabase Edge Function.
//
// Deploy:
//   1. Copie core/, gateways/, notificadores/ e storage/ para dentro da
//      pasta da function (ou ajuste os imports).
//   2. Rode storage/schema.sql no SQL Editor do Supabase.
//   3. supabase secrets set INFINITYPAY_HANDLE=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
//   4. supabase functions deploy pagamento-webhook
//   5. Cadastre a URL da function como webhook na InfinitePay.
//
// Para Mercado Pago, troque o gateway:
//   import { mercadoPago } from '../gateways/mercadopago.ts'
//   gateway: mercadoPago({
//     accessToken: Deno.env.get('MP_ACCESS_TOKEN')!,
//     webhookSecret: Deno.env.get('MP_WEBHOOK_SECRET'),
//   })
import { criarWebhook } from '../../core/webhook.ts'
import { infinitePay } from '../../gateways/infinitepay.ts'
import { supabaseStorage } from '../../storage/supabase.ts'
import { telegram } from '../../notificadores/telegram.ts'

const handler = criarWebhook({
  gateway: infinitePay({
    handle: Deno.env.get('INFINITYPAY_HANDLE')!,
  }),

  storage: supabaseStorage({
    url: Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    // rpcConfirmar: 'confirmar_pedido_pago', // se a confirmação envolver mais tabelas
  }),

  // Opcional — remova se não quiser notificação
  notificador: telegram({
    botToken: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '',
    chatId: Deno.env.get('TELEGRAM_CHAT_ID') ?? '',
  }),
})

Deno.serve(handler)
