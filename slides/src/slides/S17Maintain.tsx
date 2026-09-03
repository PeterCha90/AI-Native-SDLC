import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** 30일 롤링 지표. sigma 단위(기준선으로부터의 표준편차 배수). 마지막 구간에서 3σ를 넘는다. */
const POINTS = [
  0.2, -0.3, 0.5, -0.6, 0.1, 0.4, -0.2, 0.6, -0.4, 0.3, 0.7, -0.1, 0.9, 1.3, 1.1, 1.8, 2.4, 2.9, 3.3, 3.9,
];
const N = POINTS.length;
const CHART_W = 640;
const CHART_H = 320;
const BASELINE_Y = CHART_H / 2;
const SIGMA_PX = 34;
/** POINTS[17]=2.9, POINTS[18]=3.3 — 그 사이 0.25 지점에서 값이 3σ를 넘는다. */
const CROSS_PROGRESS = 17.25;

// 오른쪽 끝에 여백을 둔다. 마지막 점의 경보 링이 패널 밖으로 잘리지 않게.
const X_INSET_RIGHT = 30;
const xAt = (i: number) => (i / (N - 1)) * (CHART_W - X_INSET_RIGHT);
const yAt = (sigma: number) => BASELINE_Y - sigma * SIGMA_PX;

const SIGMA_RULES = [
  { tag: "1σ", tone: color.textDim, rule: "기록만 한다" },
  { tag: "2σ", tone: color.warn, rule: "Claude 가 읽기 전용으로 진단한다" },
  { tag: "3σ", tone: color.danger, rule: "PR 또는 사전 승인된 런북으로만 행동한다" },
];

