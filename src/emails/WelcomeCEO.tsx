import { Button, Text, Heading, Link } from '@react-email/components';
import * as React from 'react';
import { Layout } from './_shared/Layout';
import { EMAIL_COLORS } from './_shared/tokens';
import { GUIA_ONBOARDING_URL } from '../../api/_lib/welcome-template';

const TEXTO_GUIA =
  'Antes de começar, veja o passo a passo de cada etapa: o que responder, o que ter em mãos e o formato certo dos dados de integração.';

export interface WelcomeCEOProps {
  ceoNome: string;
  empresaNome: string;
  magicLink: string;
}

/**
 * WelcomeCEO — Primeiro contato com o CEO da ISP.
 *
 * Voz: calma, direta, sem hype. Fala "começa aqui" e dá tempo estimado real.
 * Sem emojis. Magic link é o único hyperlink primário.
 */
export function WelcomeCEO({ ceoNome, empresaNome, magicLink }: WelcomeCEOProps) {
  return (
    <Layout preview={`Seu onboarding Pipeelo começa aqui — 45min até seu agente live`}>
      <Heading
        as="h1"
        style={{
          color: EMAIL_COLORS.ink,
          fontSize: '24px',
          lineHeight: '32px',
          margin: '0 0 16px',
          fontWeight: 700,
        }}
      >
        Olá, {ceoNome}.
      </Heading>

      <Text
        style={{
          color: EMAIL_COLORS.ink,
          fontSize: '16px',
          lineHeight: '24px',
          margin: '0 0 16px',
        }}
      >
        Bem-vindo à Pipeelo. Este é o ponto de partida para colocar a{' '}
        <strong style={{ color: EMAIL_COLORS.mint }}>{empresaNome}</strong> no
        ar com um agente de atendimento configurado especificamente para a sua
        operação.
      </Text>

      <Text
        style={{
          color: EMAIL_COLORS.ink,
          fontSize: '16px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        São 5 departamentos para responder. Tempo estimado: <strong>45 minutos</strong>.
        Você pode pausar e retomar quando precisar — salvamos a cada resposta.
      </Text>

      <Button
        href={magicLink}
        style={{
          backgroundColor: EMAIL_COLORS.mint,
          color: EMAIL_COLORS.forest,
          fontWeight: 700,
          padding: '14px 28px',
          borderRadius: '8px',
          fontSize: '16px',
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        Começar onboarding
      </Button>

      <Text
        style={{
          color: EMAIL_COLORS.ink,
          fontSize: '14px',
          lineHeight: '22px',
          margin: '24px 0 0',
        }}
      >
        {TEXTO_GUIA}{' '}
        <Link href={GUIA_ONBOARDING_URL} style={{ color: EMAIL_COLORS.mint, fontWeight: 700 }}>
          Abrir o guia de preenchimento
        </Link>
        . Ficou dúvida? Chame o time Pipeelo no grupo de WhatsApp.
      </Text>

      <Text
        style={{
          color: EMAIL_COLORS.muted,
          fontSize: '13px',
          lineHeight: '20px',
          margin: '32px 0 0',
        }}
      >
        Se o botão não funcionar, copie e cole esta URL no navegador:
        <br />
        <span style={{ color: EMAIL_COLORS.mint, wordBreak: 'break-all' }}>
          {magicLink}
        </span>
      </Text>

      <Text
        style={{
          color: EMAIL_COLORS.ink,
          fontSize: '14px',
          lineHeight: '20px',
          margin: '32px 0 0',
        }}
      >
        Equipe Pipeelo
      </Text>
    </Layout>
  );
}

export default WelcomeCEO;
