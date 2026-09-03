import { color, font, size } from "../theme";

/** 원문의 6단계. 순서와 이름을 여기 한 곳에서만 관리한다. */
export const STAGES = [
  { no: "01", en: "PLAN", ko: "계획" },
  { no: "02", en: "DESIGN", ko: "설계" },
  { no: "03", en: "BUILD", ko: "구현" },
  { no: "04", en: "TEST", ko: "검증" },
  { no: "05", en: "DEPLOY", ko: "배포" },
  { no: "06", en: "MAINTAIN", ko: "운영" },
] as const;

type BadgeProps = {
  no: string;
  en: string;
  ko: string;
  /** 강조 여부. 현재 설명 중인 단계만 켠다. */
  active?: boolean;
  compact?: boolean;
};

export const StageBadge: React.FC<BadgeProps> = ({ no, en, ko, active = false, compact = false }) => {
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: active ? color.surfaceHi : color.surface,
        border: `2px solid ${active ? color.accent : color.border}`,
        borderRadius: 16,
        padding: compact ? "20px 18px" : "30px 24px",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 10,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: compact ? size.tiny : size.small,
          color: active ? color.accent : color.textFaint,
          fontWeight: 700,
        }}
      >
        {no}
      </div>
      <div
        style={{
          fontSize: compact ? size.small : size.subtitle,
          fontWeight: 800,
          letterSpacing: -0.5,
          color: active ? color.text : color.textDim,
        }}
      >
        {en}
      </div>
      <div style={{ fontSize: compact ? 18 : size.small, color: color.textFaint }}>{ko}</div>
    </div>
  );
};
