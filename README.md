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

O cadastro com criação de grupo WhatsApp (`/cadastro/:slug`) depende destas variáveis, configuradas manualmente no EasyPanel (ver `.env.production.example`):

- `EVOLUTION_API_BASE_URL`: URL base da instância Evolution que cria o grupo do cliente.
- `EVOLUTION_API_INSTANCE`: nome da instância Evolution (`Avisos`).
- `EVOLUTION_API_KEY`: chave de autenticação da instância Evolution.
- `STAFF_GROUP_JID`: JID do grupo interno do Staff que recebe o aviso de novo cadastro.
- `PUBLIC_BASE_URL`: URL pública do serviço, usada para montar o link curto de convite ao grupo.
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: rate limit e cache de CNPJ; obrigatórias para `/api/sessions/create` e `/api/sessions/cadastro-submit`.

Depois do cadastro o serviço gera o contrato e cobra no Conta Azul (ver
`docs/superpowers/specs/2026-09-02-pos-cadastro-contrato-conta-azul-design.md`). Essas etapas dependem de:

- `OPENAI_API_KEY`: chave usada para ler o contrato social e o documento pessoal e identificar quem assina.
- `OPENAI_MODEL_EXTRACAO`: modelo da leitura. Padrão `gpt-5-mini`.
- `CA_INTERNAL_SECRET`: segredo compartilhado com o router de Conta Azul do site de vendas.
- `VENDAS_API_URL`: base do site de vendas. Padrão `https://pipeelo.com` — use o domínio primário, porque
  `vendas.pipeelo.com` só redireciona e o redirect pode descartar o corpo do POST.

Sem `OPENAI_API_KEY` o contrato fica pendente; sem `CA_INTERNAL_SECRET` a cobrança fica pendente. Nos dois
casos o cadastro e o grupo seguem normalmente e o `/admin` mostra o botão de reprocessar.

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
