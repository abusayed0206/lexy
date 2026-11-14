import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Mirrors `Settings` in src-tauri/src/settings.rs (data-model.md "Settings"). */
export type Settings = {
  theme: "system" | "light" | "dark";
  editorFontSize: number;
  livePreviewDelayMs: number;
  autoSave: boolean;
  autoSaveDelayMs: number;
  vim: boolean;
  spellCheck: boolean;
  spellLanguage: string;
  grammarCheck: boolean;
  grammarServer: string;
  imageFolder: string;
  hidePdfInFocus: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  editorFontSize: 14,
  livePreviewDelayMs: 1000,
  autoSave: false,
  autoSaveDelayMs: 5000,
  vim: false,
  spellCheck: true,
  spellLanguage: "en_US",
  grammarCheck: false,
  grammarServer: "https://api.languagetool.org",
  imageFolder: "figures",
  hidePdfInFocus: false,
};

export const getSettings = () => invoke<Settings>("get_settings");
/** Stores and returns the validated settings (invalid values come back as defaults). */
export const setSettings = (settings: Settings) => invoke<Settings>("set_settings", { settings });

type SettingsValue = { settings: Settings; update: (change: Partial<Settings>) => Promise<void> };

const SettingsContext = createContext<SettingsValue>({ settings: DEFAULT_SETTINGS, update: async () => {} });

/** Loads settings once and again whenever the window gets focus, so other windows' changes apply (US6.2). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setState] = useState<Settings>(DEFAULT_SETTINGS);

  const reload = useCallback(async () => {
    try {
      setState({ ...DEFAULT_SETTINGS, ...(await getSettings()) });
    } catch {
      // Without stored settings the defaults stay in use.
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // Theme and editor font size apply app-wide at once (spec 007 US6).
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  }, [settings.theme, settings.editorFontSize]);

  const update = useCallback(
    async (change: Partial<Settings>) => {
      const next = { ...settings, ...change };
      setState(next);
      try {
        setState({ ...DEFAULT_SETTINGS, ...(await setSettings(next)) });
      } catch {
        // Keep the change for this session even if it could not be stored.
      }
    },
    [settings],
  );

  return createElement(SettingsContext.Provider, { value: { settings, update } }, children);
}

export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}
