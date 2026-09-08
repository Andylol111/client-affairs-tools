import { useAiModel } from '../contexts/AiModelContext';

type AiModelSelectProps = {
  id?: string;
  className?: string;
  /** header = compact in the top bar */
  variant?: 'header' | 'field';
};

export default function AiModelSelect({ id = 'ai-model', className = '', variant = 'field' }: AiModelSelectProps) {
  const { modelId, setModelId, groups } = useAiModel();
  const fieldClass = variant === 'header' ? 'app-ai-select app-ai-select--header' : 'app-ai-select';

  return (
    <label className={`app-ai-select-wrap ${className}`.trim()} htmlFor={id}>
      {variant === 'field' && <span className="app-ai-select-label">AI model</span>}
      {variant === 'header' && <span className="sr-only">AI model</span>}
      <select
        id={id}
        className={fieldClass}
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        title="Anthropic on Bedrock, Opus through Haiku"
      >
        {groups.map((g) => (
          <optgroup key={g.id} label={g.label}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.blurb ? ` — ${m.blurb}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
