import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import {
  AI_MODEL_STORAGE_KEY,
  DEFAULT_AI_MODEL_ID,
  FALLBACK_AI_GROUPS,
  type AiModelGroup,
} from '../lib/aiModels';

type AiModelContextValue = {
  modelId: string;
  setModelId: (id: string) => void;
  groups: AiModelGroup[];
};

const AiModelContext = createContext<AiModelContextValue | null>(null);

export function AiModelProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<AiModelGroup[]>(FALLBACK_AI_GROUPS);
  const [modelId, setModelIdState] = useState(() => {
    try {
      return localStorage.getItem(AI_MODEL_STORAGE_KEY) || DEFAULT_AI_MODEL_ID;
    } catch {
      return DEFAULT_AI_MODEL_ID;
    }
  });

  useEffect(() => {
    api.ai
      .models()
      .then((res) => {
        if (res.groups?.length) setGroups(res.groups);
        if (res.default && !localStorage.getItem(AI_MODEL_STORAGE_KEY)) {
          setModelIdState(res.default);
        }
      })
      .catch(() => {});
  }, []);

  const setModelId = useCallback((id: string) => {
    setModelIdState(id);
    try {
      localStorage.setItem(AI_MODEL_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <AiModelContext.Provider value={{ modelId, setModelId, groups }}>
      {children}
    </AiModelContext.Provider>
  );
}

export function useAiModel() {
  const ctx = useContext(AiModelContext);
  if (!ctx) {
    return {
      modelId: DEFAULT_AI_MODEL_ID,
      setModelId: () => {},
      groups: FALLBACK_AI_GROUPS,
    };
  }
  return ctx;
}
