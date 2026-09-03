import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES } from "../components/Stage";
import { color, font, size } from "../theme";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const deg2rad = (d: number) => (d * Math.PI) / 180;

/** 화살표 촉 폴리곤 포인트. LoopDiagram/AdoptionGraph 공용. */
const arrowHead = (tip: { x: number; y: number }, angleRad: number, sz = 12) => {
  const a1 = angleRad + Math.PI - 0.4;
  const a2 = angleRad + Math.PI + 0.4;
  return `${tip.x},${tip.y} ${tip.x + sz * Math.cos(a1)},${tip.y + sz * Math.sin(a1)} ${tip.x + sz * Math.cos(a2)},${tip.y + sz * Math.sin(a2)}`;
};

const LOOP_CX = 260;
const LOOP_CY = 250;
const LOOP_R = 160;
/** 이동하는 점은 노드 바깥 궤도를 돈다. 같은 반지름이면 노드 번호를 가린다. */
const DOT_R = LOOP_R + 48;
const pointAt = (angleDeg: number, radius: number = LOOP_R) => {
  const rad = deg2rad(angleDeg);
  return { x: LOOP_CX + radius * Math.cos(rad), y: LOOP_CY + radius * Math.sin(rad) };
};
const nodeAngle = (i: number) => -90 + i * 60;
const nodePoint = (i: number) => pointAt(nodeAngle(i));

