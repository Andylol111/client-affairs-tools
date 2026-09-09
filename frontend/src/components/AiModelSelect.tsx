import { useAiModel } from '../contexts/AiModelContext';

type AiModelSelectProps = {
  id?: string;
  className?: string;
};

export default function AiModelSelect({ id = 'ai-model', className = '' }: AiModelSelectProps) {
  const { modelId, setModelId, groups } = useAiModel();

  return (
    <label className={`app-ai-select-wrap ${className}`.trim()} htmlFor={id}>
      <span className="app-ai-select-label">AI model</span>
      <select
        id={id}
        className="app-ai-select"
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
