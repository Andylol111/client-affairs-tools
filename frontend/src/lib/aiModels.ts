export type AiModel = {
  id: string;
  label: string;
  tier: 'opus' | 'sonnet' | 'haiku' | 'laptop' | string;
  blurb: string;
};

export type AiModelGroup = {
  id: string;
  label: string;
  models: AiModel[];
};

/** Fallback catalog if /api/ai/models is down. Opus → Haiku on Bedrock US profiles. */
export const FALLBACK_AI_GROUPS: AiModelGroup[] = [
  {
    id: 'anthropic',
    label: 'Anthropic on Bedrock — Opus → Haiku',
    models: [
      { id: 'us.anthropic.claude-opus-4-1-20250805-v1:0', label: 'Claude Opus 4.1', tier: 'opus', blurb: 'Hardest reasoning' },
      { id: 'us.anthropic.claude-opus-4-20250514-v1:0', label: 'Claude Opus 4', tier: 'opus', blurb: 'Deep analysis' },
      { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5', tier: 'sonnet', blurb: 'Default for club week' },
      { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', label: 'Claude Sonnet 4', tier: 'sonnet', blurb: 'Balanced' },
      { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Claude Sonnet 3.7', tier: 'sonnet', blurb: 'Extended thinking' },
      { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5', tier: 'haiku', blurb: 'Fast drafts' },
      { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude Haiku 3.5', tier: 'haiku', blurb: 'Cheap labels' },
      { id: 'us.anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude Haiku 3', tier: 'haiku', blurb: 'Lightest' },
    ],
  },
  {
    id: 'laptop',
    label: 'Laptop',
    models: [{ id: 'ollama:llama3.2', label: 'Ollama (llama3.2)', tier: 'laptop', blurb: 'Local laptop only' }],
  },
];

export const DEFAULT_AI_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
export const AI_MODEL_STORAGE_KEY = 'yucg_ai_model';
