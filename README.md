# webhook-pagamentos

Integração de pagamento completa em TypeScript (Deno) — **cria a cobrança** e **confirma o pagamento com segurança**, nos dois gateways. Extraído de código rodando em produção.

```
checkout: seu site ──► criarLink(pedido) ──► URL de pagamento ──► cliente paga
                                                                      │
webhook:  aviso do gateway ──► verifica na API ──► confirma o pedido ──► 🔔 Telegram
                               (nunca confia só no aviso)  (idempotente)
```

A mesma `chave` identifica o pedido nas duas pontas (`order_nsu` / `external_reference`) — é ela que fecha o ciclo.

## Por que isso existe

Webhook de pagamento parece simples até você sofrer na prática:

- **Aviso falso** — qualquer um pode fazer POST na sua URL. Aqui o pagamento é sempre reconfirmado na API do gateway.
- **Confirmação dupla** — gateways reenviam o mesmo aviso. Pedido já processado responde `200` sem reconfirmar.
- **Pagamento a menor** — valor recebido é comparado com o esperado em centavos. A maior é aceito (juros de parcelamento somam ao total).
- **Aviso perdido** — falha transitória responde `5xx`, induzindo o gateway a reentregar.
- **Notificação que derruba tudo** — Telegram fora do ar nunca impede a confirmação.
- **Pedido preso em "pendente" sem pista** — toda chamada fica registrada na tabela `webhook_log`.

## Gateways

| Gateway | Checkout (criar link) | Webhook (confirmar) |
|---|---|---|
| InfinitePay | ✅ testado em produção | ✅ testado em produção |
| Mercado Pago | ✅ Checkout Pro | ✅ testado |
| Stripe, PagBank, Asaas, Efí... | contribua! | É 1 arquivo (veja abaixo) |

## Começando (Supabase, ~10 minutos)

1. Crie um projeto no [Supabase](https://supabase.com) (grátis).
2. Rode `storage/schema.sql` no SQL Editor.
3. Crie a function e copie os arquivos (veja `exemplos/supabase-edge-function/`).
4. Configure os secrets:
   ```sh
   supabase secrets set INFINITYPAY_HANDLE=seu_handle \
     TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_CHAT_ID=-100123
   ```
5. `supabase functions deploy pagamento-webhook`
6. Cadastre a URL da function como webhook no painel do gateway.

Seu sistema só precisa fazer duas coisas: criar o registro em `pedidos` (com `chave_pedido` e `valor_total`) antes de mandar o cliente pagar, e usar essa mesma chave como `order_nsu` (InfinitePay) ou `external_reference` (Mercado Pago).

## Arquitetura

```
core/
  types.ts        ← interfaces (Gateway, CheckoutGateway, Storage, Notificador)
  webhook.ts      ← confirma: idempotência, valor, log, respostas HTTP
  checkout.ts     ← cria: valida o pedido e devolve a URL de pagamento
gateways/
  infinitepay.ts  ← cria link (/links) + confirma (payment_check)
  mercadopago.ts  ← cria link (Checkout Pro) + confirma (x-signature + /v1/payments)
storage/
  supabase.ts     ← as 3 funções que tocam o banco
  schema.sql
notificadores/
  telegram.ts
exemplos/
  supabase-edge-function/           ← webhook
  supabase-edge-function-checkout/  ← checkout
```

O core não conhece nenhum gateway nem banco. Toda a "tradução" vive nos adaptadores.

### Criar a cobrança (checkout)

```ts
const handler = criarCheckout({
  gateway: infinitePayCheckout({ handle, webhookUrl }), // ou mercadoPagoCheckout({...})
})
// POST { chave, itens: [{ nome, precoCentavos }], cliente? } → { url }
```

Crie o registro em `pedidos` (com a mesma `chave` e o `valor_total`) **antes** de gerar o link — é ele que o webhook valida na volta.

### Adicionar um gateway

Webhook: um arquivo que implementa `Gateway` (`core/types.ts`): interprete o aviso, **confirme o pagamento na API do gateway** e retorne `{ tipo: 'pago', chave, valorCentavos, metodo }` (ou `nao_pago`/`ignorar`/`invalido`/`erro`). Use `gateways/infinitepay.ts` como modelo — são ~60 linhas.

Checkout: implemente `CheckoutGateway` — uma função `criarLink(pedido)` que chama a API do gateway e retorna a URL de pagamento (~40 linhas).

### Usar outro banco de dados

Um arquivo que implementa `Storage`: `buscarPedido`, `confirmarPedido`, `registrarLog`. São ~30 linhas — `storage/supabase.ts` é o modelo. O core roda em qualquer runtime com `fetch`/`Request`/`Response` (Deno, Bun, Node 18+, Cloudflare Workers), então MySQL + Express, por exemplo, é só escrever esse adaptador e montar `criarWebhook` num endpoint.

### Notificação personalizada

```ts
telegram({
  botToken, chatId,
  mensagemConfirmado: async ({ chave, valorCentavos }) => {
    const itens = await buscarItensDoPedido(chave) // seu banco, sua regra
    return `🔔 Pedido ${chave} pago!\n${itens}\n💰 R$ ${(valorCentavos / 100).toFixed(2)}`
  },
})
```

## 💼 Instalação profissional

Quer isso funcionando no seu projeto sem dor de cabeça? Eu instalo, configuro e testo no seu gateway e banco — fale comigo no [WhatsApp](https://wa.me/5527996240725).

## Licença

[MIT](LICENSE) — use, modifique e venda à vontade.
