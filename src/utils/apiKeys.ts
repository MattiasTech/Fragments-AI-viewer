/**
 * API Key Storage Utilities
 * Handles secure storage of API keys in browser localStorage
 */

const STORAGE_KEY = 'bim_viewer_api_config';

export type AIProvider = 'gemini' | 'openai' | 'disabled';

export interface ApiConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

const obfuscate = (text: string): string => {
  try {
    return btoa(text);
  } catch {
    return text;
  }
};

const deobfuscate = (text: string): string => {
  try {
    return atob(text);
  } catch {
    return text;
  }
};

/**
 * Save API configuration to localStorage
 */
export const saveApiConfig = (config: ApiConfig): void => {
  const obfuscated = {
    ...config,
    apiKey: obfuscate(config.apiKey)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obfuscated));
};

/**
 * Load API configuration from localStorage
 */
export const loadApiConfig = (): ApiConfig | null => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  
  try {
    const config = JSON.parse(stored) as ApiConfig;
    return {
      ...config,
      apiKey: deobfuscate(config.apiKey)
    };
  } catch {
    return null;
  }
};

/**
 * Clear API configuration from localStorage
 */
export const clearApiConfig = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

/**
 * Get available models for each provider
 */
export const getAvailableModels = (provider: AIProvider): string[] => {
  switch (provider) {
    case 'gemini':
      return [
        'gemini-3.0-pro',
        'gemini-3.0-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-exp',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro'
      ];
    case 'openai':
      return [
        `gpt-5.2`,
        `gpt-5.1`,
        `gpt-5o-mini`,
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo'
      ];
    default:
      return [];
  }
};

/**
 * Get default model for provider
 */
export const getDefaultModel = (provider: AIProvider): string => {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'openai':
      return 'gpt-4o-mini';
    default:
      return '';
  }
};
