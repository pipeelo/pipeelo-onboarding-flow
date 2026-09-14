# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Variáveis de ambiente (EasyPanel, serviço onboarding-pipeelo)

O cadastro (`/cadastro/:slug`) depende destas variáveis, configuradas manualmente no EasyPanel (ver `.env.production.example`):

- `EVOLUTION_API_BASE_URL`: URL base da instância Evolution que cria o grupo do cliente.
- `EVOLUTION_API_INSTANCE`: nome da instância Evolution (`Avisos`).
- `EVOLUTION_API_KEY`: chave de autenticação da instância Evolution.
- `STAFF_GROUP_JID`: JID do grupo interno do Staff que recebe o aviso de novo cadastro.
- `SOCIOS_GROUP_JID`: JID do grupo dos sócios. Recebe só os avisos de assinatura do contrato (envio do link, cliente assinou, contrato finalizado).
- `PUBLIC_BASE_URL`: URL pública do serviço, usada para montar o link curto do formulário.
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: rate limit e cache de CNPJ; obrigatórias para `/api/sessions/create` e `/api/sessions/cadastro-submit`.

## Criação do grupo do cliente: MANUAL (desde 10/09/2026)

O onboarding **não cria mais o grupo do WhatsApp pela API**. Em 10/09/2026 a instância
`Grupos` (551152414872) levou bloqueio 403 do WhatsApp no instante em que tentou criar o
grupo da GOLDFIBRA — doze segundos depois do cadastro entrar, com a conta ociosa e antes
de adicionar qualquer participante. Foi o segundo grupo do dia; o primeiro nasceu normal.
Ritmo humano não resolve bloqueio de conta.

No lugar disso, `enviarInstrucoesGrupo` (`api/_lib/grupo-instrucoes.ts`) gera o link curto
do formulário e manda o roteiro no grupo Staff: nome exato do grupo, contatos a adicionar
com telefone formatado, quem vira admin e a mensagem de boas-vindas pronta para colar.
O Lucas cria o grupo à mão a partir dele. A sessão é carimbada em
`grupo_instrucoes_enviadas_at`; falha em avisar o Staff cai em `grupo_erro`.

O aviso sai pela instância que estiver no grupo Staff — `sendText` sonda antes de mandar,
então continua funcionando com a `Grupos` fora do ar.

A automação **não foi removida**: `criarGrupoParaSessao` segue disponível no botão
"Recriar grupo" do `/admin`, para quando a instância voltar a ser confiável.

Depois do cadastro o serviço gera o contrato e cobra no Conta Azul (ver
`docs/superpowers/specs/2026-09-02-pos-cadastro-contrato-conta-azul-design.md`). Essas etapas dependem de:

- `OPENAI_API_KEY`: chave usada para ler o contrato social e o documento pessoal e identificar quem assina.
- `OPENAI_MODEL_EXTRACAO`: modelo da leitura. Padrão `gpt-5-mini`.
- `CA_INTERNAL_SECRET`: segredo compartilhado com o router de Conta Azul do site de vendas.
- `VENDAS_API_URL`: base do site de vendas. Padrão `https://pipeelo.com` — use o domínio primário, porque
  `vendas.pipeelo.com` só redireciona e o redirect pode descartar o corpo do POST.

Sem `OPENAI_API_KEY` o contrato fica pendente; sem `CA_INTERNAL_SECRET` a cobrança fica pendente. Nos dois
casos o cadastro e o grupo seguem normalmente e o `/admin` mostra o botão de reprocessar.

O pipeline pós-cadastro roda em background no processo do EasyPanel (`server/index.ts`), depois da resposta
HTTP — não em função da Vercel, que encerraria o processo antes de o contrato e a cobrança terminarem.

O envio para assinatura eletrônica ainda é manual: o contrato nasce com `assinatura_status = 'pendente'`
e a etapa automática entra quando o parceiro do Assina PDF liberar a API (decisão 7 do design).

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
