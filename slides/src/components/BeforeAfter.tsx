import { color, font, size } from "../theme";
import { Reveal } from "./Reveal";

type SideProps = {
  kind: "before" | "after";
  label: string;
  heading: string;
  points: string[];
  at?: number;
  /** 카드가 좁은 칼럼에 들어갈 때. 글자와 여백을 줄인다. */
  compact?: boolean;
};

const tone = {
  before: { accent: color.cool, dim: color.coolDim },
  after: { accent: color.accent, dim: color.accentDim },
} as const;

/** 대조 카드 한 장. 전통적 방식 / AI-native 를 같은 형태로 나란히 놓는다. */
export const ContrastCard: React.FC<SideProps> = ({ kind, label, heading, points, at = 0, compact = false }) => {
  const t = tone[kind];
  return (
    <Reveal at={at} rise={26} name={kind === "before" ? "BeforeCard" : "AfterCard"} style={{ flex: 1, display: "flex" }}>
      <div
        style={{
          flex: 1,
          backgroundColor: color.surface,
          border: `2px solid ${t.dim}`,
          borderRadius: 20,
          padding: compact ? "26px 28px" : "40px 44px",
          display: "flex",
          flexDirection: "column",
          gap: compact ? 14 : 22,
        }}
      >
        <div
          style={{
            fontSize: size.tiny,
            fontFamily: font.mono,
            letterSpacing: 3,
            fontWeight: 700,
            color: t.accent,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: compact ? size.subtitle : size.title,
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: -1,
          }}
        >
          {heading}
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: compact ? 12 : 18,
          }}
        >
          {points.map((p, i) => (
            <li
              key={p}
              style={{
                fontSize: compact ? size.small : size.body,
                lineHeight: 1.45,
                color: color.textDim,
                display: "flex",
                gap: 16,
              }}
            >
              <span style={{ color: t.accent, fontFamily: font.mono, flexShrink: 0 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
};

type Props = {
  before: { heading: string; points: string[] };
  after: { heading: string; points: string[] };
  /** after 카드가 뒤늦게 등장하는 시점(초). */
  afterAt?: number;
  /** 좁은 칼럼에 넣을 때. 두 카드 모두 축소된다. */
  compact?: boolean;
};

/** 좌: 전통적 방식, 우: AI-native. 원문의 before/after 대조를 그대로 옮긴다. */
export const BeforeAfter: React.FC<Props> = ({ before, after, afterAt = 1.6, compact = false }) => {
  return (
    <div style={{ flex: 1, display: "flex", gap: compact ? 22 : 40, alignItems: "stretch" }}>
      <ContrastCard
        kind="before"
        label="TRADITIONAL"
        heading={before.heading}
        points={before.points}
        at={0.7}
        compact={compact}
      />
      <ContrastCard
        kind="after"
        label="AI-NATIVE"
        heading={after.heading}
        points={after.points}
        at={afterAt}
        compact={compact}
      />
    </div>
  );
};
