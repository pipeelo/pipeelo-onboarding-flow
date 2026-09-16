/** Guia público do preenchimento (portal de treinamentos, sem login). Espelha `src/lib/questions.json`. */
export const GUIA_ONBOARDING_URL = 'https://treinamentos.pipeelo.com/onboarding';

export const WELCOME_TEMPLATE = (link: string) => `🎉 *Parabéns pela decisão!*

Seja muito bem-vindo(a) à Pipeelo! A partir de agora você dá um grande passo na *automatização do seu provedor* — e a gente vai trilhar esse caminho junto com você.

O *primeiro passo* dessa jornada é o preenchimento do formulário de onboarding. É com base nessas informações que a sua inteligência artificial vai ser treinada e personalizada pro seu provedor.

🔗 *Link do formulário:* ${link}

📘 *Guia de preenchimento:* ${GUIA_ONBOARDING_URL}
Passo a passo de cada etapa: o que responder, o que ter em mãos e o formato certo dos dados de integração (endereço da API, usuário, token). Vale abrir antes de começar.

Você pode preencher tudo de uma vez ou no seu ritmo — as informações ficam salvas automaticamente. Cada área pode preencher o seu formulário em paralelo.

Ficou dúvida em alguma pergunta? É só chamar aqui no grupo.

Logo após a finalização, você receberá as informações sobre os próximos passos. 🚀`;
