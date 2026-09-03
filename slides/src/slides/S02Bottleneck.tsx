import { Easing, Interactive, interpolate, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES } from "../components/Stage";
import { color, font, size } from "../theme";

/** 전통적 SDLC에서 각 단계가 차지하는 상대 시간(%). STAGES와 같은 순서. */
const TRADITIONAL_RATIO = [18, 14, 100, 30, 22, 26] as const;
const BUILD_STAGE_INDEX = 2;
// 원문이 말하는 것은 "2배 빨라졌다"이다. 막대도 절반까지만 줄여 문구와 어긋나지 않게 한다.
const BUILD_SHRUNK_RATIO = 50;

export const S02Bottleneck: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Slide eyebrow="THE SHIFT" title="구현 단계가 무너졌다" index={2}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 44 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {STAGES.map((stage, i) => {
            const ratio = TRADITIONAL_RATIO[i];
            const isBuild = i === BUILD_STAGE_INDEX;
            const revealAt = 0.3 + i * 0.15;

            return (
              <Reveal
                key={stage.en}
                at={revealAt}
                dur={0.5}
                rise={16}
                name={`BarRow-${stage.en}`}
                style={{ display: "flex", alignItems: "center", gap: 28 }}
              >
                <div style={{ width: 230, flexShrink: 0 }}>
                  <Interactive.Div
                    name={`Label-${stage.en}`}
                    style={{
                      fontFamily: font.mono,
                      fontSize: size.small,
                      fontWeight: 800,
                      letterSpacing: 1,
                      color: isBuild ? color.accent : color.textDim,
                    }}
                  >
                    {stage.en}
                  </Interactive.Div>
                  <div style={{ fontSize: size.tiny, color: color.textFaint, marginTop: 2 }}>{stage.ko}</div>
                </div>

                <div
                  style={{
                    width: 1100,
                    flexShrink: 0,
                    position: "relative",
                    height: 42,
                    backgroundColor: color.surface,
                    border: `2px solid ${color.border}`,
                    borderRadius: 8,
                  }}
                >
                  <Interactive.Div
                    name={`Bar-${stage.en}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: 0,
                      borderRadius: 6,
                      backgroundColor: isBuild
                        ? interpolateColors(frame, [2.5 * fps, 4.5 * fps], [color.cool, color.accent], {
                            easing: Easing.bezier(0.16, 1, 0.3, 1),
                          })
                        : color.cool,
                      width: `${interpolate(
                        frame,
                        [revealAt * fps, (revealAt + 0.6) * fps, 2.5 * fps, 4.5 * fps],
                        [0, ratio, ratio, isBuild ? BUILD_SHRUNK_RATIO : ratio],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) },
                      )}%`,
                    }}
                  >
                    <Interactive.Div
                      name={`Value-${stage.en}`}
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "100%",
                        translate: "14px -50%",
                        whiteSpace: "nowrap",
                        fontFamily: font.mono,
                        fontSize: size.tiny,
                        fontWeight: 700,
                        color: isBuild ? color.accent : color.textFaint,
                      }}
                    >
                      {Math.round(
                        interpolate(
                          frame,
                          [revealAt * fps, (revealAt + 0.6) * fps, 2.5 * fps, 4.5 * fps],
                          [0, ratio, ratio, isBuild ? BUILD_SHRUNK_RATIO : ratio],
                          { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) },
                        ),
                      )}
                      %
                    </Interactive.Div>
                  </Interactive.Div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal at={5} dur={0.6} rise={20} name="Punchline">
          <div style={{ fontSize: size.subtitle, fontWeight: 800, color: color.text, lineHeight: 1.4 }}>
            구현은 <span style={{ color: color.accent }}>2배 빨라졌다</span>. 나머지는 그대로다.
          </div>
        </Reveal>
      </div>
    </Slide>
  );
};
