export type AiModel = {
  id: string;
  label: string;
  tier: 'opus' | 'sonnet' | 'haiku' | string;
  blurb: string;
};

export type AiModelGroup = {
  id: string;
  label: string;
  models: AiModel[];
};

export const FALLBACK_AI_GROUPS: AiModelGroup[] = [
  {
    id: 'anthropic',
    label: 'Claude on Bedrock',
    models: [
      { id: 'us.anthropic.claude-opus-5', label: 'Claude Opus 5', tier: 'opus', blurb: 'Hardest reasoning' },
      { id: 'us.anthropic.claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'sonnet', blurb: 'Default for club week' },
      { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5', tier: 'haiku', blurb: 'Fast drafts' },
    ],
  },
];

export const DEFAULT_AI_MODEL_ID = 'us.anthropic.claude-sonnet-5';
export const AI_MODEL_STORAGE_KEY = 'yucg_ai_model';

export function catalogModelIds(groups: AiModelGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.models.map((m) => m.id)));
}