/** 01→06 을 도는 빛나는 점. 06 도달 시 incident 화살표로 01 로 되돌아가 두 번째 회전을 시작한다. */
const LoopDiagram: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const F0 = 0.4 * fps;
  const F1 = F0 + 1.8 * fps;
  const F2 = F1 + 0.9 * fps;
  const F3 = F2 + 1.8 * fps;

  const rev1 = interpolate(frame, [F0, F1], [nodeAngle(0), nodeAngle(5)], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const rev2 = interpolate(frame, [F2, F3], [nodeAngle(0), nodeAngle(5)], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const t = interpolate(frame, [F1, F2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const p0 = nodePoint(5);
  const p1 = nodePoint(0);
  const c = { x: LOOP_CX, y: LOOP_CY };
  const bez = {
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
  };
  const dot = frame < F1 ? pointAt(rev1, DOT_R) : frame < F2 ? bez : pointAt(rev2, DOT_R);

  const incidentIn = interpolate(frame, [F1 - 4, F1 + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const incidentRest = interpolate(frame, [F2 + 20, F2 + 50], [1, 0.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const incidentOpacity = incidentIn * incidentRest;
  const arrowAngle = Math.atan2(p1.y - c.y, p1.x - c.x);

  return (
    <svg viewBox="0 0 520 540" style={{ width: "100%", height: "100%", display: "block" }}>
      <circle cx={LOOP_CX} cy={LOOP_CY} r={LOOP_R} fill="none" stroke={color.border} strokeWidth={2} strokeDasharray="3 7" />

      <path
        d={`M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`}
        fill="none"
        stroke={color.accent}
        strokeWidth={2.5}
        strokeDasharray="6 6"
        opacity={incidentOpacity}
      />
      <polygon points={arrowHead(p1, arrowAngle)} fill={color.accent} opacity={incidentOpacity} />
      <text x={c.x + 10} y={c.y - 14} fill={color.accent} fontFamily={font.mono} fontSize={16} opacity={incidentOpacity}>
        incident
      </text>

      {STAGES.map((s, i) => {
        const p = nodePoint(i);
        return (
          <g key={s.no}>
            <circle cx={p.x} cy={p.y} r={32} fill={color.surface} stroke={color.border} strokeWidth={2} />
            <text x={p.x} y={p.y + 7} textAnchor="middle" fill={color.text} fontFamily={font.mono} fontWeight={700} fontSize={20}>
              {s.no}
            </text>
            <text x={p.x} y={p.y + 52} textAnchor="middle" fill={color.textFaint} fontSize={16}>
              {s.ko}
            </text>
          </g>
        );
      })}

      <circle cx={dot.x} cy={dot.y} r={16} fill="none" stroke={color.accent} strokeWidth={2} opacity={0.4} />
      <circle cx={dot.x} cy={dot.y} r={9} fill={color.accent} />
    </svg>
  );
};

type GraphNode = { id: string; x: number; y: number; label: string; root?: boolean };

const NODES: GraphNode[] = [
  { id: "claude", x: 90, y: 70, label: "CLAUDE.md", root: true },
  { id: "plan", x: 90, y: 215, label: "plan mode", root: true },
  { id: "intent", x: 90, y: 360, label: "intent.md", root: true },
  { id: "hooks", x: 340, y: 60, label: "hooks" },
  { id: "subagents", x: 340, y: 240, label: "subagents" },
  { id: "gates", x: 560, y: 150, label: "review gates" },
];
const NODE_W = 150;
const NODE_H = 54;
const EDGES: [string, string][] = [
  ["claude", "hooks"],
  ["claude", "subagents"],
  ["plan", "subagents"],
  ["hooks", "gates"],
  ["intent", "gates"],
];
const byId = (id: string) => NODES.find((n) => n.id === id)!;

/** 원문 Figure 3 재현. 들어오는 화살표가 없는 노드(=배지)부터 시작해 화살표를 따라간다. */
const edgeGeom = (fromId: string, toId: string) => {
  const a = byId(fromId);
  const b = byId(toId);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  return { startX: a.x + ux * 80, startY: a.y + uy * 80, endX: b.x - ux * 94, endY: b.y - uy * 94, angle };
};

const AdoptionGraph: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const START = 3.4 * fps;
  const STAGGER = 0.3 * fps;
  const DUR = 0.6 * fps;

  const pulseP = interpolate(frame % 50, [0, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <svg viewBox="0 0 660 440" style={{ width: "100%", height: "100%", display: "block" }}>
      {EDGES.map(([from, to], i) => {
        const g = edgeGeom(from, to);
        const edgeStart = START + i * STAGGER;
        const drawT = interpolate(frame, [edgeStart, edgeStart + DUR], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE,
        });
        const arrowOpacity = interpolate(frame, [edgeStart + DUR * 0.6, edgeStart + DUR], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <g key={`${from}-${to}`}>
            <line
              x1={g.startX}
              y1={g.startY}
              x2={g.startX + (g.endX - g.startX) * drawT}
              y2={g.startY + (g.endY - g.startY) * drawT}
              stroke={color.textDim}
              strokeWidth={2}
            />
            <polygon points={arrowHead({ x: g.endX, y: g.endY }, g.angle)} fill={color.textDim} opacity={arrowOpacity} />
          </g>
        );
      })}

      {NODES.map((n) => (
        <g key={n.id}>
          {n.root ? (
            <rect
              x={n.x - NODE_W / 2 - pulseP * 10}
              y={n.y - NODE_H / 2 - pulseP * 10}
              width={NODE_W + pulseP * 20}
              height={NODE_H + pulseP * 20}
              rx={NODE_H / 2 + pulseP * 10}
              fill="none"
              stroke={color.accent}
              strokeWidth={2}
              opacity={(1 - pulseP) * 0.5}
            />
          ) : null}
          <rect
            x={n.x - NODE_W / 2}
            y={n.y - NODE_H / 2}
            width={NODE_W}
            height={NODE_H}
            rx={n.root ? NODE_H / 2 : 10}
            fill={n.root ? color.accentDim : color.surface}
            stroke={n.root ? color.accent : color.border}
            strokeWidth={2}
          />
          <text
            x={n.x}
            y={n.y + 6}
            textAnchor="middle"
            fill={n.root ? color.text : color.textDim}
            fontFamily={font.mono}
            fontSize={17}
            fontWeight={n.root ? 700 : 500}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
};

export const S18Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const abOpacity = interpolate(frame, [7 * fps, 8 * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <Slide eyebrow="CLOSING" title="루프가 닫힌다" index={18}>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Interactive.Div
          name="LoopAndGraph"
          style={{ position: "absolute", inset: 0, display: "flex", gap: 40, opacity: abOpacity }}
        >
          <Reveal at={0.5} rise={26} name="LoopPanel" style={{ flex: 1, display: "flex" }}>
            <div
              style={{
                flex: 1,
                backgroundColor: color.surface,
                border: `2px solid ${color.border}`,
                borderRadius: 20,
                padding: "28px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.textFaint }}>
                루프 · 06 → 01
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LoopDiagram />
              </div>
            </div>
          </Reveal>

          <Reveal at={3.0} rise={26} name="GraphPanel" style={{ flex: 1, display: "flex" }}>
            <div
              style={{
                flex: 1,
                backgroundColor: color.surface,
                border: `2px solid ${color.border}`,
                borderRadius: 20,
                padding: "28px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.textFaint }}>
                도입 순서
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <AdoptionGraph />
              </div>
              <div style={{ fontSize: size.small, color: color.textDim, lineHeight: 1.4 }}>
                아무것도 가리키지 않는 곳부터 시작하고, 화살표를 따라간다
              </div>
            </div>
          </Reveal>
        </Interactive.Div>

        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Reveal at={8.2} rise={22} name="BigLine">
            <div style={{ fontSize: size.headline, fontWeight: 900, lineHeight: 1.25, letterSpacing: -2 }}>
              루프는 계속 돌고,
              <br />
              사람의 판단은 <span style={{ color: color.accent }}>그 위에</span> 남는다
            </div>
          </Reveal>
          <Reveal at={9.0} name="SubLine" style={{ marginTop: 36 }}>
            <div style={{ fontFamily: font.mono, fontSize: size.small, color: color.textFaint }}>
              The loop keeps running, and human judgement stays above it.
            </div>
          </Reveal>
          <Reveal at={9.6} name="Source" style={{ marginTop: 52 }}>
            <div style={{ fontFamily: font.mono, fontSize: size.small, color: color.textFaint, letterSpacing: 1 }}>
              출처 · claude.com/blog/the-ai-native-sdlc-playbook
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
