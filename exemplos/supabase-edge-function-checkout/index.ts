// Exemplo pronto: endpoint de checkout como Supabase Edge Function.
//
// O front chama:
//   POST /functions/v1/pagamento-checkout
//   { "chave": "PEDIDO-123",
//     "itens": [{ "nome": "Produto A", "precoCentavos": 15000 }],
//     "cliente": { "nome": "Maria", "email": "m@ex.com", "telefone": "27999999999" } }
// e recebe: { "url": "https://checkout.infinitepay.com.br/..." }
// → redirecione o cliente pra essa URL.
//
// IMPORTANTE: crie o registro em `pedidos` (chave + valor_total + status
// 'pendente') ANTES de chamar isto — é ele que o webhook valida depois.
//
// Para Mercado Pago, troque o gateway:
//   import { mercadoPagoCheckout } from '../../gateways/mercadopago.ts'
//   gateway: mercadoPagoCheckout({
//     accessToken: Deno.env.get('MP_ACCESS_TOKEN')!,
//     urlRetorno: Deno.env.get('SITE_URL'),
//     notificationUrl: Deno.env.get('WEBHOOK_URL'),
//   })
import { criarCheckout } from '../../core/checkout.ts'
import { infinitePayCheckout } from '../../gateways/infinitepay.ts'

const handler = criarCheckout({
  gateway: infinitePayCheckout({
    handle: Deno.env.get('INFINITYPAY_HANDLE')!,
    urlRetorno: Deno.env.get('SITE_URL'),
    webhookUrl: Deno.env.get('WEBHOOK_URL'), // fecha o ciclo com o webhook deste repo
  }),
})

Deno.serve(handler)
