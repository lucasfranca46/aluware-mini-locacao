# Mini-Locação com Webhook — Desafio AluWare

Rotina de locação de motos: o **banco gera as faturas semanais** ao ativar um contrato, e um **webhook idempotente** liquida a fatura quando o Pix é confirmado, gravando a baixa no fuso de Brasília.

| Camada | Stack | Onde |
|---|---|---|
| Banco | PostgreSQL (Supabase) — tabelas, triggers, constraints, função de liquidação | [`supabase/migrations/`](supabase/migrations/20261009000000_mini_locacao.sql) |
| Backend | Supabase Edge Function (Deno + TypeScript) | [`supabase/functions/webhook-pagamento/`](supabase/functions/webhook-pagamento) |
| Frontend | React + TypeScript + Tailwind (Vite) | [`web/`](web) |
| Testes | `node:test` + PGlite (Postgres real em WASM) | [`tests/`](tests) |

---

## Deploy

| | Link |
|---|---|
| Frontend (Vercel) | https://aluware-mini-locacao.vercel.app |
| Webhook (Supabase Edge Function) | `POST https://uujgutwvdmbxrtzqprwh.supabase.co/functions/v1/webhook-pagamento` |

---

## Rodando localmente

### 1. Só o frontend (modo demonstração — 1 minuto)

Sem nenhuma configuração, a tela roda com dados em memória que reproduzem as mesmas regras do banco:

```bash
cd web
npm install
npm run dev          # http://localhost:8080
```

### 2. Testes do banco e do webhook (sem Docker)

Os testes sobem um PostgreSQL real em memória (PGlite), aplicam a migration + seed e exercitam triggers, constraints e o handler HTTP do webhook:

```bash
npm install
npm test
```

```
✔ contrato ativo de R$ 400 x 4 semanas gera 4 faturas semanais
✔ contrato rascunho não gera faturas; ao ativar, gera uma única vez
✔ liquidação grava pago + data/hora no fuso de Brasília
✔ webhook repetido é idempotente: não altera a baixa original
✔ valor divergente não liquida
✔ fatura inexistente e fatura cancelada
✔ fatura paga não pode ser cancelada, alterada ou excluída
✔ fatura pendente pode ser cancelada e ter valor ajustado
✔ constraint impede marcar como pago sem dados de baixa
✔ view deriva status atrasado e seed tem cenários variados
✔ veículo não pode ter dois contratos ativos
✔ PAYMENT_RECEIVED com valor correto liquida (200)
✔ reenvio do mesmo webhook (inclusive em paralelo) responde 200 sem duplicar baixa
✔ valor divergente -> 422 e fatura continua pendente
✔ fatura inexistente -> 404
✔ payload inválido -> 400
✔ outros eventos são ignorados com 200
✔ token do webhook é exigido quando configurado
ℹ tests 18 · pass 18 · fail 0
```

### 3. Stack completa com Supabase

**Opção A — projeto na nuvem (não precisa de Docker)**

```bash
npx supabase login
npx supabase link --project-ref <SEU_PROJECT_REF>
npx supabase db push --include-seed            # migration + seed
npx supabase secrets set WEBHOOK_TOKEN=<um-segredo>   # opcional
npx supabase functions deploy webhook-pagamento --no-verify-jwt
```

**Opção B — Supabase local (requer Docker)**

```bash
npx supabase start          # aplica migration + seed automaticamente
npx supabase functions serve webhook-pagamento --no-verify-jwt
```

Depois, configure o frontend:

```bash
cd web
cp .env.example .env        # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

**Deploy do frontend (Vercel/Netlify):** root directory `web`, build `npm run build`, output `dist`, e as mesmas variáveis `VITE_*`.

### Testando o webhook via cURL

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/webhook-pagamento" \
  -H "Content-Type: application/json" \
  -H "asaas-access-token: $WEBHOOK_TOKEN" \
  -d '{"fatura_id":"<uuid>","valor_pago":400.00,"evento":"PAYMENT_RECEIVED"}'
```

Rode duas vezes: a primeira retorna `"resultado":"liquidada"`, a segunda `"resultado":"ja_processada"`. As duas retornam **200**.

---

## Decisões técnicas

### Banco de dados

- **Geração de faturas por trigger** (`trg_contratos_gerar_faturas`, `AFTER INSERT OR UPDATE OF status`). Contrato inserido como `ativo` (ou que muda de `rascunho` para `ativo`) gera `qtd_semanas` faturas com `generate_series`. A parcela *N* vence em `data_inicio + 7·N` dias. A geração não duplica porque o trigger checa se já existem faturas e porque há `UNIQUE (contrato_id, parcela)`.
- **Fatura paga é imutável** (`trg_faturas_proteger_paga`, `BEFORE UPDATE OR DELETE`). Bloqueia cancelamento, volta para pendente, mudança de valor, de vencimento ou dos dados de baixa, e exclusão. Isso é garantido no banco, então vale para qualquer cliente: API, painel SQL ou outro serviço.
- **Constraint `faturas_baixa_consistente`**: `status = 'pago'` exige `pago_em`, `pago_em_brt` e `valor_pago = valor`. Não existe "pago pela metade" nem "pago sem data".
- **Dinheiro em `numeric(12,2)`**, nunca `float`.
- **Fuso de Brasília**: `pago_em` é `timestamptz` (o instante absoluto, que é o correto para comparar e ordenar). `pago_em_brt` guarda o mesmo instante como relógio de parede de `America/Sao_Paulo`, conforme o requisito, e já vem pronto para relatórios e conciliação. O frontend também formata com `timeZone: 'America/Sao_Paulo'`, independente do fuso de quem acessa.
- **`atrasado` é derivado, não persistido**: a view `vw_faturas` calcula `pendente + vencimento < hoje (BRT)`. Isso dispensa cron job para "virar" status e evita fatura marcada como atrasada que já foi paga.
- **Extras**: um veículo não pode ter dois contratos ativos (índice único parcial), validação de CPF e placa Mercosul, e RLS habilitado com escrita apenas via `service_role`.

