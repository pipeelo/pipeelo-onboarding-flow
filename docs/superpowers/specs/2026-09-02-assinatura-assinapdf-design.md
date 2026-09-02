# Assinatura do contrato pela AssinaPDF — design

Data: 2026-09-02. Complementa `2026-09-02-pos-cadastro-contrato-conta-azul-design.md`
(que deixou o envio para assinatura "manual, decisão 7"). Agora o envio é automático.

## Objetivo

Depois que o pós-cadastro gera o contrato, o onboarding manda o contrato para a
AssinaPDF, envia o link de assinatura ao cliente e acompanha o status até o PDF
assinado chegar ao bucket. Ninguém da Pipeelo precisa entrar na AssinaPDF.

## Decisões (Felipe, 02/09)

1. **Validação com documentos.** O assinante envia selfie + documento na hora de
   assinar (layout com "Solicita documentos"). Alguém da Pipeelo aprova no `/admin`
   ("Aprovar assinatura") ou pede correção. Só depois o contrato finaliza.
2. **Link no WhatsApp do responsável + cópia no grupo.** DM pelo número Avisos para
   `responsavel_whatsapp` e uma mensagem no grupo "Pipeelo & {empresa}".
3. **Envio automático** logo após gerar o contrato. O `/admin` tem "Enviar para
   assinatura" (reprocessa) e "Reenviar link".

## Fatos da AssinaPDF (levantados em 02/09)

- Instância `https://pipeelo.assinapdf.com.br`, API em `/api/v1`, Bearer token do
  usuário Felipe (token guardado em env, nunca no repo).
- Só existem endpoints de **solicitação**. Sem webhook: status por polling.
- Estados: `pt1` criada → (assinando) → `pt7` aguardando validação → `fin` finalizada.
  Correção pedida volta o assinante para assinar de novo.
- O WhatsApp da instância (WAHA) está desconectado. Usamos `get-initial-link` e
  mandamos o link pela nossa Evolution.
- PDF final é servido em `{base}/img/cliente/{nome}` (público, nome previsível:
  `{cpf}_{id}_{layout}.pdf`; assinado ganha sufixo `_assinado`).
- Configurado no painel em 02/09: Empresa 1 = PIPEELO LTDA (Alisson, CPF); layout 2
  "Contrato Pipeelo" (automático, 0 testemunhas, 1 assinante "Contratante" com
  documentos, categoria Comercial). Falta o Felipe subir a **imagem da assinatura**
  da empresa (Configurações › Empresas › Assinatura).

## Fluxo

```
gerarContratoParaSessao  →  .docx + .pdf no bucket onboarding-contratos
        │
        ▼
enviarParaAssinatura (api/_lib/assinatura.ts)
  1. POST /solicitacoes            cpf/nome do representante (extração), endereço da sede,
                                   telefone do responsável, e-mail do contrato, empresa 1,
                                   categoria 2, tipo "Contratação", plano = nome fantasia
  2. POST /{id}/add-document       PDF do bucket, layout 2
  3. POST /{id}/get-initial-link   posicaoCli 0, meio 'w'
  4. Evolution: DM responsável + mensagem no grupo (grupo_jid relido do banco)
  5. sessão: assinapdf_solicitacao_id, assinapdf_link, assinatura_status='enviado'
        │
        ▼ (polling a cada 10 min — server/index.ts, e endpoint /api/cron/assinatura-poll)
consultar /{id} → estado
  pt7  → 'aguardando_validacao' + aviso no Staff (link do /admin)
  fin  → 'finalizado' + baixa PDF assinado para o bucket + aviso no Staff
        │
        ▼ /admin
"Ver documentos"  GET signer-docs (selfie, documento, assinatura)
"Aprovar"         POST validate-request → fin → baixa assinado
"Pedir correção"  POST fix-request (motivo + itens) → 'correcao' + DM ao responsável
```

## Estados de `assinatura_status`

`pendente` (contrato gerado, não enviado) · `enviado` · `aguardando_validacao` ·
`correcao` · `finalizado` · `erro` (motivo em `assinatura_erro`).

## Colunas novas em `onboarding_sessions`

`contrato_pdf_path`, `assinapdf_solicitacao_id` (int), `assinapdf_link`,
`assinapdf_estado`, `assinatura_enviada_at`, `assinatura_assinada_at`,
`assinatura_finalizada_at`, `assinatura_erro`, `contrato_assinado_path`,
`assinatura_consultada_at`.

## Envs (serviço onboarding-pipeelo)

`ASSINAPDF_BASE_URL=https://pipeelo.assinapdf.com.br`, `ASSINAPDF_TOKEN`,
`ASSINAPDF_EMPRESA_ID=1`, `ASSINAPDF_CATEGORIA_ID=2`, `ASSINAPDF_LAYOUT_ID=2`,
`ASSINAPDF_TIPO=Contratação`, `ASSINATURA_POLL_MINUTOS=10` (0 desliga).

## Regras

- Nunca lança: falha vira `assinatura_status='erro'` + `assinatura_erro`, e o Staff
  recebe o motivo. Botões do `/admin` reprocessam.
- Reexecutável: sessão com `assinapdf_solicitacao_id` e sem erro não cria outra
  solicitação; "Reenviar link" só reenvia as mensagens.
- Sem `ASSINAPDF_TOKEN` a etapa é pulada com motivo claro (igual ao Conta Azul).
- O PDF é renderizado da mesma estrutura do template (`parseTemplate`) que gera o
  `.docx`: uma fonte só.
