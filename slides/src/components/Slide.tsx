import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { color, font, SAFE, size } from "../theme";

type Props = {
  /** 좌상단 라벨. 보통 "01 PLAN" 같은 단계 표시. */
  eyebrow?: string;
  /** 슬라이드 제목. */
  title?: string;
  /** 우하단 슬라이드 번호. */
  index?: number;
  children?: React.ReactNode;
};

/**
 * 모든 슬라이드의 공통 프레임.
 * 배경, 안전 영역, 제목 등장 애니메이션을 담당한다.
 */
export const Slide: React.FC<Props> = ({ eyebrow, title, index, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Slide"
      style={{
        backgroundColor: color.bg,
        fontFamily: font.sans,
        color: color.text,
        padding: `${SAFE.y}px ${SAFE.x}px`,
        display: "flex",
        flexDirection: "column",
        // 한글은 기본 규칙이 음절 단위로 끊어서 "…한 / 다" 같은 고아 글자가 생긴다.
        // 어절 단위로 끊게 해서 슬라이드 전체의 개행을 정상화한다.
        wordBreak: "keep-all",
        overflowWrap: "break-word",
      }}
    >
      {/* 상단 얇은 강조선. 프레임에 무게를 준다. */}
      <Interactive.Div
        name="TopRule"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 5,
          backgroundColor: color.accent,
          width: interpolate(frame, [0, 1.2 * fps], ["0%", "100%"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />

      {eyebrow ? (
        <Interactive.Div
          name="Eyebrow"
          style={{
            fontSize: size.small,
            letterSpacing: 4,
            fontWeight: 700,
            color: color.accent,
            marginBottom: 18,
            opacity: interpolate(frame, [2, 0.7 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {eyebrow}
        </Interactive.Div>
      ) : null}

      {title ? (
        <Interactive.Div
          name="Title"
          style={{
            fontFamily: font.title,
            fontSize: size.headline,
            fontWeight: 400,
            lineHeight: 1.18,
            letterSpacing: -1,
            marginBottom: 44,
            opacity: interpolate(frame, [4, 0.9 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [4, 0.9 * fps], ["0px 22px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {title}
        </Interactive.Div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>

      {index ? (
        <div
          style={{
            position: "absolute",
            right: SAFE.x,
            bottom: 44,
            fontSize: size.tiny,
            fontFamily: font.mono,
            color: color.textFaint,
          }}
        >
          {String(index).padStart(2, "0")} / 18
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
