# webhook-pagamentos

Webhook de pagamento universal em TypeScript (Deno) — recebe o aviso do gateway, **confirma se pagou de verdade**, marca o pedido como pago **uma vez só** e avisa no Telegram. Extraído de código rodando em produção.

```
aviso do gateway ──► verifica na API do gateway ──► confirma o pedido ──► 🔔 Telegram
                     (nunca confia só no aviso)      (idempotente)
```

## Por que isso existe

Webhook de pagamento parece simples até você sofrer na prática:

- **Aviso falso** — qualquer um pode fazer POST na sua URL. Aqui o pagamento é sempre reconfirmado na API do gateway.
- **Confirmação dupla** — gateways reenviam o mesmo aviso. Pedido já processado responde `200` sem reconfirmar.
- **Pagamento a menor** — valor recebido é comparado com o esperado em centavos. A maior é aceito (juros de parcelamento somam ao total).
- **Aviso perdido** — falha transitória responde `5xx`, induzindo o gateway a reentregar.
- **Notificação que derruba tudo** — Telegram fora do ar nunca impede a confirmação.
- **Pedido preso em "pendente" sem pista** — toda chamada fica registrada na tabela `webhook_log`.

## Gateways

| Gateway | Status |
|---|---|
| InfinitePay | ✅ testado em produção |
| Mercado Pago | ✅ testado |
| Stripe, PagBank, Asaas, Efí... | contribua! É 1 arquivo (veja abaixo) |

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
  types.ts        ← interfaces (Gateway, Storage, Notificador)
  webhook.ts      ← o cérebro: idempotência, valor, log, respostas HTTP
gateways/
  infinitepay.ts  ← traduz o aviso da InfinitePay (payment_check)
  mercadopago.ts  ← traduz o aviso do MP (x-signature + /v1/payments)
storage/
  supabase.ts     ← as 3 funções que tocam o banco
  schema.sql
notificadores/
  telegram.ts
exemplos/
  supabase-edge-function/
```

O core não conhece nenhum gateway nem banco. Toda a "tradução" vive nos adaptadores.

### Adicionar um gateway

Um arquivo que implementa `Gateway` (`core/types.ts`): interprete o aviso, **confirme o pagamento na API do gateway** e retorne `{ tipo: 'pago', chave, valorCentavos, metodo }` (ou `nao_pago`/`ignorar`/`invalido`/`erro`). Use `gateways/infinitepay.ts` como modelo — são ~60 linhas.

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
