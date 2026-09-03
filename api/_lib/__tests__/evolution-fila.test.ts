import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enfileirar, ganharSlot, proximoItem, reivindicar, concluir, falhar, pausarFila,
  resumoDaSessao, intervaloSegundos, type ItemFila,
} from '../evolution-fila';

type Resultado = { data?: unknown; error?: unknown };

/** Query builder encadeável e "thenable", como o do supabase-js. */
function builder(res: Resultado) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'upsert', 'insert', 'eq', 'lte', 'or', 'order', 'limit', 'in', 'is']) {
    b[m] = vi.fn(() => b);
  }
  b.then = (ok: (v: Resultado) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, err);
  return b as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

function supabaseCom(res: Resultado) {
  const b = builder(res);
  const from = vi.fn(() => b);
  return { client: { from } as never, b, from };
}

const item: ItemFila = {
  id: 'i1', session_id: 's1', tipo: 'add', grupo_jid: '1@g.us', instancia: 'grupos',
  payload: { jid: '5511900000001@s.whatsapp.net' }, chave: 'add:s1:5511900000001',
  status: 'pendente', tentativas: 0, max_tentativas: 5,
};

describe('evolution-fila', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete process.env.EVOLUTION_FILA_MIN_SEGUNDOS;
    delete process.env.EVOLUTION_FILA_MAX_SEGUNDOS;
  });

  describe('intervaloSegundos', () => {
    it('usa o padrão de 45s a 120s', () => {
      expect(intervaloSegundos()).toEqual({ min: 45, max: 120 });
    });

    it('respeita as env vars e corrige min/max invertidos', () => {
      process.env.EVOLUTION_FILA_MIN_SEGUNDOS = '200';
      process.env.EVOLUTION_FILA_MAX_SEGUNDOS = '100';
      expect(intervaloSegundos()).toEqual({ min: 100, max: 200 });
    });
  });

  describe('enfileirar', () => {
    it('espaça os itens pelo intervalo mínimo, preservando a ordem recebida', async () => {
      process.env.EVOLUTION_FILA_MIN_SEGUNDOS = '60';
      const sb = supabaseCom({ error: null });

      await enfileirar(sb.client, [
        { sessionId: 's1', tipo: 'texto', grupoJid: '1@g.us', instancia: 'grupos', chave: 'k1', payload: { texto: 'oi' } },
        { sessionId: 's1', tipo: 'add', grupoJid: '1@g.us', instancia: 'grupos', chave: 'k2', payload: { jid: 'j@s' } },
        { sessionId: 's1', tipo: 'resumo', grupoJid: '1@g.us', instancia: 'grupos', chave: 'k3' },
      ]);

      const linhas = sb.b.upsert.mock.calls[0][0] as Array<{ chave: string; proxima_tentativa_at: string }>;
      expect(linhas.map((l) => l.chave)).toEqual(['k1', 'k2', 'k3']);
      const t = linhas.map((l) => Date.parse(l.proxima_tentativa_at));
      expect(t[1] - t[0]).toBe(60_000);
      expect(t[2] - t[1]).toBe(60_000);
    });

    it('ignora duplicata por chave — reprocessar uma sessão não adiciona ninguém duas vezes', async () => {
      const sb = supabaseCom({ error: null });
      await enfileirar(sb.client, [
        { sessionId: 's1', tipo: 'add', grupoJid: '1@g.us', instancia: 'grupos', chave: 'k1' },
      ]);
      expect(sb.b.upsert).toHaveBeenCalledWith(expect.anything(), { onConflict: 'chave', ignoreDuplicates: true });
    });

    it('lista vazia não toca no banco', async () => {
      const sb = supabaseCom({ error: null });
      expect(await enfileirar(sb.client, [])).toBe(0);
      expect(sb.from).not.toHaveBeenCalled();
    });
  });

  describe('ganharSlot', () => {
    it('ganha quando o UPDATE com guard pega a linha, e já agenda a próxima liberação', async () => {
      const sb = supabaseCom({ data: [{ id: 1 }], error: null });
      expect(await ganharSlot(sb.client)).toBe(true);
      const patch = sb.b.update.mock.calls[0][0] as { proxima_liberacao_at: string };
      expect(Date.parse(patch.proxima_liberacao_at)).toBeGreaterThan(Date.now());
      // O guard é o que impede dois workers de agirem na mesma janela.
      expect(sb.b.lte).toHaveBeenCalledWith('proxima_liberacao_at', expect.any(String));
    });

    it('não ganha quando ainda não é hora ou a fila está pausada', async () => {
      const sb = supabaseCom({ data: [], error: null });
      expect(await ganharSlot(sb.client)).toBe(false);
    });

    it('erro do banco não libera a fila', async () => {
      const sb = supabaseCom({ data: null, error: { message: 'boom' } });
      expect(await ganharSlot(sb.client)).toBe(false);
    });
  });

  describe('proximoItem / reivindicar', () => {
    it('devolve null quando não há nada liberado', async () => {
      const sb = supabaseCom({ data: [], error: null });
      expect(await proximoItem(sb.client)).toBeNull();
    });

    it('reivindicar falha quando outro worker já levou o item', async () => {
      const sb = supabaseCom({ data: [], error: null });
      expect(await reivindicar(sb.client, 'i1')).toBe(false);
      expect(sb.b.eq).toHaveBeenCalledWith('status', 'pendente');
    });

    it('reivindicar vence quando o item ainda estava pendente', async () => {
      const sb = supabaseCom({ data: [{ id: 'i1' }], error: null });
      expect(await reivindicar(sb.client, 'i1')).toBe(true);
    });
  });

  describe('falhar', () => {
    it('devolve para a fila com backoff crescente enquanto há tentativas', async () => {
      const sb = supabaseCom({ error: null });
      await falhar(sb.client, { ...item, tentativas: 1 }, 'rate-overlimit');
      const patch = sb.b.update.mock.calls[0][0] as { status: string; tentativas: number; proxima_tentativa_at: string };
      expect(patch.status).toBe('pendente');
      expect(patch.tentativas).toBe(2);
      // 30s * 2^2 = 120s, mais até 30% de jitter.
      const espera = Date.parse(patch.proxima_tentativa_at) - Date.now();
      expect(espera).toBeGreaterThan(115_000);
      expect(espera).toBeLessThan(160_000);
    });

    it('marca falhou de vez ao estourar as tentativas', async () => {
      const sb = supabaseCom({ error: null });
      await falhar(sb.client, { ...item, tentativas: 4, max_tentativas: 5 }, 'sem jeito');
      const patch = sb.b.update.mock.calls[0][0] as { status: string; ultimo_erro: string };
      expect(patch.status).toBe('falhou');
      expect(patch.ultimo_erro).toBe('sem jeito');
    });
  });

  it('concluir marca feito e limpa o último erro', async () => {
    const sb = supabaseCom({ error: null });
    await concluir(sb.client, 'i1');
    expect(sb.b.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'feito', ultimo_erro: null }));
  });

  it('pausarFila trava a fila inteira por N minutos', async () => {
    const sb = supabaseCom({ error: null });
    await pausarFila(sb.client, 15, 'instância caiu');
    const patch = sb.b.update.mock.calls[0][0] as { pausado_ate: string; pausa_motivo: string };
    const faltam = Date.parse(patch.pausado_ate) - Date.now();
    expect(faltam).toBeGreaterThan(14 * 60_000);
    expect(patch.pausa_motivo).toBe('instância caiu');
  });

  it('resumoDaSessao conta o trabalho do grupo e ignora o próprio item de resumo', async () => {
    const sb = supabaseCom({
      data: [
        { status: 'feito', tipo: 'add' },
        { status: 'feito', tipo: 'texto' },
        { status: 'pendente', tipo: 'add' },
        { status: 'falhou', tipo: 'add' },
        { status: 'processando', tipo: 'resumo' },
      ],
      error: null,
    });
    expect(await resumoDaSessao(sb.client, 's1')).toEqual({ pendentes: 1, feitos: 2, falhados: 1, total: 4 });
  });
});
