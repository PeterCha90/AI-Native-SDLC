"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzerSettings, ChoiceOption } from "./types";
import {
  CATEGORY_PALETTE,
  DEFAULT_SETTINGS,
  LIMITS,
  SETTINGS_STORAGE_KEY,
} from "./defaults";

/** Fields the drawer is allowed to patch on a single option. */
export type ChoiceOptionPatch = Partial<
  Pick<ChoiceOption, "label" | "description" | "color" | "isSpam">
>;

export type NumberSettingKey =
  | "mailCount"
  | "concurrency"
  | "confidenceThreshold"
  | "spamThreshold";

/**
 * Validation state for the whole settings object.
 * `blocking` is true when the analyze button must be disabled;
 * everything else (like "no spam category picked") is advisory only.
 */
export interface SettingsErrors {
  /** Per-option messages, keyed by option id (empty/duplicate label, ...). */
  optionErrors: Record<string, string[]>;
  /** Messages not tied to a single option (too few categories, ...). */
  general: string[];
  /** Non-blocking notices (e.g. no category flagged as spam candidate). */
  warnings: string[];
  /** All blocking messages flattened, e.g. for a disabled-button tooltip. */
  messages: string[];
  blocking: boolean;
}

export interface UseSettingsResult {
  settings: AnalyzerSettings;
  addOption: () => void;
  updateOption: (id: string, patch: ChoiceOptionPatch) => void;
  removeOption: (id: string) => void;
  moveOption: (id: string, direction: "up" | "down") => void;
  setInstructions: (value: string) => void;
  setNumber: (key: NumberSettingKey, value: number) => void;
  reset: () => void;
  isDirty: boolean;
  errors: SettingsErrors;
}

/** True when `errors` contains nothing that should block analysis. */
export function settingsAreValid(errors: SettingsErrors): boolean {
  return !errors.blocking;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cloneSettings(source: AnalyzerSettings): AnalyzerSettings {
  return {
    ...source,
    options: source.options.map((option) => ({ ...option })),
  };
}

function nextPaletteColor(options: ChoiceOption[]): string {
  const used = new Set(options.map((option) => option.color));
  const unused = CATEGORY_PALETTE.find((color) => !used.has(color));
  if (unused) return unused;
  return CATEGORY_PALETTE[options.length % CATEGORY_PALETTE.length];
}

/** Best-effort shape check for whatever was in localStorage. */
function isChoiceOption(value: unknown): value is ChoiceOption {
  if (typeof value !== "object" || value === null) return false;
  const option = value as Record<string, unknown>;
  return (
    typeof option.id === "string" &&
    typeof option.label === "string" &&
    typeof option.description === "string" &&
    typeof option.color === "string" &&
    typeof option.isSpam === "boolean"
  );
}

function parseStoredSettings(raw: string): AnalyzerSettings | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const options = Array.isArray(candidate.options)
      ? candidate.options.filter(isChoiceOption)
      : null;
    if (!options || options.length < LIMITS.minOptions) return null;

    return {
      instructions:
        typeof candidate.instructions === "string"
          ? candidate.instructions
          : DEFAULT_SETTINGS.instructions,
      options,
      mailCount:
        typeof candidate.mailCount === "number"
          ? clamp(candidate.mailCount, LIMITS.mailCount.min, LIMITS.mailCount.max)
          : DEFAULT_SETTINGS.mailCount,
      concurrency:
        typeof candidate.concurrency === "number"
          ? clamp(candidate.concurrency, LIMITS.concurrency.min, LIMITS.concurrency.max)
          : DEFAULT_SETTINGS.concurrency,
      confidenceThreshold:
        typeof candidate.confidenceThreshold === "number"
          ? clamp(candidate.confidenceThreshold, 0, 1)
          : DEFAULT_SETTINGS.confidenceThreshold,
      spamThreshold:
        typeof candidate.spamThreshold === "number"
          ? clamp(candidate.spamThreshold, 0, 1)
          : DEFAULT_SETTINGS.spamThreshold,
    };
  } catch {
    return null;
  }
}

