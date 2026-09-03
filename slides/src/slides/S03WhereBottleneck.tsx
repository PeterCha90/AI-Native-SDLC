import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES } from "../components/Stage";
import { color, font, size } from "../theme";

/** 각 단계에서 사람이 기다리는 상대적인 시간(0~100). STAGES와 같은 순서. */
const WAIT_LEVEL = [55, 45, 8, 70, 60, 90] as const;
/** 사람 속도를 체감하게 만드는 구체적인 단위. */
const WAIT_NOTE = ["3~5일", "2~4일", "수 시간", "1~2주", "승인 대기", "상시"] as const;
const BUILD_STAGE_INDEX = 2;

export const S03WhereBottleneck: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Slide eyebrow="THE SHIFT" title="그러면 병목은 어디로 갔나" index={3}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
          {STAGES.map((stage, i) => {
            const isBuild = i === BUILD_STAGE_INDEX;
            const chipAt = 0.3 + i * 0.08;
            const gaugeAt = 1.0 + i * 0.25;

            return (
              <div
                key={stage.en}
                style={{
                  flex: isBuild ? "0 0 170px" : "1 1 0",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 18,
                }}
              >
                <Reveal at={chipAt} dur={0.4} rise={14} name={`Chip-${stage.en}`} style={{ width: "100%" }}>
                  <div
                    style={{
                      backgroundColor: isBuild ? color.surfaceHi : color.surface,
                      border: `2px solid ${isBuild ? color.accent : color.coolDim}`,
                      borderRadius: 14,
                      padding: isBuild ? "12px 14px" : "20px 22px",
                      display: "flex",
                      flexDirection: "column",
                      gap: isBuild ? 4 : 8,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: font.mono,
                        fontSize: isBuild ? 18 : size.small,
                        fontWeight: 800,
                        letterSpacing: 1,
                        color: isBuild ? color.accent : color.cool,
                      }}
                    >
                      {stage.en}
                    </div>
                    <div style={{ fontSize: isBuild ? 14 : size.tiny, color: color.textFaint }}>{stage.ko}</div>
                  </div>
                </Reveal>

                <div
                  style={{
                    width: isBuild ? 34 : 64,
                    height: 220,
                    position: "relative",
                    backgroundColor: color.surface,
                    border: `2px solid ${color.border}`,
                    borderRadius: 10,
                  }}
                >
                  <Interactive.Div
                    name={`Gauge-${stage.en}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      borderRadius: 8,
                      backgroundColor: isBuild ? color.accent : color.cool,
                      height: `${interpolate(frame, [gaugeAt * fps, (gaugeAt + 0.7) * fps], [0, WAIT_LEVEL[i]], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      })}%`,
                    }}
                  />
                </div>

                <Reveal at={gaugeAt + 0.5} dur={0.4} rise={10} name={`Note-${stage.en}`}>
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: size.tiny,
                      color: isBuild ? color.accent : color.textFaint,
                    }}
                  >
                    {WAIT_NOTE[i]}
                  </div>
                </Reveal>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <Reveal at={3.6} dur={0.6} rise={18} name="QuoteKo">
            <div style={{ fontSize: size.title, fontWeight: 800, lineHeight: 1.3 }}>
              코드는 더 이상 병목이 아니다. <span style={{ color: color.accent }}>당신의 프로세스가 병목이다.</span>
            </div>
          </Reveal>
          <Reveal at={4.1} dur={0.5} rise={14} name="QuoteEn">
            <div style={{ fontFamily: font.mono, fontSize: size.small, color: color.textFaint, letterSpacing: 0.5 }}>
              &quot;Code is no longer the bottleneck, it&apos;s your process.&quot;
            </div>
          </Reveal>
          <Reveal at={4.9} dur={0.5} rise={14} name="Caveat">
            <div style={{ fontSize: size.small, color: color.textDim }}>대부분의 조직은 두 열 사이 어딘가에 있다.</div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
