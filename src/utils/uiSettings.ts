/**
 * UI Settings Store
 * Persists user interface preferences to localStorage
 */

const STORAGE_KEY = 'savora-ui-settings';

export interface UiSettings {
  qtoMappingScanScope?: 'all' | 'selected' | 'visible';
  idsCreatorScanScope?: 'all' | 'selected' | 'visible';
  idsPanelScanScope?: 'all' | 'selected' | 'visible';
}

/**
 * Load UI settings from localStorage
 */
export function loadUiSettings(): UiSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.warn('Failed to load UI settings:', err);
  }
  return {};
}

/**
 * Save UI settings to localStorage
 */
export function saveUiSettings(settings: UiSettings): void {
  try {
    const current = loadUiSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to save UI settings:', err);
  }
}

/**
 * Get a specific setting
 */
export function getUiSetting<K extends keyof UiSettings>(key: K): UiSettings[K] | undefined {
  const settings = loadUiSettings();
  return settings[key];
}

/**
 * Set a specific setting
 */
export function setUiSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
  saveUiSettings({ [key]: value } as UiSettings);
}
