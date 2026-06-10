// Tipos centrais do webhook de pagamento universal.
//
// O fluxo é sempre o mesmo, em qualquer gateway:
//   aviso chega → gateway confirma se pagou → pedido é marcado como pago
//   (uma vez só) → notificação dispara.
// O que muda entre gateways é a "tradução" do aviso — e ela vive nos
// adaptadores, nunca no core.

/** Resultado da verificação de um aviso junto ao gateway. */
export type Verificacao =
  /** Pagamento aprovado e confirmado na API do gateway. */
  | { tipo: 'pago'; chave: string; valorCentavos: number; metodo: string; payload?: unknown }
  /** Aviso válido, mas o pagamento NÃO está aprovado. Sem reentrega. */
  | { tipo: 'nao_pago'; chave: string | null; detalhe: string; payload?: unknown }
  /** Notificação que não interessa (ex: outro tipo de evento). Responde 200. */
  | { tipo: 'ignorar'; detalhe: string; payload?: unknown }
  /** Payload malformado ou assinatura inválida. Responde 4xx, sem reentrega. */
  | { tipo: 'invalido'; detalhe: string; payload?: unknown }
  /** Falha transitória (API do gateway fora do ar). Responde 5xx para o gateway reenviar. */
  | { tipo: 'erro'; detalhe: string; payload?: unknown }

/** Adaptador de gateway de pagamento (InfinitePay, Mercado Pago, ...). */
export interface Gateway {
  nome: string
  /**
   * Interpreta a requisição do gateway e confirma o pagamento na API dele.
   * É o único lugar que conhece o formato do aviso daquele gateway.
   * Pode consumir o body da Request (o core não lê o body).
   */
  verificar(req: Request): Promise<Verificacao>
}

/** Pedido como o core precisa enxergar — só o essencial. */
export interface Pedido {
  /** Valor esperado em reais (ex: 150.5). */
  valorTotal: number
  /** Status atual (idempotência: só confirma se ainda for o status pendente). */
  status: string
}

/** Adaptador de persistência. Implemente estas 3 funções para qualquer banco. */
export interface Storage {
  /** Retorna o pedido pela chave, ou null se não existir. */
  buscarPedido(chave: string): Promise<Pedido | null>
  /** Marca o pedido como pago (deve ser atômico/idempotente no banco). Lança em falha. */
  confirmarPedido(chave: string, metodo: string): Promise<void>
  /** Registra o resultado de cada chamada (diagnóstico). Pode lançar; o core engole. */
  registrarLog(chave: string | null, resultado: string, detalhe: string, payload?: unknown): Promise<void>
}

/** Notificador opcional (Telegram, e-mail, Discord...). Falha aqui nunca derruba a confirmação. */
export interface Notificador {
  confirmado(info: { chave: string; metodo: string; valorCentavos: number }): Promise<void>
  problema(info: { chave: string; resultado: string; detalhe: string }): Promise<void>
}

export interface WebhookOpts {
  gateway: Gateway
  storage: Storage
  notificador?: Notificador
  /** Status que permite confirmação (default: 'pendente'). */
  statusPendente?: string
  /** Tolerância em centavos na comparação de valor (default: 1). */
  toleranciaCentavos?: number
  /**
   * Aceitar valor recebido MAIOR que o esperado (default: true).
   * Juros de parcelamento somam ao total — rejeitar só pagamento a menor.
   */
  aceitaValorMaior?: boolean
}
