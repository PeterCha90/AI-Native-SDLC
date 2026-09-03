import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
  /** 등장 시작 시점(초). */
  at?: number;
  /** 등장에 걸리는 시간(초). */
  dur?: number;
  /** 아래에서 위로 올라오는 거리(px). 0이면 페이드만. */
  rise?: number;
  style?: React.CSSProperties;
  name?: string;
  children?: React.ReactNode;
};

/** 지연 페이드인 + 살짝 떠오르는 등장. 슬라이드 내부 요소 순차 노출에 쓴다. */
export const Reveal: React.FC<Props> = ({ at = 0, dur = 0.55, rise = 18, style, name = "Reveal", children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Interactive.Div
      name={name}
      style={{
        ...style,
        opacity: interpolate(frame, [at * fps, (at + dur) * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(frame, [at * fps, (at + dur) * fps], [`0px ${rise}px`, "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {children}
    </Interactive.Div>
  );
};
