import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES, StageBadge } from "../components/Stage";
import { color, font, size } from "../theme";

/** 다이어그램 캔버스 크기. 콘텐츠 영역 안에 고정폭으로 그려서 SVG 좌표를 픽셀에 맞춘다. */
const CW = 1560;
const CH = 626;
const NODE_W = 172;
const NODE_H = 134;
const MARGIN_X = NODE_W / 2 + 20;
const CENTER_X = CW / 2;
const CENTER_Y = CH / 2;
// 세로는 제목과 캡션에 막혀 더 못 키운다. 대신 가로로 늘린 타원 궤도로 빈 좌우 공간을 쓴다.
const RADIUS_X = 470;
const RADIUS_Y = 214;
const HALF_W = NODE_W / 2;
const HALF_H = NODE_H / 2;
/** 화살표가 노드 카드 밑에 숨지 않도록 선을 카드 테두리 + 여백만큼 안쪽으로 당긴다. */
const EDGE_GAP = 10;

/** (cx,cy)에서 (dx,dy) 방향으로, 카드 테두리를 벗어난 지점을 반환한다. */
const pointOffRect = (cx: number, cy: number, dx: number, dy: number) => {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? HALF_W / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? HALF_H / Math.abs(dy) : Infinity;
  const edgeDist = Math.min(scaleX, scaleY) * len + EDGE_GAP;
  return { x: cx + (dx / len) * edgeDist, y: cy + (dy / len) * edgeDist };
};

/** 전통적 SDLC: 왼쪽→오른쪽 일직선. */
const LINEAR_POS = STAGES.map((_, i) => ({
  x: MARGIN_X + (i * (CW - 2 * MARGIN_X)) / (STAGES.length - 1),
  y: CENTER_Y,
}));

/** AI-native: 닫힌 원형 궤도. Plan이 정상(12시), 시계방향으로 배치. */
const CIRCULAR_POS = STAGES.map((_, i) => {
  const angle = -Math.PI / 2 + i * ((2 * Math.PI) / STAGES.length);
  return {
    x: CENTER_X + RADIUS_X * Math.cos(angle),
    y: CENTER_Y + RADIUS_Y * Math.sin(angle),
  };
});

const TRANSITION_START_S = 2.5;
const TRANSITION_END_S = 5;
const CLOSE_START_S = 4.2;
const CLOSE_END_S = 5.15;

/** Maintain(06) → Plan(01) 회귀 곡선의 제어점. 두 노드 사이 바깥쪽으로 크게 밀어내 루프 밖으로 뚜렷하게 튀어나오게 한다. */
const RETURN_BULGE = 170;
const RETURN_MID_X = (CIRCULAR_POS[5].x + CIRCULAR_POS[0].x) / 2;
const RETURN_MID_Y = (CIRCULAR_POS[5].y + CIRCULAR_POS[0].y) / 2;
const RETURN_OUT_LEN = Math.hypot(RETURN_MID_X - CENTER_X, RETURN_MID_Y - CENTER_Y);
const RETURN_OUT_X = (RETURN_MID_X - CENTER_X) / RETURN_OUT_LEN;
const RETURN_OUT_Y = (RETURN_MID_Y - CENTER_Y) / RETURN_OUT_LEN;
const RETURN_CTRL_X = CENTER_X + RETURN_OUT_X * (RETURN_OUT_LEN + RETURN_BULGE);
const RETURN_CTRL_Y = CENTER_Y + RETURN_OUT_Y * (RETURN_OUT_LEN + RETURN_BULGE);
/** 곡선 시작/끝점을 노드 카드 테두리 밖으로 당긴 좌표. */
const RETURN_START = pointOffRect(CIRCULAR_POS[5].x, CIRCULAR_POS[5].y, RETURN_CTRL_X - CIRCULAR_POS[5].x, RETURN_CTRL_Y - CIRCULAR_POS[5].y);
const RETURN_END = pointOffRect(CIRCULAR_POS[0].x, CIRCULAR_POS[0].y, RETURN_CTRL_X - CIRCULAR_POS[0].x, RETURN_CTRL_Y - CIRCULAR_POS[0].y);
/** 곡선 라벨 위치: PLAN 카드 왼쪽 바깥, 곡선의 정점보다 위. 오른쪽 끝을 카드 앞에 고정하고 텍스트는 왼쪽으로 자라게 해 카드/곡선과 절대 겹치지 않게 한다. */
// 라벨을 회귀 곡선보다 위·왼쪽으로 띄운다. 곡선이 글자를 가로지르면 둘 다 못 읽는다.
const RETURN_LABEL_RIGHT_X = CIRCULAR_POS[0].x - HALF_W - 150;
const RETURN_LABEL_Y = CENTER_Y + RETURN_OUT_Y * (RETURN_OUT_LEN + RETURN_BULGE * 0.72) - 44;

