export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** 안전 영역. 중요한 내용은 이 안쪽에 둔다. */
export const SAFE = { x: 120, y: 96 };

export const color = {
  bg: "#0E0D0B",
  bgAlt: "#141210",
  surface: "#1B1815",
  surfaceHi: "#252118",
  border: "#332E26",
  text: "#F2EFE9",
  textDim: "#9C958A",
  textFaint: "#6B655C",
  /** AI-native 쪽. 원문 브랜드 톤. */
  accent: "#D97757",
  accentDim: "#7A4433",
  /** 전통적 방식 쪽. */
  cool: "#7C8BA6",
  coolDim: "#3B4453",
  good: "#86A578",
  warn: "#C9A227",
  danger: "#C2635A",
} as const;

export const font = {
  /** 본문 기본. */
  sans: 'Pretendard, -apple-system, BlinkMacSystemFont, sans-serif',
  /** 제목 전용. 눈누기초고딕. */
  title: 'BasicGothic, Pretendard, -apple-system, sans-serif',
  /**
   * 코드·라벨용. 폰트 대체는 글리프 단위로 일어나므로 한글은 Pretendard 로 떨어진다.
   * 등폭 폰트에 한글 글리프가 없으면 자간이 벌어져 "수  시간" 처럼 보인다.
   */
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Pretendard, monospace',
} as const;

/** 1920x1080 기준 타이포 스케일. */
export const size = {
  hero: 116,
  headline: 84,
  title: 60,
  subtitle: 44,
  body: 36,
  small: 28,
  tiny: 22,
} as const;

/** 슬라이드별 길이(프레임). Root와 Deck이 같은 값을 참조한다. */
export const SLIDE_FRAMES = 9 * FPS;
