# AETERNUM Agro Agent Kit para a XRP Ledger

*Peças abertas para agentes que leem dado agro, decidem dentro de um mandato escrito e pagam na XRP Ledger.*
Por **AETERNUM AURUM PARTNERS** · Apache-2.0 · versão 0.1.0 · [English](README.md)

> **Situação:** 0.1, exemplos só na Testnet. Nada aqui é recomendação de investimento. Os exemplos usam dado público (NOAA/CPC, NASA POWER) e valores fictícios marcados como exemplo.

## Por quê
Um agente que movimenta dinheiro no comércio agrícola precisa de três coisas antes de pagar alguém:

1. **dado que dá para conferir**: indicador medido, com fonte, data e um hash que qualquer um confere;
2. **contraparte verificada**: credencial na própria rede, aceita e dentro da validade;
3. **limite escrito antes de rodar**: por pagamento, por dia, por contraparte, por semana, por ano.

O kit entrega essas três peças e um jeito de outros agentes consultarem e pagarem pelo dado.

## Módulos
| # | Módulo | O que faz | Recursos da XRPL |
|---|---|---|---|
| 1 | `oracle` | Publica **classes** agro (fase do ENSO, chuva contra a normal), nunca preço, num oráculo na rede, com o sha256 do registro de origem no URI; lê de volta e confere | PriceOracle (XLS-47) |
| 2 | `mandate` | Formato aberto de regras de gasto e um motor que responde **PAGA** ou **RECUSA** com o motivo; lê a credencial da contraparte na rede; monta o pagamento | Credentials, tokens emitidos |
| 3 | `quant/` (Python) | Métodos para agentes que fazem hedge e liquidam: razão de cobertura de variância mínima com teste fora da amostra, risco cambial pelo prazo de liquidação, custos de carregamento e de trânsito, protocolo de pré-registro; só séries públicas (veja [`quant/README.md`](quant/README.md)) | — |
| 4 | `access` | **Servidor MCP** só de leitura dos registros de classe e **pagamento por consulta** (no estilo x402) liquidado na XRPL | Payments, memos |

## Começo rápido
Precisa de Node.js 20 ou mais novo.
```
npm install            # única dependência: xrpl 5.3.0
npm test               # 25 testes, sem rede e sem chave
cd quant && python -m pytest -q tests   # módulo 3: 13 testes (precisa de numpy)
```

### Módulo 1: publicar e conferir um oráculo de classe (Testnet)
```
# sem enviar: monta e preenche, não assina nada
KIT_XRPL_SEED=<sua seed de Testnet> node examples/publish-oracle.js examples/enso-record.json
# envia, lê de volta e confere o hash e os valores
KIT_XRPL_SEED=<sua seed de Testnet> node examples/publish-oracle.js examples/enso-record.json --send
# lê o oráculo de qualquer conta (sem chave)
node examples/read-oracle.js <conta> <documentId> [registro.json]
```
Regras de campo que aprendemos na Testnet e que já estão no código:
- a classe vai como `AssetPrice = classe × 10` com `Scale = 1` (o xrpl.js 5.3.0 recusa `Scale` 0 escrito e exige `Scale` junto do `AssetPrice`);
- `AssetClass` com até 8 letras ASCII; `LastUpdateTime` em segundos Unix;
- toda atualização reenvia todos os pares (o par que fica de fora perde o valor); para apagar um par, envie-o sem `AssetPrice` e sem `Scale`;
- o `URI` leva `sha256:<hash do registro canônico>`: quem tem o arquivo do registro confere a rede.

### Módulo 2: decidir dentro de um mandato
```js
import { freezeMandate, readCredential, evaluate, buildPayment } from "aeternum-agro-agent-kit/mandate";
const m = freezeMandate(meuMandato);                 // escrito ANTES de o agente rodar; congelado; mudanças revisadas como diff
const cred = await readCredential(client, transportadora, m.counterparty.credential.issuer, m.counterparty.credential.type);
const d = evaluate(m, pedido, pagosAntes, cred, hoje); // { allow, reason }
if (d.allow) { /* assina e envia buildPayment(m, agente, pedido) */ } else { /* registra d.reason; nenhuma transação */ }
```
Veja `examples/mandate-freight.json` (números ilustrativos).

### Módulo 4: MCP e pagamento por consulta
```
node examples/mcp-server.js                 # servidor MCP por stdio: get_enso_phase, get_rain_class_ex, get_proof
KIT_X402_PAYTO=<recebedor> KIT_X402_ISSUER=<emissor do token> node examples/x402-server.js   # só local, 127.0.0.1:4020
KIT_XRPL_SEED=<seed do agente> KIT_X402_PAYTO=<recebedor> node examples/x402-agent.js [--send]
```
**O x402 na XRPL é uma adaptação não padrão.** O x402 nasceu em redes EVM, com autorização assinada e um "facilitador". Aqui o agente paga primeiro na XRPL com o id da fatura no memo e repete o pedido com o cabeçalho `X-PAYMENT`, que leva o hash da transação. O servidor confere lendo a rede: validada, `tesSUCCESS`, destino, valor e token **entregues**, memo, sem reuso, dentro do prazo. O servidor não guarda chave.

## No ar na XRPL Testnet (17/11/2026)
Feito com este método pela AETERNUM AURUM PARTNERS. Tudo na Testnet, com token de teste sem valor:
- oráculo de classe com a fase do ENSO e uma classe de risco de exemplo (`RISCO_EX_…`), cada um com o hash do registro no URI;
- um agente que pagou uma transportadora verificada dentro do mandato e recusou um pedido acima do limite e uma contraparte sem credencial, sem enviar transação;
- uma compra do indicador do ENSO por consulta: 402 → pagamento → 200;
- escrows condicionados que só o agente que decide libera (um liberado, um cancelado e devolvido);
- um lote fictício de café como recibo MPT que só um titular verificado pôde receber (a rede recusou o não verificado).

Os hashes estão em [`docs/testnet-evidence.md`](docs/testnet-evidence.md).

## O que este kit NÃO é
- não é fonte de dado: os registros em `examples/` são ilustrativos; publique o seu dado medido;
- não traz modelo proprietário, calibração, classe de risco regional, preço nem dado de cliente;
- não é custódia, câmbio nem serviço de investimento; o motor do mandato decide só dentro das regras que você escreve;
- não foi auditado para a Mainnet. Usar na Mainnet é decisão e responsabilidade de quem usa.

## Próximos passos
- 0.2: escrow liberado só quando a classe do oráculo e a credencial batem; Permissioned Domains; um lote fictício de café como recibo MPT com o hash dos metadados (XLS-89).
- A liquidação condicionada (`settlement`, módulo 2b) entrou na 0.2: escrow com condição PREIMAGE-SHA-256, liberado só pelo agente que decide.

## Licença
Apache License 2.0: veja [LICENSE](LICENSE) e [NOTICE](NOTICE). © 2026 AETERNUM AURUM PARTNERS.
