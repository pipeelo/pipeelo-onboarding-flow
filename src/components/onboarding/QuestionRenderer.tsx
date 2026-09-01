import { useState, useEffect } from 'react';
import { Question, QuestionOption } from '@/types/onboarding';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ClockTimePicker } from '@/components/ui/clock-time-picker';
import { ExternalLink, FileSpreadsheet, Info, Loader2, Upload, X } from 'lucide-react';
import { maskPhone } from '@/lib/phone';

interface QuestionRendererProps {
  question: Question;
  value: any;
  onChange: (value: any) => void;
  onSubmit: () => void;
  error?: string;
  /** Para tipo='file_upload': faz o upload e retorna o metadata salvo como resposta. */
  onUploadFile?: (file: File) => Promise<unknown>;
}

interface HorarioSemanal {
  segunda_sexta: { inicio: string; fim: string; nao_atende: boolean };
  sabado: { inicio: string; fim: string; nao_atende: boolean };
  domingo_feriado: { inicio: string; fim: string; nao_atende: boolean };
}

interface CheckboxMultipleValue {
  selected: string[];
  outroTexto?: string;
}

const defaultHorario: HorarioSemanal = {
  segunda_sexta: { inicio: '08:00', fim: '18:00', nao_atende: false },
  sabado: { inicio: '08:00', fim: '12:00', nao_atende: false },
  domingo_feriado: { inicio: '08:00', fim: '12:00', nao_atende: false }
};

