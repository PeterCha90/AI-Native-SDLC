import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES, StageBadge } from "../components/Stage";
import { color, font, size } from "../theme";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** 다이어그램 캔버스 크기. 콘텐츠 영역 안에 고정폭으로 그려서 SVG 좌표를 픽셀에 맞춘다. */
const CW = 1560;
const CH = 626;
const NODE_W = 200;
const NODE_H = 134;
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

/** 닫힌 원형 궤도. Plan이 정상(12시), 시계방향으로 배치. 처음부터 이 자리에 고정이고, 하나씩 나타날 뿐이다. */
const CIRCULAR_POS = STAGES.map((_, i) => {
  const angle = -Math.PI / 2 + i * ((2 * Math.PI) / STAGES.length);
  return {
    x: CENTER_X + RADIUS_X * Math.cos(angle),
    y: CENTER_Y + RADIUS_Y * Math.sin(angle),
  };
});

/** 순차 연결 화살표의 시작/끝점(카드 테두리 밖). 위치가 고정이라 한 번만 계산해두면 된다. */
const ARROW_SEGMENTS = STAGES.slice(0, -1).map((_, i) => {
  const a = CIRCULAR_POS[i];
  const b = CIRCULAR_POS[i + 1];
  return {
    start: pointOffRect(a.x, a.y, b.x - a.x, b.y - a.y),
    end: pointOffRect(b.x, b.y, a.x - b.x, a.y - b.y),
  };
});

/** 노드 → 화살표 → 다음 노드 순으로 하나씩 등장하는 타임라인(초). */
const NODE_APPEAR_DUR = 0.35;
const ARROW_APPEAR_DUR = 0.3;
const NODE_START_S: number[] = [];
const ARROW_START_S: number[] = [];
{
  let t = 0;
  for (let i = 0; i < STAGES.length; i++) {
    NODE_START_S.push(t);
    t += NODE_APPEAR_DUR;
    if (i < STAGES.length - 1) {
      ARROW_START_S.push(t);
      t += ARROW_APPEAR_DUR;
    }
  }
}
/** 6개 노드가 모두 나타난 시점. 이후 잠깐 쉬었다가 회귀 곡선이 시작된다. */
const CHAIN_END_S = NODE_START_S[NODE_START_S.length - 1] + NODE_APPEAR_DUR;
const CLOSE_START_S = CHAIN_END_S + 0.4;
const CLOSE_END_S = CLOSE_START_S + 1.0;

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

            {/* 순차 연결 화살표. 앞 노드가 나타난 직후 opacity 페이드로만 등장(위치는 고정). */}
            {STAGES.slice(0, -1).map((s, i) => {
              const seg = ARROW_SEGMENTS[i];
              const start = ARROW_START_S[i] * fps;
              return (
                <line
                  key={`arrow-${s.en}`}
                  x1={seg.start.x}
                  y1={seg.start.y}
                  x2={seg.end.x}
                  y2={seg.end.y}
                  stroke={color.textDim}
                  strokeWidth={3}
                  markerEnd="url(#loopArrowFwd)"
                  opacity={interpolate(frame, [start, start + ARROW_APPEAR_DUR * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: EASE,
                  })}
                />
              );
            })}

            {/* Maintain → Plan: 루프를 닫는 회귀 화살표. 6개 노드가 모두 나타난 뒤에만 그려진다.
                markerEnd(화살촉)은 strokeDasharray의 영향을 받지 않고 항상 그려지므로,
                곡선이 그려지기 시작하기 전에는 opacity로 화살촉까지 함께 감춘다. */}
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
                easing: EASE,
              })}
              opacity={interpolate(frame, [CLOSE_START_S * fps - 1, CLOSE_START_S * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
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
                easing: EASE,
              }),
            }}
          >
            incident → intent.md
          </Interactive.Div>

          {STAGES.map((s, i) => {
            const start = NODE_START_S[i] * fps;
            const end = start + NODE_APPEAR_DUR * fps;
            return (
              <Interactive.Div
                key={s.en}
                name={`LoopNode-${s.en}`}
                style={{
                  position: "absolute",
                  left: CIRCULAR_POS[i].x - NODE_W / 2,
                  top: CIRCULAR_POS[i].y - NODE_H / 2,
                  width: NODE_W,
                  opacity: interpolate(frame, [start, end], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: EASE,
                  }),
                  translate: interpolate(frame, [start, end], ["0px 14px", "0px 0px"], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: EASE,
                  }),
                }}
              >
                <StageBadge no={s.no} en={s.en} ko={s.ko} compact />
              </Interactive.Div>
            );
          })}
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
