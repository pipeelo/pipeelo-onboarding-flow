import { Button, Text, Heading } from '@react-email/components';
import * as React from 'react';
import { Layout } from './_shared/Layout';
import { EMAIL_COLORS } from './_shared/tokens';

export interface ConviteGrupoProps {
  nome: string;
  empresaNome: string;
  grupoNome: string;
  inviteUrl: string;
}

const text = { color: EMAIL_COLORS.ink, fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' } as const;

/**
 * ConviteGrupo — enviado quando o WhatsApp da pessoa não pôde ser adicionado ao grupo
 * pela API (configuração de privacidade). Um único link primário: o convite.
 */
export function ConviteGrupo({ nome, empresaNome, grupoNome, inviteUrl }: ConviteGrupoProps) {
  return (
    <Layout preview={`Entre no grupo ${grupoNome} no WhatsApp`}>
      <Heading as="h1" style={{ color: EMAIL_COLORS.ink, fontSize: '24px', lineHeight: '32px', margin: '0 0 16px', fontWeight: 700 }}>
        Olá, {nome}.
      </Heading>
      <Text style={text}>
        Criamos o grupo <strong style={{ color: EMAIL_COLORS.mint }}>{grupoNome}</strong> no WhatsApp
        para acompanhar a implantação da {empresaNome}. Seu número não permite ser adicionado
        automaticamente, então entre pelo link abaixo.
      </Text>
      <Button href={inviteUrl} style={{ backgroundColor: EMAIL_COLORS.mint, color: EMAIL_COLORS.forest, padding: '12px 20px', borderRadius: '8px', fontWeight: 700 }}>
        Entrar no grupo
      </Button>
      <Text style={{ ...text, color: EMAIL_COLORS.muted, fontSize: '14px', margin: '24px 0 0' }}>
        Se o botão não abrir, copie este endereço: {inviteUrl}
      </Text>
    </Layout>
  );
}

export default ConviteGrupo;
