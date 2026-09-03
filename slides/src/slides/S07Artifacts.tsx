import { Fragment } from "react";
import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const CHAIN = ["intent.md", "spec.md", "plan.md", "diff + tests", "PR + review findings", "incident record"];
const CW = 1680;
const STEP = 0.5;
const CLOSE_START_S = 6;
const CLOSE_END_S = 6.8;

export const S07Artifacts: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Slide eyebrow="ARTIFACT CHAIN" title="단계를 잇는 것은 문서다" index={7}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ width: CW, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {CHAIN.map((label, i) => (
              <Fragment key={label}>
                <Reveal at={i * STEP} rise={18} name={`Artifact-${label}`}>
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: size.small,
                      color: color.text,
                      backgroundColor: color.surface,
                      border: `2px solid ${color.border}`,
                      borderRadius: 999,
                      padding: "16px 26px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </div>
                </Reveal>

                {i < CHAIN.length - 1 ? (
                  <Interactive.Div
                    name={`ArtifactArrow-${i}`}
                    style={{ flex: "1 1 60px", height: 12, display: "flex", alignItems: "center", padding: "0 10px" }}
                  >
                    <div
                      style={{
                        height: 3,
                        borderRadius: 2,
                        backgroundColor: color.accent,
                        width: interpolate(frame, [(i * STEP + 0.15) * fps, ((i + 1) * STEP + 0.05) * fps], ["0%", "100%"], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        }),
                      }}
                    />
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: color.accent,
                        opacity: interpolate(frame, [((i + 1) * STEP - 0.05) * fps, ((i + 1) * STEP + 0.05) * fps], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        }),
                      }}
                    />
                  </Interactive.Div>
                ) : null}
              </Fragment>
            ))}
          </div>

          <svg width={CW} height={90} style={{ display: "block", overflow: "visible" }}>
            <defs>
              <marker id="chainCloseArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={color.accent} />
              </marker>
            </defs>
            <path
              d={`M ${CW - 90} 6 C ${CW * 0.68} 78, ${CW * 0.32} 78, 90 6`}
              fill="none"
              stroke={color.accent}
              strokeWidth={3}
              markerEnd="url(#chainCloseArrow)"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={interpolate(frame, [CLOSE_START_S * fps, CLOSE_END_S * fps], [1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })}
            />
          </svg>

          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <Reveal at={3.2} name="ArtifactNote1">
              <div style={{ fontSize: size.body, color: color.textDim, textAlign: "center" }}>
                각 단계는 다음 단계가 읽을 아티팩트를 커밋한다.
              </div>
            </Reveal>
            <Reveal at={3.5} name="ArtifactNote2">
              <div style={{ fontSize: size.body, color: color.textDim, textAlign: "center" }}>
                이 체인이 그대로 감사 추적(audit trail)이 된다.
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </Slide>
  );
};
