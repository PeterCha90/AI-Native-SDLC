import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES, StageBadge } from "../components/Stage";
import { color, font, size } from "../theme";

/** STAGES 순서(01~06)에 맞춘 AI-native 한 줄 요약. */
const SUMMARY: Record<string, string> = {
  PLAN: "아이디어가 더 이상 누군가 정리해주길 기다리지 않는다",
  DESIGN: "요구사항과 설계가 한 세션으로 합쳐진다",
  BUILD: "승인된 계획 없이는 아무것도 구현되지 않는다",
  TEST: "모든 세션이 사람에게 보이기 전에 스스로 검증한다",
  DEPLOY: "에이전트는 프로덕션 게이트까지만 간다",
  MAINTAIN: "루프가 닫힌다",
};

const STEP = 0.35;

export const S05Stages: React.FC = () => {
  return (
    <Slide eyebrow="OVERVIEW" title="여섯 단계" index={5}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
        <div style={{ display: "flex", gap: 22 }}>
          {STAGES.map((s, i) => (
            <Reveal key={s.en} at={i * STEP} rise={24} style={{ flex: 1, display: "flex" }} name={`StageBadge-${s.en}`}>
              <StageBadge no={s.no} en={s.en} ko={s.ko} />
            </Reveal>
          ))}
        </div>

        <div style={{ display: "flex", gap: 22 }}>
          {STAGES.map((s, i) => (
            <Reveal key={s.en} at={i * STEP + 0.15} rise={16} style={{ flex: 1 }} name={`StageSummary-${s.en}`}>
              <div style={{ fontSize: size.small, color: color.textDim, lineHeight: 1.45, textAlign: "center" }}>
                {SUMMARY[s.en]}
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal at={STAGES.length * STEP + 0.4} name="LoopQuote" style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: font.mono, fontSize: size.tiny, color: color.textFaint, letterSpacing: 0.5, textAlign: "center" }}>
            &ldquo;The agent does everything up to the production gate and nothing past it.&rdquo;
          </div>
        </Reveal>
      </div>
    </Slide>
  );
};
