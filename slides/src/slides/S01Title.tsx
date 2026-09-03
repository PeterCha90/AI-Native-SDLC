import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { color, font, SAFE, size } from "../theme";
import { Reveal } from "../components/Reveal";

export const S01Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="TitleSlide"
      style={{
        backgroundColor: color.bg,
        fontFamily: font.sans,
        color: color.text,
        padding: `${SAFE.y}px ${SAFE.x}px`,
        justifyContent: "center",
      }}
    >
      {/* 배경에서 천천히 번지는 광원. 타이틀에만 쓴다. */}
      <Interactive.Div
        name="Glow"
        style={{
          position: "absolute",
          top: -260,
          right: -180,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color.accentDim} 0%, transparent 68%)`,
          opacity: interpolate(frame, [0, 3 * fps], [0, 0.55], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />

      <Reveal at={0.2} rise={0} name="Eyebrow">
        <div
          style={{
            fontFamily: font.mono,
            fontSize: size.subtitle,
            letterSpacing: 8,
            color: color.accent,
            fontWeight: 700,
            marginBottom: 34,
          }}
        >
          THE AI-NATIVE SDLC PLAYBOOK
        </div>
      </Reveal>

      <Interactive.Div
        name="Hero"
        style={{
          fontSize: size.hero,
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: -4,
          maxWidth: 1500,
          opacity: interpolate(frame, [0.5 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0.5 * fps, 1.5 * fps], ["0px 34px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        코드는 더 이상
        <br />
        <span style={{ color: color.accent }}>병목이 아니다</span>
      </Interactive.Div>

      <Reveal at={1.7} name="Sub" style={{ marginTop: 46 }}>
        <div style={{ fontSize: size.subtitle, color: color.textDim, lineHeight: 1.5, maxWidth: 1200 }}>
          에이전트가 구현 단계를 무너뜨린 뒤, 병목은 나머지 다섯 단계로 옮겨갔다.
          <br />
          소프트웨어 개발 수명주기 전체를 다시 설계하는 방법.
        </div>
      </Reveal>

      <Reveal at={2.5} name="Meta" style={{ marginTop: 64 }}>
        <div style={{ fontFamily: font.mono, fontSize: size.small, color: color.textFaint, letterSpacing: 1 }}>
          출처 · claude.com/blog/the-ai-native-sdlc-playbook
        </div>
      </Reveal>
    </AbsoluteFill>
  );
};
