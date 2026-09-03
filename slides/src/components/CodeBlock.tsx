import { color, font, size } from "../theme";
import { Reveal } from "./Reveal";

type Props = {
  /** 파일명 라벨. 없으면 헤더를 그리지 않는다. */
  filename?: string;
  code: string;
  at?: number;
  /** 1-based 줄 번호. 해당 줄을 강조한다. */
  highlight?: number[];
  fontSize?: number;
};

/** 아티팩트 파일을 그대로 보여줄 때 쓰는 코드 블록. */
export const CodeBlock: React.FC<Props> = ({ filename, code, at = 0, highlight = [], fontSize = size.small }) => {
  const lines = code.replace(/\n$/, "").split("\n");

  return (
    <Reveal at={at} rise={22} name="CodeBlock" style={{ display: "flex" }}>
      <div
        style={{
          flex: 1,
          backgroundColor: color.bgAlt,
          border: `2px solid ${color.border}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {filename ? (
          <div
            style={{
              padding: "16px 28px",
              borderBottom: `2px solid ${color.border}`,
              fontFamily: font.mono,
              fontSize: size.tiny,
              color: color.accent,
              letterSpacing: 1,
            }}
          >
            {filename}
          </div>
        ) : null}
        <div style={{ padding: "26px 28px", fontFamily: font.mono, fontSize, lineHeight: 1.62 }}>
          {lines.map((line, i) => {
            const on = highlight.includes(i + 1);
            return (
              <div
                key={`${i}-${line}`}
                style={{
                  color: on ? color.text : color.textDim,
                  backgroundColor: on ? color.surfaceHi : "transparent",
                  borderLeft: `3px solid ${on ? color.accent : "transparent"}`,
                  paddingLeft: 16,
                  marginLeft: -16,
                  whiteSpace: "pre",
                }}
              >
                {line === "" ? " " : line}
              </div>
            );
          })}
        </div>
      </div>
    </Reveal>
  );
};
