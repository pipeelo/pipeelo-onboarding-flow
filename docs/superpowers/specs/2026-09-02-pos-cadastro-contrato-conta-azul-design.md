# Pós-cadastro: contrato automático + cobrança no Conta Azul — Design

**Data:** 2026-09-02 · **Status:** rascunho para revisão do Felipe (desenho aprovado em chat na madrugada de 02/09)

## Objetivo

Quando o cliente envia o cadastro (`/cadastro/{slug}`), além do grupo de WhatsApp o sistema:

1. Lê o contrato social e o documento pessoal enviados, identifica o **sócio administrador** e
   preenche o contrato Pipeelo (v5 FINAL ou v5-CRM FINAL) com Anexo I vindo do fechamento.
2. Cria o cliente no **Conta Azul** e gera a cobrança da **implantação** e da **1ª mensalidade**
   com os valores e datas definidos no fechamento do CRM, e agenda o recorrente no dia de
   vencimento escolhido pelo cliente.
3. Entrega tudo no Staff, no `/admin` e no e-mail do cliente. Envio para assinatura no
   **Assina PDF** (ferramenta de parceiro) entra quando a API deles chegar.

Nada disso bloqueia o grupo nem o onboarding: cada etapa falha isolada, registra o motivo
e ganha botão de reprocessar no `/admin`.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| 1 | Leitura dos documentos por IA no servidor, com a **chave da OpenAI** já existente no admin-pipeelo (`OPENAI_API_KEY` no serviço `onboarding-pipeelo`). Modelo com entrada de PDF/imagem. | Felipe quer manter a leitura como faz hoje na skill; sem campos extras para o cliente. |
| 2 | Regra do representante = a da skill `pipeelo-financeiro`: cláusula de administração → 1 admin usa; 2+ → o que tem documento pessoal; ambos com documento ou sem cláusula → **não gera** e pergunta no Staff. | Nunca inventar quem assina. |
| 3 | Contrato gerado no servidor a partir de **templates .docx com placeholders**, derivados dos arquivos v5 FINAL (IA) e v5-CRM FINAL (IA+CRM) da pasta `pipe/Contratos`. Escolha pelo `contratou_crm` da sessão. | Reaproveita o texto jurídico aprovado; sem LLM escrevendo cláusula. |
| 4 | Valores do fechamento que faltam hoje entram no passo "Iniciar onboarding" do CRM: **valor da implantação**, **data de pagamento da implantação**, **data da 1ª mensalidade**. Passam pela Central e viram colunas da sessão. Já existem: `valor_sessao`, `qtd_sessoes`, `valor_mensal`, `dia_vencimento`, `erp`, `contratou_crm`. | Felipe define deal a deal. |
| 5 | Conta Azul continua no router do site de vendas (`vendas.pipeelo.com/api/conta-azul`), que ganha a action `cadastro` aceitando valores e datas (hoje `registrar` fixa vencimento em hoje+3). Autenticação por `CA_INTERNAL_SECRET` compartilhado com o onboarding. | Uma única integração OAuth com o Conta Azul; não duplicar token. |
| 6 | Ordem no `cadastro-submit`: salvar → grupo (como hoje) → **contrato** → **Conta Azul** → aviso único no Staff com os três blocos. Contrato e cobrança rodam em background (`void`), o cliente não espera. | Resposta rápida ao cliente; Staff vê tudo numa mensagem. |
| 7 | Assinatura: etapa plugável `enviarParaAssinatura(contrato)` que hoje só registra "pendente" e mostra o link do `.docx`. Implementação real quando o parceiro do Assina PDF fornecer API + credencial. | Sem API não há como automatizar. |

## Fluxo

```
cadastro-submit (após grupo)
  ├─ extrairDocumentos(uploads)           OpenAI → { empresa, representante, confianca, ambiguidades[] }
  ├─ gerarContrato(sessao, cadastro, ext) docx-template → bucket `onboarding-contratos` → sessao.contrato_path
  ├─ cobrarContaAzul(sessao, cadastro)    POST site /api/conta-azul?action=cadastro → { cliente_id, implantacao{url,venc}, mensalidade{url,venc}, recorrente }
  └─ notifyStaff(mensagem com grupo + contrato + boletos + pendências)
```

