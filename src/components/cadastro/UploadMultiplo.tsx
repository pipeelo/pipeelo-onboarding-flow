import { useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type UploadMeta = { path: string; nome_original: string; tamanho: number };

interface Props {
  label: string;
  hint?: string;
  value: UploadMeta[];
  onChange: (next: UploadMeta[]) => void;
  onUpload: (file: File) => Promise<UploadMeta>;
}

const EXT = ['pdf', 'jpg', 'jpeg', 'png'];
const MAX_MB = 10;

/** Lista de arquivos + área de envio. Um arquivo por vez; o servidor valida de novo. */
export function UploadMultiplo({ label, hint, value, onChange, onUpload }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!EXT.includes(ext)) return setError(`Formato não aceito — use ${EXT.map((e) => `.${e}`).join(', ')}`);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Arquivo muito grande — máximo ${MAX_MB}MB`);
    setError('');
    setUploading(true);
    try {
      onChange([...value, await onUpload(file)]);
    } catch {
      setError('Falha no envio — tente de novo ou fale com o time Pipeelo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{label} <span className="text-primary">*</span></p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {value.map((f, i) => (
        <div key={f.path} className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.nome_original}</p>
            <p className="text-xs text-muted-foreground">{(f.tamanho / 1024).toFixed(0)} KB — recebido ✓</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${f.nome_original}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <label className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-accent hover:bg-muted/50 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
        {uploading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
        <span className="text-sm font-medium">{uploading ? 'Enviando…' : value.length ? 'Adicionar outro arquivo' : 'Clique para escolher o arquivo'}</span>
        <span className="text-xs text-muted-foreground">PDF, JPG ou PNG — até {MAX_MB}MB cada</span>
        <input type="file" className="hidden" accept={EXT.map((e) => `.${e}`).join(',')} disabled={uploading}
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
