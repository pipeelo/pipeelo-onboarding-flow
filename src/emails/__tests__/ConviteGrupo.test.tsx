import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import * as React from 'react';
import ConviteGrupo from '../ConviteGrupo';

describe('ConviteGrupo', () => {
  it('renderiza nome, grupo e link', async () => {
    const html = await render(
      <ConviteGrupo nome="Ana" empresaNome="Provedor X" grupoNome="Pipeelo & Provedor X" inviteUrl="https://chat.whatsapp.com/abc" />
    );
    expect(html).toContain('Ana');
    expect(html).toContain('Pipeelo &amp; Provedor X');
    expect(html).toContain('https://chat.whatsapp.com/abc');
  });
});
