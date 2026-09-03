import { Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

/** 루프 순서: 코드 작성(0) → make test(1) → 실패(2) → 수정(3) → 다시 0. */
const LOOP_START = 30; // frame. 루프 애니메이션 시작.
const STEP_DUR = 12; // frame. 한 노드에 머무는 시간.
const TOTAL_STEPS = 10; // 2.5바퀴 = 4단계 * 2.5
const LOOP_END = LOOP_START + TOTAL_STEPS * STEP_DUR; // 150 frame = 5.0s

const LoopNode: React.FC<{ label: string; active: boolean; pulse: number }> = ({ label, active, pulse }) => (
  <Interactive.Div
    name={`LoopNode-${label}`}
    style={{
      backgroundColor: active ? color.surfaceHi : color.surface,
      border: `2px solid ${active ? color.accent : color.border}`,
      borderRadius: 12,
      padding: "14px 8px",
      fontSize: 22,
      fontWeight: 700,
      textAlign: "center",
      color: active ? color.text : color.textDim,
      scale: active ? 1 + pulse * 0.08 : 1,
    }}
  >
    {label}
  </Interactive.Div>
);

const Edge: React.FC<{ dir: "right" | "down" | "left" | "up"; active: boolean }> = ({ dir, active }) => {
  const glyph = { right: "→", down: "↓", left: "←", up: "↑" }[dir];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: font.mono,
        fontSize: 24,
        color: active ? color.accent : color.textFaint,
      }}
    >
      {glyph}
    </div>
  );
};

export const S13Test1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inLoop = frame >= LOOP_START && frame < LOOP_END;
  const stepIndex = inLoop ? Math.floor((frame - LOOP_START) / STEP_DUR) : -1;
  const activeNode = stepIndex >= 0 ? stepIndex % 4 : -1;
  const withinStep = inLoop ? (frame - LOOP_START) % STEP_DUR : 0;
  const pulse = inLoop
    ? interpolate(withinStep, [0, STEP_DUR / 2, STEP_DUR], [0, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <Slide eyebrow="04 TEST · 검증" title="에이전트가 스스로 확인한 뒤에 사람에게 보인다" index={13}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.15, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "신호가 늦게 도착한다",
              points: ["CI 는 몇 분, 테스터는 며칠, 프로덕션은 몇 주 뒤에 알려준다", "그 사람이 병목이 된다"],
            }}
            after={{
              heading: "닫힌 피드백 루프",
              points: [
                "검증을 명령 하나로 감싼다 — `make test`",
                "정량적 목표를 명시한다",
                "버그 수정은 실패하는 테스트를 먼저 쓴다",
                "UI 는 스크린샷 비교로 루프를 닫는다",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.85, display: "flex" }}>
          <Reveal at={1.0} rise={26} name="LoopCard" style={{ flex: 1, display: "flex" }}>
            <div
              style={{
                flex: 1,
                backgroundColor: color.surface,
                border: `2px solid ${color.border}`,
                borderRadius: 20,
                padding: "34px 32px",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Reveal
                at={1.3}
                rise={0}
                name="UiRepeatBadge"
                style={{
                  position: "absolute",
                  top: 24,
                  right: 24,
                  fontFamily: font.mono,
                  fontSize: size.tiny,
                  color: color.warn,
                  border: `1px solid ${color.warn}`,
                  borderRadius: 999,
                  padding: "6px 14px",
                  letterSpacing: 0.5,
                }}
              >
                UI 는 2~3회 반복이 보통
              </Reveal>

              <div style={{ display: "flex", gap: 30, alignItems: "flex-start", marginTop: 52 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "132px 40px 132px",
                    gridTemplateRows: "auto 40px auto",
                  }}
                >
                  <LoopNode label="코드 작성" active={activeNode === 0} pulse={pulse} />
                  <Edge dir="right" active={activeNode === 0} />
                  <LoopNode label="make test" active={activeNode === 1} pulse={pulse} />

                  <Edge dir="up" active={activeNode === 3} />
                  <div />
                  <Edge dir="down" active={activeNode === 1} />

                  <LoopNode label="수정" active={activeNode === 3} pulse={pulse} />
                  <Edge dir="left" active={activeNode === 2} />
                  <LoopNode label="실패" active={activeNode === 2} pulse={pulse} />
                </div>

                <Reveal
                  at={LOOP_END / fps}
                  name="ExitChain"
                  style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}
                >
                  <span style={{ fontFamily: font.mono, fontSize: 24, color: color.good }}>→</span>
                  <div
                    style={{
                      backgroundColor: color.surfaceHi,
                      border: `2px solid ${color.good}`,
                      borderRadius: 12,
                      padding: "14px 16px",
                      fontSize: 22,
                      fontWeight: 700,
                      color: color.good,
                    }}
                  >
                    통과
                  </div>
                  <Reveal
                    at={LOOP_END / fps + 0.5}
                    name="HumanReview"
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <span style={{ fontFamily: font.mono, fontSize: 24, color: color.textFaint }}>→</span>
                    <div
                      style={{
                        backgroundColor: color.surface,
                        border: `2px solid ${color.border}`,
                        borderRadius: 12,
                        padding: "14px 16px",
                        fontSize: 22,
                        fontWeight: 700,
                        color: color.text,
                      }}
                    >
                      사람 리뷰
                    </div>
                  </Reveal>
                </Reveal>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <Reveal at={6.2} rise={18} name="HookCallout" style={{ marginTop: 28 }}>
        <div
          style={{
            backgroundColor: color.surfaceHi,
            border: `2px solid ${color.accentDim}`,
            borderRadius: 16,
            padding: "22px 32px",
            fontSize: size.subtitle,
            fontWeight: 700,
            color: color.text,
          }}
        >
          수정 중에 테스트 파일을 편집하지 못하게 <span style={{ color: color.accent }}>hook</span> 으로 루프 자체를
          보호한다.
        </div>
      </Reveal>
    </Slide>
  );
};