export function QuestionRenderer({
  question,
  value,
  onChange,
  onSubmit,
  error,
  onUploadFile
}: QuestionRendererProps) {
  const [localValue, setLocalValue] = useState(value ?? '');
  const [naoTemPortal, setNaoTemPortal] = useState(value === 'NAO_POSSUI');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    if (question.tipo === 'checkbox_multiple') {
      // Migrar valor antigo (array) para novo formato (objeto)
      if (Array.isArray(value)) {
        setLocalValue({ selected: value, outroTexto: '' });
      } else if (value && typeof value === 'object' && 'selected' in value) {
        setLocalValue(value);
      } else {
        setLocalValue({ selected: [], outroTexto: '' });
      }
    } else if (question.tipo === 'horario_semanal') {
      const horarioValue = value && typeof value === 'object' ? value : defaultHorario;
      setLocalValue(horarioValue);
      // Auto-save default value if not already set
      if (!value || typeof value !== 'object') {
        onChange(defaultHorario);
      }
      setNaoTemPortal(value === 'NAO_POSSUI');
      setLocalValue(value ?? '');
    } else {
      setLocalValue(value ?? '');
    }
  }, [value, question.id, question.tipo]);

  const handleChange = (newValue: any) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && question.tipo !== 'textarea') {
      e.preventDefault();
      onSubmit();
    }
  };

  const renderInput = () => {
    switch (question.tipo) {
      case 'text':
        return (
          <Input
            type="text"
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder}
            className="text-lg py-6"
            autoFocus
          />
        );

      case 'password':
        return (
          <Input
            type="password"
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder ?? '••••••••'}
            className="text-lg py-6"
            autoComplete="new-password"
            spellCheck={false}
            autoFocus
          />
        );

      case 'email':
        return (
          <Input
            type="email"
            value={localValue}
            onChange={(e) => handleChange(e.target.value.trim())}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder}
            className="text-lg py-6"
            autoFocus
          />
        );

      case 'cnpj': {
        const maskCnpj = (v: string) => {
          const d = v.replace(/\D/g, '').slice(0, 14);
          return d
            .replace(/^(\d{2})(\d)/, '$1.$2')
            .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2');
        };
        return (
          <Input
            type="text"
            inputMode="numeric"
            value={maskCnpj(localValue || '')}
            onChange={(e) => handleChange(maskCnpj(e.target.value))}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder || '00.000.000/0000-00'}
            className="text-lg py-6 font-mono"
            autoFocus
          />
        );
      }

      case 'cpf': {
        const maskCpf = (v: string) => {
          const d = v.replace(/\D/g, '').slice(0, 11);
          return d
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1-$2');
        };
        return (
          <Input
            type="text"
            inputMode="numeric"
            value={maskCpf(localValue || '')}
            onChange={(e) => handleChange(maskCpf(e.target.value))}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder || '000.000.000-00'}
            className="text-lg py-6 font-mono"
            autoFocus
          />
        );
      }

      case 'phone': {
        return (
          <Input
            type="tel"
            inputMode="tel"
            value={maskPhone(localValue || '')}
            onChange={(e) => handleChange(maskPhone(e.target.value))}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder || '(00) 00000-0000'}
            className="text-lg py-6 font-mono"
            autoFocus
          />
        );
      }

      case 'textarea':
        return (
          <Textarea
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={question.placeholder}
            className="min-h-[120px] text-lg"
            autoFocus
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={localValue}
            onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : '')}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder}
            className="text-lg py-6"
            autoFocus
          />
        );

      case 'currency':
        return (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">
              R$
            </span>
            <Input
              type="number"
              step="0.01"
              value={localValue}
              onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : '')}
              onKeyPress={handleKeyPress}
              placeholder={question.placeholder}
              className="text-lg py-6 pl-10"
              autoFocus
            />
          </div>
        );

      case 'url':
        return (
          <Input
            type="url"
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder || 'https://'}
            className="text-lg py-6"
            autoFocus
          />
        );

      case 'url_optional':
        return (
          <div className="space-y-3">
            {!naoTemPortal && (
              <Input
                type="url"
                value={localValue === 'NAO_POSSUI' ? '' : localValue}
                onChange={(e) => handleChange(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={question.placeholder || 'https://'}
                className="text-lg py-6"
                autoFocus
              />
            )}
            <Button
              type="button"
              variant={naoTemPortal ? "default" : "outline"}
              className={`w-full justify-center py-3 h-auto ${
                naoTemPortal
                  ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                  : 'border-dashed'
              }`}
              onClick={() => {
                const newState = !naoTemPortal;
                setNaoTemPortal(newState);
                handleChange(newState ? 'NAO_POSSUI' : '');
              }}
            >
              {naoTemPortal ? (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Não possuo portal/área do cliente
                </>
              ) : (
                'Não possuo portal/área do cliente'
              )}
            </Button>
          </div>
        );

      case 'time':
        return (
          <ClockTimePicker
            value={localValue}
            onChange={handleChange}
          />
        );

      case 'horario_semanal':
        const horario: HorarioSemanal = localValue && typeof localValue === 'object' 
          ? localValue 
          : defaultHorario;

        const updateHorario = (
          periodo: keyof HorarioSemanal, 
          field: 'inicio' | 'fim' | 'nao_atende', 
          fieldValue: string | boolean
        ) => {
          const newHorario = {
            ...horario,
            [periodo]: {
              ...horario[periodo],
              [field]: fieldValue
            }
          };
          handleChange(newHorario);
        };

        return (
          <div className="space-y-4">
            {/* Segunda a Sexta */}
            <div className="p-4 border rounded-lg bg-card">
              <Label className="font-medium text-base">Segunda a Sexta</Label>
              <div className="flex gap-3 items-center mt-3">
                <ClockTimePicker
                  value={horario.segunda_sexta.inicio}
                  onChange={(val) => updateHorario('segunda_sexta', 'inicio', val)}
                />
                <span className="text-muted-foreground">às</span>
                <ClockTimePicker
                  value={horario.segunda_sexta.fim}
                  onChange={(val) => updateHorario('segunda_sexta', 'fim', val)}
                />
              </div>
            </div>

            {/* Sábados */}
            <div className={`p-4 border rounded-lg bg-card ${horario.sabado.nao_atende ? 'opacity-60' : ''}`}>
              <div className="flex justify-between items-center">
                <Label className="font-medium text-base">Sábados</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sabado-nao-atende"
                    checked={horario.sabado.nao_atende}
                    onCheckedChange={(checked) => updateHorario('sabado', 'nao_atende', !!checked)}
                  />
                  <Label htmlFor="sabado-nao-atende" className="text-sm cursor-pointer">
                    Não atende
                  </Label>
                </div>
              </div>
              {!horario.sabado.nao_atende && (
                <div className="flex gap-3 items-center mt-3">
                  <ClockTimePicker
                    value={horario.sabado.inicio}
                    onChange={(val) => updateHorario('sabado', 'inicio', val)}
                  />
                  <span className="text-muted-foreground">às</span>
                  <ClockTimePicker
                    value={horario.sabado.fim}
                    onChange={(val) => updateHorario('sabado', 'fim', val)}
                  />
                </div>
              )}
            </div>

            {/* Domingos e Feriados */}
            <div className={`p-4 border rounded-lg bg-card ${horario.domingo_feriado.nao_atende ? 'opacity-60' : ''}`}>
              <div className="flex justify-between items-center">
                <Label className="font-medium text-base">Domingos e Feriados</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="domingo-nao-atende"
                    checked={horario.domingo_feriado.nao_atende}
                    onCheckedChange={(checked) => updateHorario('domingo_feriado', 'nao_atende', !!checked)}
                  />
                  <Label htmlFor="domingo-nao-atende" className="text-sm cursor-pointer">
                    Não atende
                  </Label>
                </div>
              </div>
              {!horario.domingo_feriado.nao_atende && (
                <div className="flex gap-3 items-center mt-3">
                  <ClockTimePicker
                    value={horario.domingo_feriado.inicio}
                    onChange={(val) => updateHorario('domingo_feriado', 'inicio', val)}
                  />
                  <span className="text-muted-foreground">às</span>
                  <ClockTimePicker
                    value={horario.domingo_feriado.fim}
                    onChange={(val) => updateHorario('domingo_feriado', 'fim', val)}
                  />
                </div>
              )}
            </div>
          </div>
        );

      case 'select':
        return (
          <div className="space-y-2">
            {question.opcoes?.map((option: QuestionOption) => (
              <Button
                key={option.value}
                type="button"
                variant={localValue === option.value ? "default" : "outline"}
                className={`w-full justify-start text-left py-4 h-auto whitespace-normal ${
                  localValue === option.value
                    ? 'bg-accent text-accent-foreground hover:bg-accent/90 font-semibold'
                    : ''
                }`}
                onClick={() => {
                  handleChange(option.value);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        );

      case 'checkbox_multiple':
        const checkboxValue: CheckboxMultipleValue = 
          localValue && typeof localValue === 'object' && 'selected' in localValue
            ? localValue
            : { selected: Array.isArray(localValue) ? localValue : [], outroTexto: '' };
        
        const selectedValues = checkboxValue.selected;
        const hasOutroOption = question.opcoes?.some(opt => opt.value === 'outro');
        const outroSelected = selectedValues.includes('outro');

        return (
          <div className="space-y-3">
            {question.opcoes?.map((option: QuestionOption) => (
              <div key={option.value} className="flex items-center space-x-3">
                <Checkbox
                  id={`${question.id}-${option.value}`}
                  checked={selectedValues.includes(option.value)}
                  onCheckedChange={(checked) => {
                    const newSelected = checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v: string) => v !== option.value);
                    
                    const newValue: CheckboxMultipleValue = {
                      selected: newSelected,
                      outroTexto: option.value === 'outro' && !checked ? '' : checkboxValue.outroTexto
                    };
                    handleChange(newValue);
                  }}
                  className="h-5 w-5"
                />
                <Label 
                  htmlFor={`${question.id}-${option.value}`}
                  className="text-base cursor-pointer"
                >
                  {option.label}
                </Label>
              </div>
            ))}
            
            {/* Campo de texto para "Outro" */}
            {hasOutroOption && outroSelected && (
              <div className="ml-8 mt-2">
                <Input
                  type="text"
                  value={checkboxValue.outroTexto || ''}
                  onChange={(e) => {
                    const newValue: CheckboxMultipleValue = {
                      ...checkboxValue,
                      outroTexto: e.target.value
                    };
                    handleChange(newValue);
                  }}
                  placeholder="Especifique qual..."
                  className="text-base"
                  autoFocus
                />
              </div>
            )}
          </div>
        );

      case 'repeater': {
        const items: Record<string, unknown>[] = Array.isArray(localValue) ? localValue : [];
        const campos = question.campos ?? [];
        const minItens = question.minimo ?? 0;
        const maxItens = question.maximo ?? Infinity;
        const rotuloItem = question.rotulo_item ?? 'Item';
        const rotuloAdd = question.rotulo_adicionar ?? `Adicionar ${rotuloItem.toLowerCase()}`;

        const updateItem = (idx: number, patch: Record<string, unknown>) => {
          const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
          handleChange(next);
        };
        const addItem = () => {
          if (items.length >= maxItens) return;
          handleChange([...items, {}]);
        };
        const removeItem = (idx: number) => {
          if (items.length <= minItens) return;
          handleChange(items.filter((_, i) => i !== idx));
        };

        const widthClass = (w?: number) => {
          switch (w) {
            case 3: return 'col-span-12 md:col-span-3';
            case 4: return 'col-span-12 md:col-span-4';
            case 6: return 'col-span-12 md:col-span-6';
            case 8: return 'col-span-12 md:col-span-8';
            default: return 'col-span-12';
          }
        };

        return (
          <div className="space-y-4">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                Nenhum {rotuloItem.toLowerCase()} cadastrado ainda. Clique em "{rotuloAdd}" para começar.
              </p>
            )}
            {items.map((item, idx) => (
              <div key={idx} className="rounded-lg border p-4 space-y-3 bg-muted/20 relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{rotuloItem} {idx + 1}</span>
                  {items.length > minItens && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(idx)}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-12 gap-3">
                  {campos.map((campo) => {
                    const fieldVal = (item as Record<string, unknown>)[campo.id];
                    return (
                      <div key={campo.id} className={widthClass(campo.largura)}>
                        <Label className="text-sm mb-1 block">
                          {campo.label}
                          {campo.obrigatoria && <span className="text-destructive ml-0.5">*</span>}
                        </Label>
                        {(campo.tipo === 'text' || campo.tipo === 'number' || campo.tipo === 'currency') && (
                          <Input
                            type={campo.tipo === 'number' || campo.tipo === 'currency' ? 'number' : 'text'}
                            step={campo.tipo === 'currency' ? '0.01' : undefined}
                            value={(fieldVal as string | number | undefined) ?? ''}
                            onChange={(e) => updateItem(idx, { [campo.id]: e.target.value })}
                            placeholder={campo.placeholder}
                            className="text-base"
                          />
                        )}
                        {campo.tipo === 'phone' && (
                          <Input
                            type="tel"
                            inputMode="tel"
                            value={maskPhone(String(fieldVal ?? ''))}
                            onChange={(e) => updateItem(idx, { [campo.id]: maskPhone(e.target.value) })}
                            placeholder={campo.placeholder ?? '(00) 00000-0000'}
                            className="text-base"
                          />
                        )}
                        {campo.tipo === 'textarea' && (
                          <Textarea
                            value={(fieldVal as string | undefined) ?? ''}
                            onChange={(e) => updateItem(idx, { [campo.id]: e.target.value })}
                            placeholder={campo.placeholder}
                            className="text-base min-h-[80px]"
                          />
                        )}
                        {campo.tipo === 'select' && (
                          <select
                            value={(fieldVal as string | undefined) ?? ''}
                            onChange={(e) => updateItem(idx, { [campo.id]: e.target.value })}
                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-base"
                          >
                            <option value="">Selecione...</option>
                            {campo.opcoes?.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        )}
                        {campo.tipo === 'boolean' && (
                          <div className="flex items-center space-x-2 h-10">
                            <Checkbox
                              id={`${question.id}-${idx}-${campo.id}`}
                              checked={Boolean(fieldVal)}
                              onCheckedChange={(c) => updateItem(idx, { [campo.id]: Boolean(c) })}
                            />
                            <Label htmlFor={`${question.id}-${idx}-${campo.id}`} className="text-sm cursor-pointer">
                              Sim
                            </Label>
                          </div>
                        )}
                        {campo.tipo === 'checkbox_multiple' && (() => {
                          const arr = Array.isArray(fieldVal) ? (fieldVal as string[]) : [];
                          return (
                            <div className="flex flex-wrap gap-2">
                              {campo.opcoes?.map((opt) => {
                                const checked = arr.includes(opt.value);
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                      const next = checked ? arr.filter((v) => v !== opt.value) : [...arr, opt.value];
                                      updateItem(idx, { [campo.id]: next });
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-sm border ${checked ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-accent'}`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                        {campo.hint && (
                          <p className="text-xs text-muted-foreground mt-1">{campo.hint}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {items.length < maxItens && (
              <Button type="button" variant="outline" onClick={addItem} className="w-full">
                + {rotuloAdd}
              </Button>
            )}
            {minItens > 0 && items.length < minItens && (
              <p className="text-sm text-destructive">
                Mínimo {minItens} {minItens === 1 ? 'item' : 'itens'}.
              </p>
            )}
          </div>
        );
      }

      case 'info':
        // Parse numbered steps from text (e.g., "1. Step one 2. Step two")
        const parseSteps = (text: string) => {
          const stepRegex = /(\d+)\.\s*([^0-9]+?)(?=\s*\d+\.|$)/g;
          const steps: { num: string; text: string }[] = [];
          let match;
          
          while ((match = stepRegex.exec(text)) !== null) {
            steps.push({ num: match[1], text: match[2].trim() });
          }
          
          return steps.length > 1 ? steps : null;
        };
        
        const steps = question.texto ? parseSteps(question.texto) : null;
        
        return (
          <div className="bg-muted/50 rounded-xl p-5 border border-border">
            {steps ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <Info className="h-5 w-5 text-pipeelo-blue shrink-0" />
                  <span className="font-medium text-foreground">Sequência padrão:</span>
                </div>
                <ol className="space-y-3">
                  {steps.map((step, index) => (
                    <li key={index} className="flex gap-3 items-start">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pipeelo-blue/10 text-pipeelo-blue text-sm font-medium flex items-center justify-center">
                        {step.num}
                      </span>
                      <span className="text-muted-foreground leading-relaxed pt-0.5">{step.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-pipeelo-blue shrink-0 mt-0.5" />
                <p className="text-muted-foreground leading-relaxed">{question.texto}</p>
              </div>
            )}
          </div>
        );

      case 'info_link':
        return (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-pipeelo-blue shrink-0 mt-0.5" />
                <p className="text-muted-foreground">{question.hint}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => window.open(question.link, '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
              {question.texto ?? 'Abrir ferramenta'}
            </Button>
          </div>
        );

      case 'file_upload': {
        const meta =
          localValue && typeof localValue === 'object' && 'nome_original' in localValue
            ? (localValue as { path: string; nome_original: string; tamanho: number })
            : null;
        const extensoes = question.extensoes ?? ['xlsx', 'xls', 'csv'];
        const maxMb = question.max_mb ?? 5;

        const handleFile = async (file: File | undefined) => {
          if (!file || !onUploadFile) return;
          const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
          if (!extensoes.includes(ext)) {
            setUploadError(`Formato não aceito — use ${extensoes.map((e) => `.${e}`).join(', ')}`);
            return;
          }
          if (file.size > maxMb * 1024 * 1024) {
            setUploadError(`Arquivo muito grande — máximo ${maxMb}MB`);
            return;
          }
          setUploadError('');
          setUploading(true);
          try {
            const uploaded = await onUploadFile(file);
            handleChange(uploaded);
          } catch {
            setUploadError('Falha no envio — tente de novo ou fale com o time Pipeelo.');
          } finally {
            setUploading(false);
          }
        };

        return (
          <div className="space-y-3">
            {meta ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4">
                <FileSpreadsheet className="h-6 w-6 text-pipeelo-green shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{meta.nome_original}</p>
                  <p className="text-sm text-muted-foreground">
                    {(meta.tamanho / 1024).toFixed(0)} KB — recebido ✓
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remover arquivo"
                  onClick={() => handleChange('')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-accent hover:bg-muted/50 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {uploading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-8 w-8 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {uploading ? 'Enviando…' : 'Clique para escolher o arquivo'}
                </span>
                <span className="text-sm text-muted-foreground">
                  {extensoes.map((e) => `.${e}`).join(', ')} — até {maxMb}MB
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept={extensoes.map((e) => `.${e}`).join(',')}
                  disabled={uploading}
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
          </div>
        );
      }

      default:
        return (
          <Input
            type="text"
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={question.placeholder}
            className="text-lg py-6"
            autoFocus
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      {renderInput()}
      
      {question.hint && question.tipo !== 'info' && question.tipo !== 'info_link' && (
        <p className="text-sm text-muted-foreground">{question.hint}</p>
      )}
      
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
