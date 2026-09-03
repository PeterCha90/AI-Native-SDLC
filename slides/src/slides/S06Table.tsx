import { Slide } from "../components/Slide";
import { Reveal } from "../components/Reveal";
import { STAGES } from "../components/Stage";
import { color, font, size } from "../theme";

type Row = { before: string; after: string };

/** STAGES(01~06) 순서에 맞춘 원문 대조 데이터. */
const ROWS: Row[] = [
  { before: "위원회가 요구사항 수집, 워크숍과 승인으로 정제", after: "Claude가 문제점을 intent.md 로 수집" },
  { before: "분석가가 스펙 작성 후 디자이너가 해석", after: "요구사항과 설계를 한 세션으로 압축, git 버전 관리" },
  { before: "테스트와 코드를 손으로 작성, 문서는 나중에", after: "AI가 테스트와 코드 생성, 지식은 CLAUDE.md 와 skills 에" },
  { before: "단계 경계마다 QA 게이트", after: "구현 전반에 지속 평가가 엮여 있음" },
  { before: "사람이 모든 줄을 리뷰, 거버넌스는 일관성 없음", after: "계층형 에이전트 리뷰, hooks 가 승인 게이트" },
  { before: "사람이 프로덕션에서 버그를 감시", after: "에이전트가 모니터링, 이탈 시 새 intent.md 로 회신" },
];

const ROW_STEP = 0.6;
const COLS = "220px 1fr 1fr";

export const S06Table: React.FC = () => {
  return (
    <Slide eyebrow="BEFORE / AFTER" title="무엇이 바뀌는가" index={6}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Reveal at={0.05} rise={0} name="TableHeader">
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 28, padding: "0 4px 14px", borderBottom: `2px solid ${color.border}` }}>
            <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.textFaint }}>단계</div>
            <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.cool }}>TRADITIONAL</div>
            <div style={{ fontFamily: font.mono, fontSize: size.tiny, letterSpacing: 2, color: color.accent }}>AI-NATIVE</div>
          </div>
        </Reveal>

        {STAGES.map((s, i) => {
          const row = ROWS[i];
          const rowAt = 0.3 + i * ROW_STEP;
          return (
            <Reveal key={s.en} at={rowAt} rise={20} name={`TableRow-${s.en}`}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  gap: 28,
                  alignItems: "center",
                  padding: "16px 4px",
                  borderBottom: `1px solid ${color.border}`,
                }}
              >
                <div style={{ fontFamily: font.mono, fontSize: size.small, fontWeight: 700, color: color.text, whiteSpace: "nowrap" }}>
                  {s.no} {s.en}
                </div>
                <div style={{ fontSize: size.small, lineHeight: 1.4, color: color.cool }}>{row.before}</div>
                <Reveal at={rowAt + 0.3} rise={10} name={`TableRowAfter-${s.en}`}>
                  <div style={{ fontSize: size.small, lineHeight: 1.4, color: color.accent }}>{row.after}</div>
                </Reveal>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Slide>
  );
};
