import { inflateRawSync } from 'node:zlib';

/**
 * Extrai o texto de uma entrada do .docx (zip) sem depender de biblioteca —
 * usado só pelos testes para conferir o conteúdo renderizado.
 */
export function textoDoDocx(buf: Buffer, entrada = 'word/document.xml'): string {
  const alvo = Buffer.from(entrada);
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue; // local file header
    const metodo = buf.readUInt16LE(i + 8);
    const comprimido = buf.readUInt32LE(i + 18);
    const nomeLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    if (!buf.subarray(i + 30, i + 30 + nomeLen).equals(alvo)) continue;
    const inicio = i + 30 + nomeLen + extraLen;
    const dados = buf.subarray(inicio, inicio + comprimido);
    const xml = (metodo === 8 ? inflateRawSync(dados) : dados).toString('utf8');
    return xml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  throw new Error(`entrada ausente no docx: ${entrada}`);
}
