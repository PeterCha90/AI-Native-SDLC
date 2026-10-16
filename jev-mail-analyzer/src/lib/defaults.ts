import type { AnalyzerSettings, ChoiceOption } from "./types";

/**
 * Palette chosen for legibility on the dark surface (#f5f6f8) — each hue stays
 * distinguishable at the small sizes the donut and the table badges use.
 */
export const CATEGORY_PALETTE = [
  "#2563c9", // blue
  "#0e8f5f", // green
  "#c96f22", // orange
  "#6d4fd0", // violet
  "#0b8a9e", // cyan
  "#9a6b0f", // amber
  "#cf3b46", // red
  "#8168d8", // lilac
  "#1f9268", // mint
  "#c4547f", // pink
] as const;

export const DEFAULT_OPTIONS: ChoiceOption[] = [
  {
    id: "work",
    label: "업무",
    description: "동료, 고객, 협력사와 주고받는 실제 업무 메일. 회의, 프로젝트, 계약, 채용 관련 내용",
    color: CATEGORY_PALETTE[0],
    isSpam: false,
  },
  {
    id: "personal",
    label: "개인",
    description: "지인이나 가족이 사람이 직접 써서 보낸 사적인 메일",
    color: CATEGORY_PALETTE[1],
    isSpam: false,
  },
  {
    id: "promotions",
    label: "프로모션",
    description: "구독한 서비스가 보내는 광고, 할인, 뉴스레터, 마케팅 메일",
    color: CATEGORY_PALETTE[2],
    isSpam: false,
  },
  {
    id: "updates",
    label: "알림·업데이트",
    description: "자동 발송되는 거래 알림. 영수증, 배송 안내, 정책 변경, 보안 알림, 가입 확인",
    color: CATEGORY_PALETTE[3],
    isSpam: false,
  },
  {
    id: "social",
    label: "소셜",
    description: "SNS, 커뮤니티, 메신저 플랫폼이 보내는 활동 알림",
    color: CATEGORY_PALETTE[4],
    isSpam: false,
  },
  {
    id: "finance",
    label: "금융·결제",
    description: "은행, 카드사, 결제 대행사가 보내는 명세서, 청구서, 입출금 내역",
    color: CATEGORY_PALETTE[5],
    isSpam: false,
  },
  {
    id: "spam",
    label: "스팸",
    description: "수신 동의한 적 없는 메일, 피싱, 사기, 정체를 숨긴 발신자",
    color: CATEGORY_PALETTE[6],
    isSpam: true,
  },
];

export const DEFAULT_SETTINGS: AnalyzerSettings = {
  instructions:
    "이 이메일은 어떤 종류의 메일인가? 발신자, 제목, 본문 미리보기를 함께 보고 가장 잘 맞는 카테고리 하나를 고르시오.",
  options: DEFAULT_OPTIONS,
  mailCount: 30,
  concurrency: 6,
  confidenceThreshold: 0.7,
  spamThreshold: 0.5,
};

/** Hard limits so a slider can't melt the API key. */
export const LIMITS = {
  mailCount: { min: 5, max: 500 },
  concurrency: { min: 1, max: 128 },
  minOptions: 2,
  maxOptions: 10,
} as const;

export const SETTINGS_STORAGE_KEY = "jev-mail-analyzer:settings:v2";
