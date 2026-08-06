# Equipe e Acessos no Onboarding — Design

**Data:** 2026-08-06 · **Status:** aprovado por Felipe

## Objetivo

O cliente ISP entrega, durante o onboarding, a estrutura de departamentos com separação
por cidade e as pessoas que vão operar a plataforma (nome, e-mail, departamento, cidade,
papel) — já organizada, para o time Pipeelo criar os acessos sem retrabalho.

## Decisões

1. **Formato: híbrido.** Formulário estruturado no app (caminho principal) + planilha
   modelo para download com exemplo preenchido (estilo Techy/AGT) + upload da planilha
   preenchida para quem preferir.
2. **Destino: só coletar.** Respostas entram no payload final da sessão (`session.*`)
   como as demais. Criação de departamentos/acessos na plataforma segue manual (time
   onboarding). Nenhuma mudança no provision-tenant.
3. **Posição: seção nova no `sac_geral`**, imediatamente após a seção existente
   `estrutura_departamentos` (que já coleta quais departamentos existem e o que cada um
   trata — NÃO duplicar). A seção nova chama **"Equipe e Acessos"** e cobre o que falta:
   separação por cidade + pessoas + planilha.

## Perguntas novas (seção `equipe_acessos`, sac_geral)

| id | tipo | condicional | conteúdo |
|---|---|---|---|
| `_equipe_intro` | `info` | — | Explica por que precisamos da equipe organizada (criar acessos) com exemplo Financeiro/Suporte por cidade |
| `equipe_planilha_modelo` | `info_link` | — | Botão para baixar `/modelo-departamentos-equipe.xlsx` |
| `departamentos_por_cidade` | `select` sim/não | — | "O atendimento é separado por cidade/unidade?" |
| `departamentos_cidades_detalhe` | `textarea` | `== 'sim'` | Quais cidades e como os departamentos se dividem entre elas |
| `equipe_forma_entrega` | `select` | — | "Preencher aqui" / "Enviar planilha preenchida" |
| `equipe_pessoas` | `repeater` | `== 'formulario'` | nome (text), email (text), departamentos (text), cidade (text), papel (select gestor/atendente) |
| `equipe_planilha_upload` | `file_upload` | `== 'planilha'` | Upload .xlsx/.xls/.csv, máx. 5MB |
| `equipe_observacoes` | `textarea` opcional | — | Casos que não couberam na estrutura |

Nada trava avanço (padrão do app); obrigatoriedade é visual. Bump de `versao` do
questions.json (3.3.0 → 3.4.0) e `total_perguntas`.

## Tipo novo: `file_upload`

- **Renderer:** input de arquivo estilizado; valida extensão/tamanho no cliente; envia
  base64 para a API; salva na resposta `{ path, nome_original, tamanho }`.
- **API:** action novo `upload-arquivo` em `api/sessions/[action].ts` (+ handler
  `_upload-arquivo.ts` + rota no `server/index.ts`). Auth pelo mesmo
  `assertSessionAccess(slug, token)` dos demais. Limites: 5MB, extensões xlsx/xls/csv.
- **Storage:** bucket privado `onboarding-uploads` no Supabase do projeto (nhnz),
  escrito via service role no servidor. Path: `{session_id}/{pergunta_id}/{timestamp}-{nome}`.
- Front continua sem falar direto com o banco (HARD-01 preservado).

## Planilha modelo

`public/modelo-departamentos-equipe.xlsx`, 2 abas, com exemplo fictício:

- **Departamentos:** Nome | Cidades que atende | O que trata (ex.: Financeiro → 2ª via,
  desbloqueio em confiança, negociação; Suporte N1/N2 por cidade; Comercial).
- **Equipe:** Nome | E-mail | Departamento(s) | Cidade/Unidade | Papel (Gestor/Atendente).

Gerada por script (`scripts/gen-modelo-equipe.mjs`) e commitada como asset estático.

## Deploy e verificação

Vitest + build local → `public/build-info.json` (sonda `equipe-acessos`) → commit só dos
arquivos tocados (working tree tem lixo de outras sessões) → push `main` → EasyPanel
builda sozinho → confirmar `GET onboarding.pipeelo.com/build-info.json`.

## Fora de escopo

- Provisionamento automático de usuários/departamentos no admin.pipeelo.com.
- Parse do XLSX enviado (time lê o arquivo manualmente).
- Validação FK pessoa→departamento (texto livre; time revisa).