export const S04Loop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Slide eyebrow="CONCEPT" title="AI-native SDLC란 무엇인가" index={4}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}
      >
        <div style={{ position: "relative", width: CW, height: CH }}>
          <svg
            width={CW}
            height={CH}
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          >
            <defs>
              <marker id="loopArrowFwd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={color.textDim} />
              </marker>
              <marker id="loopArrowClose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={color.accent} />
              </marker>
            </defs>

            {/* 순차 연결 화살표. 위치가 선형→원형으로 보간되며 자연스럽게 루프 모양으로 휜다.
                노드 카드 밑에 화살촉이 숨지 않도록 카드 테두리 바로 바깥까지만 선을 그린다. */}
            {STAGES.slice(0, -1).map((s, i) => {
              const x1c = interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i].x, CIRCULAR_POS[i].x], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });
              const y1c = interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i].y, CIRCULAR_POS[i].y], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });
              const x2c = interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i + 1].x, CIRCULAR_POS[i + 1].x], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });
              const y2c = interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i + 1].y, CIRCULAR_POS[i + 1].y], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });
              const start = pointOffRect(x1c, y1c, x2c - x1c, y2c - y1c);
              const end = pointOffRect(x2c, y2c, x1c - x2c, y1c - y2c);
              return (
                <line
                  key={`arrow-${s.en}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={color.textDim}
                  strokeWidth={3}
                  markerEnd="url(#loopArrowFwd)"
                  opacity={interpolate(frame, [(i + 1) * 0.08 * fps, (i + 1) * 0.08 * fps + 0.5 * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  })}
                />
              );
            })}

            {/* Maintain → Plan: 루프를 닫는 회귀 화살표. 다른 화살표보다 굵고 크게, color.accent로 구분. */}
            <path
              d={`M ${RETURN_START.x} ${RETURN_START.y} Q ${RETURN_CTRL_X} ${RETURN_CTRL_Y} ${RETURN_END.x} ${RETURN_END.y}`}
              fill="none"
              stroke={color.accent}
              strokeWidth={5}
              markerEnd="url(#loopArrowClose)"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={interpolate(frame, [CLOSE_START_S * fps, CLOSE_END_S * fps], [1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })}
            />
          </svg>

          {/* 회귀 화살표 라벨: 왜 되돌아가는지 설명. */}
          <Interactive.Div
            name="ReturnLabel"
            style={{
              position: "absolute",
              left: RETURN_LABEL_RIGHT_X,
              top: RETURN_LABEL_Y,
              translate: "-100% -50%",
              whiteSpace: "nowrap",
              fontFamily: font.mono,
              fontSize: 20,
              fontWeight: 700,
              color: color.accent,
              opacity: interpolate(frame, [(CLOSE_START_S + 0.3) * fps, (CLOSE_START_S + 0.9) * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            incident → intent.md
          </Interactive.Div>

          {STAGES.map((s, i) => (
            <Interactive.Div
              key={s.en}
              name={`LoopNode-${s.en}`}
              style={{
                position: "absolute",
                left: interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i].x - NODE_W / 2, CIRCULAR_POS[i].x - NODE_W / 2], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                top: interpolate(frame, [TRANSITION_START_S * fps, TRANSITION_END_S * fps], [LINEAR_POS[i].y - NODE_H / 2, CIRCULAR_POS[i].y - NODE_H / 2], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                width: NODE_W,
                opacity: interpolate(frame, [i * 0.08 * fps, i * 0.08 * fps + 0.5 * fps], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <StageBadge no={s.no} en={s.en} ko={s.ko} compact />
            </Interactive.Div>
          ))}
        </div>

        <Reveal at={5.5} rise={14} name="LoopCaption">
          <div
            style={{
              fontSize: size.subtitle,
              fontWeight: 800,
              letterSpacing: -1,
              color: color.text,
              textAlign: "center",
            }}
          >
            사람의 판단은 루프 위에 남는다
          </div>
        </Reveal>
      </div>
    </Slide>
  );
};
