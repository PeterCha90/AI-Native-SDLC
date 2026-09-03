import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const WORKTREES = [
  { name: "worktree/eng-1042-a", role: "구현" },
  { name: "worktree/eng-1042-b", role: "검증" },
  { name: "worktree/eng-1042-c", role: "리서치" },
];

const ROW_GAP = 140;
const TOP_PAD = 20;

const WorktreeDiagram: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const easing = Easing.bezier(0.16, 1, 0.3, 1);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ position: "relative", height: TOP_PAD + ROW_GAP * (WORKTREES.length - 1) + 40, marginLeft: 20, marginTop: 30 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -30,
            fontFamily: font.mono,
            fontSize: size.small,
            color: color.textFaint,
            letterSpacing: 1,
          }}
        >
          main
        </div>
        <Interactive.Div
          name="Trunk"
          style={{
            position: "absolute",
            left: 8,
            top: 0,
            width: 4,
            backgroundColor: color.border,
            borderRadius: 2,
            height: interpolate(frame, [0.3 * fps, 1.0 * fps], [0, TOP_PAD + ROW_GAP * (WORKTREES.length - 1) + 20], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing,
            }),
          }}
        />
        {WORKTREES.map((wt, i) => {
          const at = 1.1 + i * 0.85;
          const rowTop = TOP_PAD + i * ROW_GAP;
          return (
            <Interactive.Div
              key={wt.name}
              name={`Branch-${i}`}
              style={{ position: "absolute", left: 0, top: rowTop, display: "flex", alignItems: "center" }}
            >
              <div
                style={{
                  height: 4,
                  flexShrink: 0,
                  backgroundColor: color.cool,
                  width: interpolate(frame, [at * fps, (at + 0.55) * fps], [0, 90], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing,
                  }),
                }}
              />
              <div
                style={{
                  marginLeft: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  minWidth: 420,
                  backgroundColor: color.surface,
                  border: `2px solid ${color.coolDim}`,
                  borderRadius: 14,
                  padding: "16px 26px",
                  opacity: interpolate(frame, [(at + 0.35) * fps, (at + 0.9) * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing,
                  }),
                  translate: interpolate(frame, [(at + 0.35) * fps, (at + 0.9) * fps], ["-16px 0px", "0px 0px"], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing,
                  }),
                }}
              >
                <div style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: color.accent, flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontFamily: font.mono, fontSize: size.small, color: color.text, fontWeight: 700 }}>
                    {wt.name}
                  </div>
                  <div style={{ fontSize: size.tiny, color: color.textFaint }}>Claude session · {wt.role}</div>
                </div>
              </div>
            </Interactive.Div>
          );
        })}
      </div>
    </div>
  );
};

export const S12Build3: React.FC = () => {
  return (
    <Slide eyebrow="03 BUILD · 구현" title="한 사람이 여러 갈래를 동시에 민다" index={12}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.1, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "한 번에 하나",
              points: ["엔지니어 한 명이 한 작업", "컨텍스트 전환 비용이 커서 아무도 병행하지 않는다"],
            }}
            after={{
              heading: "병렬 세션과 서브에이전트",
              points: [
                "각자 별도 git worktree 에서 도는 여러 Claude 세션",
                "서브에이전트는 세션 안의 좁은 역할 — 검증자, 코드 단순화, 리서처",
                "역할이 구현에서 오케스트레이션으로 옮겨간다",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.9, display: "flex", flexDirection: "column", gap: 20 }}>
          <WorktreeDiagram />
          <Reveal at={3.6} style={{ alignSelf: "flex-start" }}>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: size.small,
                fontWeight: 700,
                color: color.accent,
                border: `2px solid ${color.accentDim}`,
                borderRadius: 999,
                padding: "10px 24px",
              }}
            >
              2~3개가 합리적인 출발점
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
