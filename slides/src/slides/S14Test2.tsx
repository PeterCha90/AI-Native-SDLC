import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Slide } from "../components/Slide";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const AGENT_EVALS_YML = `name: agent-evals

on:
  push:
    paths:
      - ".claude/**"
      - "CLAUDE.md"
  schedule:
    - cron: "0 2 * * *"

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make eval-agent
`;

/** 사고가 하나씩 쌓이며 평가 세트가 20 → 50 건으로 자라는 막대들. */
const BAR_VALUES = [20, 23, 26, 29, 33, 36, 40, 44, 47, 50];
const BAR_START = 90; // frame = 3.0s
const BAR_STEP = 9; // frame. 막대 사이 간격.
const BAR_RISE = 14; // frame. 막대 하나가 자라는 시간.
const BAR_MAX_HEIGHT = 130;

const Bar: React.FC<{ value: number; index: number; isLast: boolean; isFirst: boolean }> = ({
  value,
  index,
  isLast,
  isFirst,
}) => {
  const frame = useCurrentFrame();
  const start = BAR_START + index * BAR_STEP;
  const h = interpolate(frame, [start, start + BAR_RISE], [0, (value / 50) * BAR_MAX_HEIGHT], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6, width: 46 }}>
      {isFirst || isLast ? (
        <div style={{ fontFamily: font.mono, fontSize: size.tiny, color: isLast ? color.accent : color.textFaint }}>
          {value}
        </div>
      ) : (
        <div style={{ height: size.tiny }} />
      )}
      <Interactive.Div
        name={`EvalBar-${index}`}
        style={{
          width: 46,
          height: h,
          backgroundColor: isLast ? color.accent : color.surfaceHi,
          border: `2px solid ${isLast ? color.accent : color.border}`,
          borderRadius: 6,
        }}
      />
    </div>
  );
};

export const S14Test2: React.FC = () => {
  return (
    <Slide eyebrow="04 TEST · 검증" title="평가가 QA 게이트를 대신한다" index={14}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 0.9, display: "flex", flexDirection: "column", justifyContent: "center", gap: 32 }}>
          <Reveal at={0.5}>
            <div style={{ fontSize: size.subtitle, lineHeight: 1.5 }}>
              실제 작업{" "}
              <span style={{ fontFamily: font.mono, fontSize: size.headline, fontWeight: 900, color: color.accent }}>
                20~50
              </span>
              개를 모아 평가 세트로 만든다
            </div>
          </Reveal>

          <Reveal at={1.3}>
            <div style={{ fontSize: size.body, color: color.textDim, lineHeight: 1.5 }}>
              CI 에서 정기 실행 + <span style={{ color: color.text }}>CLAUDE.md</span> /{" "}
              <span style={{ color: color.text }}>skills</span> / <span style={{ color: color.text }}>hooks</span> 가
              바뀔 때마다 실행
            </div>
          </Reveal>

          <Reveal at={2.0}>
            <div
              style={{
                fontSize: size.body,
                color: color.text,
                lineHeight: 1.5,
                borderLeft: `3px solid ${color.accent}`,
                paddingLeft: 22,
              }}
            >
              프로덕션 사고는 하나도 빠짐없이 영구 평가 항목이 된다
            </div>
          </Reveal>

          <Reveal at={2.7}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontFamily: font.mono, fontSize: size.tiny, color: color.textFaint }}>원문</span>
              <span style={{ fontFamily: font.mono, fontSize: size.small, color: color.textDim, fontStyle: "italic" }}>
                “the AI-native equivalent of stage-gate QA”
              </span>
            </div>
          </Reveal>
        </div>

        <div style={{ flex: 1.1, display: "flex" }}>
          <CodeBlock filename=".github/workflows/agent-evals.yml" code={AGENT_EVALS_YML} at={1.1} fontSize={22} />
        </div>
      </div>

      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
          {BAR_VALUES.map((v, i) => (
            <Bar key={v} value={v} index={i} isFirst={i === 0} isLast={i === BAR_VALUES.length - 1} />
          ))}
        </div>
        <Reveal at={6.3}>
          <div style={{ fontSize: size.small, color: color.textFaint }}>사고가 하나씩 쌓이며 평가 세트가 커진다</div>
        </Reveal>
      </div>
    </Slide>
  );
};