### Webhook: atomicidade e idempotência

Toda a regra crítica fica em **uma função no banco**, `liquidar_fatura(fatura_id, valor_pago)`, executada numa única transação:

1. `SELECT ... FOR UPDATE` trava a linha da fatura. Se o gateway disparar o mesmo webhook duas vezes **ao mesmo tempo**, o segundo espera o primeiro commitar.
2. Se a fatura já está `pago`, retorna `ja_processada` sem alterar nada e o endpoint responde **200** (o gateway para de reenviar).
3. Se o valor não bate (comparação em centavos), retorna `valor_divergente` e o endpoint responde **422**. A fatura continua pendente.
4. Caso contrário, faz `UPDATE` de status, `valor_pago`, `pago_em` e `pago_em_brt` de uma vez.

A Edge Function só faz validação de entrada, autenticação e o mapeamento resultado → HTTP:

| Situação | HTTP |
|---|---|
| Liquidada / já processada (reenvio) | 200 |
| Evento diferente de `PAYMENT_RECEIVED` | 200 (ignorado, para não gerar retentativas) |
| Payload inválido | 400 |
| Token inválido (quando `WEBHOOK_TOKEN` está configurado) | 401 |
| Fatura não encontrada | 404 |
| Fatura cancelada | 409 |
| Valor divergente | 422 |
| Erro inesperado | 500 (o gateway reenvia, o que é seguro porque a operação é idempotente) |

A função roda com `verify_jwt = false` porque o gateway não tem JWT do Supabase. A autenticação é feita pelo header `asaas-access-token`, como no Asaas, com comparação em tempo constante.

A lógica HTTP fica em `handler.ts`, sem dependências de runtime, e por isso os testes conseguem rodá-la em Node contra o Postgres real.

### Frontend

- Visual alinhado à identidade da Alu.GO: Montserrat, paleta de azuis (`--primary: 200 100% 50%`, azul-marinho), `gradient-primary`, `shadow-elegant` e tokens HSL no padrão shadcn/ui, a mesma base usada em alugomotos.com.br.
- Tabela no desktop, cards no mobile, filtros por status e cards de resumo (a receber, em atraso, recebido).
- **Feedback imediato**: a linha atualiza na hora (badge animado, destaque verde e horário da baixa), aparece um toast com o horário em Brasília, e a lista é recarregada em seguida para confirmar o estado do servidor.
- Botões de teste: **Simular pagamento**, **Reenviar webhook** (demonstra a idempotência) e **⊘** (simula Pix com valor divergente).

### Mensagens técnicas na tela (decisão consciente)

As notificações mostram uma linha pequena com detalhes técnicos, como `Webhook reenviado · HTTP 200 · idempotente` ou `HTTP 422 · valor_divergente`.

**Sabemos que isso não deve aparecer para o usuário final.** Num sistema real, o operador da locadora veria só a mensagem em linguagem simples (ex.: *"FAT-000002 já estava paga"*), sem termos como "webhook" ou códigos HTTP. Os botões **Reenviar webhook** e **⊘** também não existiriam, porque quem chama o webhook é o gateway de pagamento, não uma pessoa na tela.

Como este projeto é um **teste técnico**, deixamos esses detalhes visíveis de propósito, para quem avalia conferir os requisitos sem precisar abrir o DevTools: o reenvio responde **200 OK** sem duplicar a baixa, e o valor divergente é recusado com **422**. A mensagem principal já está escrita para o usuário final, e o detalhe técnico fica separado no campo `tecnico` do toast (`web/src/components/Toaster.tsx`). Para ir a produção, basta deixar de exibir esse campo.

---

## Estrutura

```
├── supabase/
│   ├── migrations/20261009000000_mini_locacao.sql   # tabelas, triggers, constraints, função, view, RLS
│   ├── seed.sql                                     # 3 clientes, 3 motos, 3 contratos ativos
│   ├── config.toml
│   └── functions/webhook-pagamento/
│       ├── index.ts      # entrypoint Deno (Supabase client + Deno.serve)
│       └── handler.ts    # validação, auth, mapeamento HTTP (testável)
├── tests/
│   ├── db.test.mjs       # regras do banco
│   └── webhook.test.mjs  # handler HTTP + banco
└── web/                  # React + TS + Tailwind
```
