import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

type Layer = {
  key: string;
  file: string;
  desc: string;
  tone: string;
  toneDim: string;
  personality: string;
  badges?: string[];
};

const LAYERS: Layer[] = [
  {
    key: "context",
    file: "CLAUDE.md",
    desc: "저장소 컨텍스트. 명령어, 컨벤션, 아키텍처, 반복된 실수.",
    tone: color.textDim,
    toneDim: color.border,
    personality: "컨텍스트",
    badges: ["/init 로 생성", "1페이지 이내로 유지"],
  },
  {
    key: "skills",
    file: ".claude/skills/",
    desc: "조직의 제도적 지식. 조언 성격이며 강제되지 않는다. 버전 관리되고 정책 책임자가 승인한다.",
    tone: color.cool,
    toneDim: color.coolDim,
    personality: "조언",
  },
  {
    key: "hooks",
    file: ".claude/hooks/",
    desc: "결정론적 차단. 보호 경로 편집 차단, 자동 포맷·린트, 자격 증명이 diff 에 들어가면 차단.",
    tone: color.accent,
    toneDim: color.accentDim,
    personality: "강제",
  },
];

const StackLayer: React.FC<{ layer: Layer; at: number }> = ({ layer, at }) => {
  return (
    <Reveal at={at} rise={34} name={`Layer-${layer.key}`} style={{ display: "flex" }}>
      <div
        style={{
          flex: 1,
          backgroundColor: color.surface,
          border: `2px solid ${layer.toneDim}`,
          borderRadius: 18,
          padding: "20px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: font.mono, fontSize: size.subtitle, fontWeight: 800, color: layer.tone }}>
            {layer.file}
          </span>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: size.tiny,
              letterSpacing: 2,
              fontWeight: 700,
              color: layer.tone,
              border: `2px solid ${layer.toneDim}`,
              borderRadius: 999,
              padding: "6px 18px",
            }}
          >
            {layer.personality}
          </div>
        </div>
        <div style={{ fontSize: size.body, color: color.textDim, lineHeight: 1.4, maxWidth: 1400 }}>{layer.desc}</div>
        {layer.badges ? (
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {layer.badges.map((b) => (
              <span
                key={b}
                style={{
                  fontFamily: font.mono,
                  fontSize: size.tiny,
                  color: color.text,
                  backgroundColor: color.surfaceHi,
                  border: `1px solid ${color.border}`,
                  borderRadius: 8,
                  padding: "6px 14px",
                }}
              >
                {b}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Reveal>
  );
};

export const S11Build2: React.FC = () => {
  return (
    <Slide eyebrow="03 BUILD · 구현" title="가드레일은 세 층으로 쌓는다" index={11}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
        {LAYERS.map((layer, i) => (
          <StackLayer key={layer.key} layer={layer} at={0.6 + i * 0.75} />
        ))}

        <Reveal at={3.4} rise={16} style={{ marginTop: 8 }}>
          <div style={{ fontSize: size.body, fontWeight: 700, color: color.text, lineHeight: 1.35 }}>
            skill 은 위반을 드물게 만들고, hook 은 위반을 거의 불가능하게 만든다.
          </div>
          <div style={{ fontSize: size.tiny, color: color.textFaint, marginTop: 4 }}>
            The skill makes violations rare and the hook makes them close to impossible.
          </div>
        </Reveal>

        <Reveal at={4.2} rise={12}>
          <div style={{ fontSize: size.small, color: color.warn, fontWeight: 700 }}>
            같은 실수를 두 번 하면, 그 교정이 CLAUDE.md 로 들어간다.
          </div>
        </Reveal>
      </div>
    </Slide>
  );
};