## Dados

### Extração (OpenAI, JSON estrito)
Entrada: arquivos de `doc_contrato_social` e `doc_responsaveis` (PDF/JPG/PNG do bucket).
Saída: `{ razao_social, cnpj, endereco_sede, administradores: [{nome, cpf?, cargo}], representante: {nome, cpf, rg, orgao_rg, uf_rg, estado_civil, profissao, endereco} | null, motivo_ambiguidade?: string }`.
Divergência entre documento e cadastro (razão social/CNPJ) → aviso no Staff, cadastro prevalece no Anexo, documento prevalece na qualificação das partes.

### Placeholders do contrato
Os da skill (`{{CONTRATANTE_*}}`, `{{ANEXO_*}}`, `{{DATA_ASSINATURA}}` = data do envio do cadastro, `{{CONTRATANTE_CIDADE_ASSINATURA}}` = município do CNPJ via BrasilAPI). `{{ANEXO_TAXA_IMPLANTACAO}}` e `{{ANEXO_DATA_VENCIMENTO_IMPL}}` vêm dos campos novos; `{{ANEXO_PRAZO_TESTES}}` padrão 10 dias (cronograma de 30 dias).

### Colunas novas em `onboarding_sessions`
`valor_implantacao numeric`, `implantacao_vencimento date`, `primeira_mensalidade_em date`,
`contrato_path text`, `contrato_gerado_at timestamptz`, `contrato_erro text`, `contrato_extracao jsonb`,
`ca_cliente_id text`, `ca_implantacao_url text`, `ca_mensalidade_url text`, `ca_cobrado_at timestamptz`, `ca_erro text`,
`assinatura_status text` ('pendente' | 'enviado' | 'assinado').

### Conta Azul — action `cadastro` (site)
Body: `{ secret, empresa: {razao_social, cnpj, email_cobranca, telefone, endereco}, implantacao: {valor, vencimento}, mensalidade: {valor, primeira_em, dia_vencimento}, sessao_slug }`.
Faz: pessoa (idempotente por CNPJ) → venda implantação (venc = `implantacao.vencimento`) → venda 1ª mensalidade (venc = `primeira_em`) → contrato recorrente a partir do mês seguinte no `dia_vencimento`. Grava em `ca_clientes` com `sessao_slug`. Devolve URLs dos boletos.

## Mudanças por repo

- **crm-pipeelo-rev:** 3 campos no "Iniciar onboarding" (valor implantação, pagamento da implantação, 1ª mensalidade) + payload + testes. Edge repassa.
- **pipeelo-central:** `montarPedidoOnboarding` aceita e repassa os 3 campos para `sessions-create`.
- **pipeelo-onboarding-flow:** `sessions-create` aceita os 3 campos; migration; `api/_lib/contrato/` (extração, template, geração), `api/_lib/conta-azul.ts` (cliente HTTP do router), `cadastro-submit` orquestra; `/admin` mostra contrato/boletos e botões "Gerar contrato" e "Cobrar no Conta Azul"; endpoints admin de reprocesso; Staff message ampliada; templates `.docx` com placeholders em `api/_lib/contrato/templates/` (gerados a partir dos v5 por script, revisados à mão).
- **pipeelo-site (vendas):** action `cadastro` no router `api/conta-azul.js` + `CA_INTERNAL_SECRET` também no onboarding. ⚠️ Repo ainda não existe (pasta local + Vercel CLI); criar `pipeelo/pipeelo-site` privado antes, com mídia fora do git e `ca_token.txt` fora.

## Envs novas (onboarding-pipeelo)
`OPENAI_API_KEY`, `CA_INTERNAL_SECRET`, `VENDAS_API_URL=https://vendas.pipeelo.com`.

## Fora de escopo
- Assinatura eletrônica real (aguarda API do Assina PDF).
- Reemissão/cancelamento de boletos pelo `/admin`.
- Clientes já existentes no Conta Azul com CNPJ diferente do cadastro.

## Perguntas em aberto
1. Confirmar valor padrão do prazo de testes (10 dias) e se a data de go-live entra no contrato.
2. Recorrente no Conta Azul: começa no mês seguinte à 1ª mensalidade, no `dia_vencimento`? (assumido sim)