function computeErrors(settings: AnalyzerSettings): SettingsErrors {
  const optionErrors: Record<string, string[]> = {};
  const general: string[] = [];
  const warnings: string[] = [];

  const labelCounts = new Map<string, number>();
  for (const option of settings.options) {
    const key = option.label.trim().toLowerCase();
    if (key.length === 0) continue;
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  for (const option of settings.options) {
    const messages: string[] = [];
    const trimmed = option.label.trim();
    if (trimmed.length === 0) {
      messages.push("카테고리 이름을 입력하세요.");
    } else if ((labelCounts.get(trimmed.toLowerCase()) ?? 0) > 1) {
      messages.push("카테고리 이름이 중복되었습니다.");
    }
    if (messages.length > 0) {
      optionErrors[option.id] = messages;
    }
  }

  if (settings.options.length < LIMITS.minOptions) {
    general.push(`카테고리는 최소 ${LIMITS.minOptions}개 이상이어야 합니다.`);
  }

  if (!settings.options.some((option) => option.isSpam)) {
    warnings.push(
      "스팸 후보로 지정된 카테고리가 없습니다. 2차 스팸 분석 대상을 정하려면 최소 하나의 카테고리에 스팸 후보를 지정하세요.",
    );
  }

  const messages = [...general, ...Object.values(optionErrors).flat()];
  const blocking = messages.length > 0;

  return { optionErrors, general, warnings, messages, blocking };
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AnalyzerSettings>(() =>
    cloneSettings(DEFAULT_SETTINGS),
  );
  const [hydrated, setHydrated] = useState(false);
  // Avoid clobbering localStorage with the defaults before hydration reads it.
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const stored = parseStoredSettings(raw);
        if (stored) setSettings(stored);
      }
    } catch {
      // localStorage unavailable (private mode, disabled, ...) — keep defaults.
    } finally {
      hasHydratedRef.current = true;
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota exceeded or storage disabled — nothing to do about it here.
    }
  }, [settings, hydrated]);

  const addOption = useCallback(() => {
    setSettings((prev) => {
      if (prev.options.length >= LIMITS.maxOptions) return prev;
      const nextOption: ChoiceOption = {
        id: crypto.randomUUID(),
        label: "",
        description: "",
        color: nextPaletteColor(prev.options),
        isSpam: false,
      };
      return { ...prev, options: [...prev.options, nextOption] };
    });
  }, []);

  const updateOption = useCallback((id: string, patch: ChoiceOptionPatch) => {
    setSettings((prev) => ({
      ...prev,
      options: prev.options.map((option) =>
        option.id === id ? { ...option, ...patch } : option,
      ),
    }));
  }, []);

  const removeOption = useCallback((id: string) => {
    setSettings((prev) => {
      if (prev.options.length <= LIMITS.minOptions) return prev;
      return { ...prev, options: prev.options.filter((option) => option.id !== id) };
    });
  }, []);

  const moveOption = useCallback((id: string, direction: "up" | "down") => {
    setSettings((prev) => {
      const index = prev.options.findIndex((option) => option.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.options.length) return prev;

      const options = [...prev.options];
      const [moved] = options.splice(index, 1);
      options.splice(targetIndex, 0, moved);
      return { ...prev, options };
    });
  }, []);

  const setInstructions = useCallback((value: string) => {
    setSettings((prev) => ({ ...prev, instructions: value }));
  }, []);

  const setNumber = useCallback((key: NumberSettingKey, value: number) => {
    setSettings((prev) => {
      switch (key) {
        case "mailCount":
          return {
            ...prev,
            mailCount: clamp(value, LIMITS.mailCount.min, LIMITS.mailCount.max),
          };
        case "concurrency":
          return {
            ...prev,
            concurrency: clamp(value, LIMITS.concurrency.min, LIMITS.concurrency.max),
          };
        case "confidenceThreshold":
          return { ...prev, confidenceThreshold: clamp(value, 0, 1) };
        case "spamThreshold":
          return { ...prev, spamThreshold: clamp(value, 0, 1) };
        default:
          return prev;
      }
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(cloneSettings(DEFAULT_SETTINGS));
  }, []);

  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);
  }, [settings]);

  const errors = useMemo(() => computeErrors(settings), [settings]);

  return {
    settings,
    addOption,
    updateOption,
    removeOption,
    moveOption,
    setInstructions,
    setNumber,
    reset,
    isDirty,
    errors,
  };
}
