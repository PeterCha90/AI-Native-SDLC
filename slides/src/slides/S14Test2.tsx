import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Slide } from "../components/Slide";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

// 슬라이드 본문이 언급하는 트리거 조건(paths·schedule)까지만 보여준다.
// jobs 블록은 본문과 무관해 생략 — 세로 공간을 차트에 양보한다.
const AGENT_EVALS_YML = `name: agent-evals

on:
  push:
    paths:
      - ".claude/**"
      - "CLAUDE.md"
  schedule:
    - cron: "0 2 * * *"
`;

/** 사고가 하나씩 쌓이며 평가 세트가 20 → 50 건으로 자라는 막대들. */
const BAR_VALUES = [20, 23, 26, 29, 33, 36, 40, 44, 47, 50];
const BAR_START = 90; // frame = 3.0s
const BAR_STEP = 9; // frame. 막대 사이 간격.
const BAR_RISE = 14; // frame. 막대 하나가 자라는 시간.
const BAR_WIDTH = 64;
// 오른쪽 칼럼에 CodeBlock 과 함께 들어간다. 더 키우면 차트 상단이 CodeBlock 을 파고든다.
const BAR_MAX_HEIGHT = 120;
// 라벨(값 표시) 한 줄 + gap(6) 몫의 여유. 막대가 자라도 이 높이 안에서만 움직이게 해
// 위쪽 콘텐츠가 밀려 올라가지 않도록 고정한다.
const BAR_ROW_HEIGHT = BAR_MAX_HEIGHT + 44;

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
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6, width: BAR_WIDTH }}
    >
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
          width: BAR_WIDTH,
          height: h,
          backgroundColor: isLast ? color.accent : color.surfaceHi,
          border: `2px solid ${isLast ? color.accent : color.border}`,
          borderRadius: 8,
        }}
      />
    </div>
  );
};

export const S14Test2: React.FC = () => {
  return (
    <Slide eyebrow="04 TEST · 검증" title="평가가 QA 게이트를 대신한다" index={14}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0, paddingTop: 22 }}>
        <div style={{ flex: 0.9, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <Reveal at={0.5}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontFamily: font.mono, fontSize: size.hero, fontWeight: 900, color: color.accent, lineHeight: 1 }}>
                20~50
              </div>
              <div style={{ fontSize: size.subtitle, color: color.text, lineHeight: 1.4 }}>
                실제 작업을 모아 평가 세트로 만든다
              </div>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: font.mono, fontSize: size.tiny, color: color.textFaint, whiteSpace: "nowrap" }}>
                원문
              </span>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: size.tiny,
                  color: color.textDim,
                  fontStyle: "italic",
                  whiteSpace: "nowrap",
                }}
              >
                “the AI-native equivalent of stage-gate QA”
              </span>
            </div>
          </Reveal>
        </div>

        <div style={{ flex: 1.1, display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>
          <CodeBlock filename=".github/workflows/agent-evals.yml" code={AGENT_EVALS_YML} at={1.1} fontSize={22} />

          {/*
            내용 높이만큼만 차지하게 둔다. flex:1 + justifyContent:center 로 두면
            남는 공간보다 내용이 클 때 위아래 양쪽으로 넘쳐 위 CodeBlock 을 파고든다.
          */}
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", height: BAR_ROW_HEIGHT }}>
              {BAR_VALUES.map((v, i) => (
                <Bar key={v} value={v} index={i} isFirst={i === 0} isLast={i === BAR_VALUES.length - 1} />
              ))}
            </div>
            <Reveal at={6.3}>
              <div style={{ fontSize: size.small, color: color.textFaint }}>사고가 하나씩 쌓이며 평가 세트가 커진다</div>
            </Reveal>
          </div>
        </div>
      </div>
    </Slide>
  );
};
