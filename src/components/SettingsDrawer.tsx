"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AnalyzerSettings } from "@/lib/types";
import { CATEGORY_PALETTE, LIMITS } from "@/lib/defaults";
import type { UseSettingsResult } from "@/lib/useSettings";

/** Everything the hook returns except `settings`, which the page passes separately. */
export type SettingsDrawerControls = Omit<UseSettingsResult, "settings">;

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: AnalyzerSettings;
  controls: SettingsDrawerControls;
}

const numberFormat = new Intl.NumberFormat("ko-KR");

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SettingsDrawer({ open, onClose, settings, controls }: SettingsDrawerProps) {
  const {
    addOption,
    updateOption,
    removeOption,
    moveOption,
    setInstructions,
    setNumber,
    reset,
    errors,
  } = controls;

  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);

  // Close on Escape, from anywhere, while open.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Move focus in on open, restore it to the trigger on close.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      closeButtonRef.current?.focus();
    } else {
      previouslyFocusedRef.current?.focus();
      setOpenPickerId(null);
    }
  }, [open]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-[#0f172a]/25 transition-opacity duration-300 ease-out ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-hidden={!open}
        // Keeps the closed panel out of tab order and hidden from AT while
        // still mounted, so the slide-out animation can play both ways.
        inert={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-surface transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={headingId} className="text-lg font-semibold text-text">
            분석 설정
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="설정 닫기"
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <Section title="Choice 질문">
            <p className="mb-2 text-xs text-text-muted">
              JEV에게 그대로 전달되는 질문입니다. 카테고리 이름과 설명은 이 질문의 선택지가
              됩니다.
            </p>
            <textarea
              value={settings.instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              aria-label="Choice 질문"
            />
          </Section>

          <Section title="카테고리 (Choice 옵션)">
            <ul className="flex flex-col gap-3">
              {settings.options.map((option, index) => {
                const optionErrors = errors.optionErrors[option.id] ?? [];
                const labelId = `${headingId}-label-${option.id}`;
                return (
                  <li key={option.id} className="card p-3">
                    <div className="flex items-start gap-2">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPickerId((current) =>
                              current === option.id ? null : option.id,
                            )
                          }
                          aria-label={`${option.label || "카테고리"} 색상 선택`}
                          aria-expanded={openPickerId === option.id}
                          className="mt-1 h-6 w-6 rounded-full border border-border"
                          style={{ backgroundColor: option.color }}
                        />
                        {openPickerId === option.id && (
                          <div
                            onBlur={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget)) {
                                setOpenPickerId(null);
                              }
                            }}
                            className="card absolute left-0 top-8 z-10 grid grid-cols-5 gap-1.5 p-2 shadow-lg"
                          >
                            {CATEGORY_PALETTE.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => {
                                  updateOption(option.id, { color });
                                  setOpenPickerId(null);
                                }}
                                aria-label={`색상 ${color} 선택`}
                                aria-pressed={option.color === color}
                                className="h-6 w-6 rounded-full border border-border"
                                style={{
                                  backgroundColor: color,
                                  outline:
                                    option.color === color
                                      ? "2px solid var(--color-accent)"
                                      : "none",
                                  outlineOffset: "1px",
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <label htmlFor={labelId} className="sr-only">
                          카테고리 이름
                        </label>
                        <input
                          id={labelId}
                          type="text"
                          value={option.label}
                          onChange={(event) =>
                            updateOption(option.id, { label: event.target.value })
                          }
                          placeholder="예: 업무"
                          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm font-medium text-text outline-none focus:border-accent"
                        />
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveOption(option.id, "up")}
                          disabled={index === 0}
                          aria-label={`${option.label || "카테고리"} 위로 이동`}
                          title="위로 이동"
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ArrowUpIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOption(option.id, "down")}
                          disabled={index === settings.options.length - 1}
                          aria-label={`${option.label || "카테고리"} 아래로 이동`}
                          title="아래로 이동"
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ArrowDownIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOption(option.id)}
                          disabled={settings.options.length <= LIMITS.minOptions}
                          aria-label={`${option.label || "카테고리"} 삭제`}
                          title={
                            settings.options.length <= LIMITS.minOptions
                              ? `카테고리는 최소 ${LIMITS.minOptions}개 이상 있어야 합니다.`
                              : "삭제"
                          }
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={option.description}
                      onChange={(event) =>
                        updateOption(option.id, { description: event.target.value })
                      }
                      placeholder="설명을 비워두면 null이 전달되어, 이름만으로 의미를 전달합니다."
                      rows={2}
                      aria-label={`${option.label || "카테고리"} 설명`}
                      className="mt-2 w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                    />

                    <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                      <input
                        type="checkbox"
                        checked={option.isSpam}
                        onChange={(event) =>
                          updateOption(option.id, { isSpam: event.target.checked })
                        }
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      <span
                        title="이 카테고리로 분류된 메일을 2차 스팸 확률 분석 대상으로 삼습니다"
                      >
                        스팸 후보
                      </span>
                    </label>

                    {optionErrors.length > 0 && (
                      <p className="mt-1.5 text-xs text-red-400">{optionErrors.join(" ")}</p>
                    )}
                  </li>
                );
              })}
            </ul>

            {errors.general.length > 0 && (
              <p className="mt-2 text-xs text-red-400">{errors.general.join(" ")}</p>
            )}
            {errors.warnings.length > 0 && (
              <p className="mt-2 text-xs text-amber-400">{errors.warnings.join(" ")}</p>
            )}

            <button
              type="button"
              onClick={addOption}
              disabled={settings.options.length >= LIMITS.maxOptions}
              title={
                settings.options.length >= LIMITS.maxOptions
                  ? `카테고리는 최대 ${LIMITS.maxOptions}개까지 추가할 수 있습니다.`
                  : "카테고리 추가"
              }
              className="mt-3 w-full rounded-lg border border-dashed border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
            >
              + 카테고리 추가
            </button>
          </Section>

          <Section title="분석 범위">
            <NumberField
              label="메일 수"
              hint={`${numberFormat.format(LIMITS.mailCount.min)} ~ ${numberFormat.format(
                LIMITS.mailCount.max,
              )}개`}
              value={settings.mailCount}
              min={LIMITS.mailCount.min}
              max={LIMITS.mailCount.max}
              step={1}
              onChange={(value) => setNumber("mailCount", value)}
              formatValue={(value) => `${numberFormat.format(value)}개`}
            />
            <NumberField
              label="동시 요청 수"
              hint={`${LIMITS.concurrency.min} ~ ${LIMITS.concurrency.max} (concurrency)`}
              value={settings.concurrency}
              min={LIMITS.concurrency.min}
              max={LIMITS.concurrency.max}
              step={1}
              onChange={(value) => setNumber("concurrency", value)}
              formatValue={(value) => `${value}개`}
            />
          </Section>

          <Section title="임계값">
            <NumberField
              label="확신도 임계값"
              hint="이 값보다 확신도가 낮은 분류 결과는 검토가 필요한 항목으로 표시됩니다."
              value={settings.confidenceThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setNumber("confidenceThreshold", value)}
              formatValue={formatPercent}
            />
            <NumberField
              label="스팸 임계값"
              hint="스팸 확률이 이 값 이상이면 스팸 가능성이 높은 메일로 표시됩니다."
              value={settings.spamThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setNumber("spamThreshold", value)}
              formatValue={formatPercent}
            />
          </Section>
        </div>

        <footer className="border-t border-border px-5 py-4">
          <p className="mb-3 text-xs text-text-muted">변경사항은 자동 저장됩니다.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-text"
            >
              기본값으로 되돌리기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
            >
              닫기
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: NumberFieldProps) {
  const inputId = useId();
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-sm text-text">
          {label}
        </label>
        <span className="tabular-nums text-sm font-medium text-accent">
          {formatValue(value)}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent"
        aria-valuetext={formatValue(value)}
      />
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 4L14 14M14 4L4 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L3.5 8M8 3.5L12.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.5V12.5M8 12.5L3.5 8M8 12.5L12.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 5H13M6.5 5V3.5C6.5 3.22386 6.72386 3 7 3H9C9.27614 3 9.5 3.22386 9.5 3.5V5M11.5 5V12.5C11.5 12.7761 11.2761 13 11 13H5C4.72386 13 4.5 12.7761 4.5 12.5V5H11.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
