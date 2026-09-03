import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, size } from "../theme";

const SPEC_MD = `# 청구 상태 셀프서비스 — 설계

## 요구사항
- 고객은 로그인 후 청구 상태를 실시간으로 확인한다
- claims-core API 호출은 50 rps 를 넘지 않는다
- WCAG 2.1 AA 접근성 기준을 충족한다

## 설계 결정
- 5분 캐시를 둔 BFF 레이어로 claims-core 를 감싼다
- 기존 디자인 시스템의 StatusBadge 를 재사용한다

## 미해결 질문
- 캐시 무효화를 웹훅으로 할지 폴링으로 할지 미정
`;

export const S09Design: React.FC = () => {
  return (
    <Slide eyebrow="02 DESIGN · 설계" title="요구사항과 설계가 한 세션으로 합쳐진다" index={9}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.15, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "분리된 단계, 분리된 팀",
              points: [
                "요구사항과 설계가 별개 단계",
                "분석가가 쓰고 디자이너가 재해석",
                "느리고 그 과정에서 정보가 유실된다",
              ],
            }}
            after={{
              heading: "제약 안에서 한 번에",
              points: [
                "승인된 intent.md 를 Claude 가 spec.md 로 전환",
                "브랜드·보안·컴플라이언스·UX skills 가 제약으로 작동",
                "정책과 충돌하는 지점을 인라인으로 표시한다",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.85, display: "flex", flexDirection: "column", gap: 22 }}>
          <CodeBlock filename="docs/spec/ENG-1042.md" code={SPEC_MD} at={2.9} fontSize={24} />
          <Reveal at={4.0}>
            <div style={{ fontSize: size.small, color: color.textFaint, lineHeight: 1.5 }}>
              프런트엔드는 Claude Design 에서 목업을 만들어 Claude Code 로 내보낼 수 있다.
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