/** 시계열 + 30일 기준선 + 1/2/3σ 밴드. 라인이 그려지다가 3σ를 넘으면 경보가 뜬다. */
const SigmaBandChart: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const DRAW_START = 1.4 * fps;
  const DRAW_END = 6.0 * fps;
  const progress = interpolate(frame, [DRAW_START, DRAW_END], [0, N - 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const fullIdx = Math.min(Math.floor(progress), N - 1);
  const frac = progress - fullIdx;
  const nextIdx = Math.min(fullIdx + 1, N - 1);
  const tipValue = POINTS[fullIdx] + (POINTS[nextIdx] - POINTS[fullIdx]) * frac;
  const tipX = xAt(fullIdx + frac);
  const tipY = yAt(tipValue);

  const linePoints = POINTS.slice(0, fullIdx + 1)
    .map((v, i) => `${xAt(i)},${yAt(v)}`)
    .concat(`${tipX},${tipY}`)
    .join(" ");

  const breached = progress >= CROSS_PROGRESS;
  const alertOpacity = interpolate(progress, [CROSS_PROGRESS, CROSS_PROGRESS + 0.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const pulseP = interpolate(frame % 40, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const pulseR = interpolate(pulseP, [0, 1], [8, 24]);
  const pulseOpacity = interpolate(pulseP, [0, 1], [0.6, 0]) * alertOpacity;

  const crossX = xAt(CROSS_PROGRESS);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {/* 3σ 밴드 (가장 바깥, 먼저 그려서 아래에 깔린다). 옅은 채우기 + 경계선으로 지표선과 분리한다. */}
      <rect
        x={0}
        y={yAt(3)}
        width={CHART_W}
        height={SIGMA_PX * 6}
        fill={color.danger}
        opacity={0.07}
        stroke={color.danger}
        strokeOpacity={0.4}
        strokeWidth={1}
      />
      {/* 2σ 밴드 */}
      <rect
        x={0}
        y={yAt(2)}
        width={CHART_W}
        height={SIGMA_PX * 4}
        fill={color.warn}
        opacity={0.08}
        stroke={color.warn}
        strokeOpacity={0.4}
        strokeWidth={1}
      />
      {/* 1σ 밴드 (가장 안쪽, 위에 덮는다) */}
      <rect
        x={0}
        y={yAt(1)}
        width={CHART_W}
        height={SIGMA_PX * 2}
        fill={color.textDim}
        opacity={0.1}
        stroke={color.textDim}
        strokeOpacity={0.35}
        strokeWidth={1}
      />

      <line
        x1={0}
        y1={BASELINE_Y}
        x2={CHART_W}
        y2={BASELINE_Y}
        stroke={color.textDim}
        strokeWidth={2}
        strokeDasharray="6 6"
      />
      <text x={8} y={BASELINE_Y - 10} fill={color.textFaint} fontSize={16} fontFamily={font.mono}>
        30일 롤링 기준선
      </text>

      <line
        x1={crossX}
        y1={0}
        x2={crossX}
        y2={CHART_H}
        stroke={color.danger}
        strokeWidth={2}
        strokeDasharray="4 4"
        opacity={alertOpacity * 0.6}
      />

      <polyline
        points={linePoints}
        fill="none"
        stroke={color.text}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <circle cx={tipX} cy={tipY} r={pulseR} fill="none" stroke={color.danger} strokeWidth={2} opacity={pulseOpacity} />
      <circle cx={tipX} cy={tipY} r={6} fill={breached ? color.danger : color.text} />

      <g opacity={alertOpacity}>
        <rect
          x={CHART_W - 172}
          y={14}
          width={162}
          height={38}
          rx={8}
          fill={color.surfaceHi}
          stroke={color.danger}
          strokeWidth={2}
        />
        <text
          x={CHART_W - 91}
          y={39}
          textAnchor="middle"
          fill={color.danger}
          fontFamily={font.mono}
          fontSize={17}
          fontWeight={700}
        >
          3σ 이탈 · 경보
        </text>
      </g>
    </svg>
  );
};

export const S17Maintain: React.FC = () => {
  return (
    <Slide eyebrow="06 MAINTAIN · 운영" title="감시에서 자율로" index={17}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 26 }}>
        <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1.05, display: "flex" }}>
            <BeforeAfter
              compact
              before={{
                heading: "반응형 운영",
                points: [
                  "새벽 3시 알림을 놓친다",
                  "티켓이 백로그에 쌓인 채 방치된다",
                  "다른 불이 나면 회고 항목은 코드에 닿지 못한다",
                ],
              }}
              after={{
                heading: "트리거가 곧 시작점",
                points: [
                  "이탈·티켓·메시지·스케줄이 Claude 를 직접 호출한다",
                  "진단 결과를 intent.md 로 써서 1단계로 되돌린다",
                  "사람은 시작하는 대신 분류하고 검토한다",
                ],
              }}
            />
          </div>

          <div style={{ flex: 0.95, display: "flex" }}>
            <Reveal at={1.0} rise={26} name="SigmaPanel" style={{ flex: 1, display: "flex" }}>
              <div
                style={{
                  flex: 1,
                  backgroundColor: color.surface,
                  border: `2px solid ${color.border}`,
                  borderRadius: 20,
                  padding: "28px 36px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  // ponytail: 자식 SVG의 퍼센트 높이가 flex 자동 최소 높이 계산을 흔들어
                  // legend가 패널 밖으로 밀리는 걸 막는다. 넘치면 잘라내는 안전망.
                  overflow: "hidden",
                }}
              >
                <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.textFaint }}>
                  지표 · 30일 롤링 기준선 + σ 밴드
                </div>
                {/* flex:1 대신 고정 높이. SVG의 퍼센트 높이가 flex 최소 높이 계산에 끼어들어
                    legend 공간을 밀어내는 걸 막는다 — 남은 공간을 legend에 확실히 남긴다. */}
                <div style={{ flex: "0 0 200px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <SigmaBandChart />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {SIGMA_RULES.map((r) => (
                    <div key={r.tag} style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                      <span
                        style={{
                          fontFamily: font.mono,
                          fontSize: size.tiny,
                          fontWeight: 700,
                          color: r.tone,
                          width: 30,
                          flexShrink: 0,
                          lineHeight: 1.3,
                        }}
                      >
                        {r.tag}
                      </span>
                      <span style={{ fontSize: size.tiny, color: color.textDim, lineHeight: 1.3 }}>{r.rule}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Reveal at={6.8} name="BottomLine">
            <div style={{ fontSize: size.body, color: color.text }}>
              정기 코드베이스 스캔도 같은 방식이다 — 작은 수정은 PR, 큰 발견은 intent.md.
            </div>
          </Reveal>
          <Reveal at={7.6} name="Quote">
            <div style={{ fontSize: size.tiny, fontFamily: font.mono, color: color.textFaint, fontStyle: "italic" }}>
              “Coverage is dated from the last run, not from the first.”
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
