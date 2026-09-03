import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, size } from "../theme";

const PLAN_MD = `# 구현 계획 — 청구 상태 셀프서비스

## 변경할 파일
- apps/portal/src/pages/ClaimStatus.tsx
- services/bff/src/claims-status.ts
- services/claims-core/src/routes/status.ts

## 작업 순서
1. BFF 에 상태 조회 엔드포인트 + 캐시 추가
2. claims-core rate limit 미들웨어 확인
3. ClaimStatus 페이지 구현
4. e2e 테스트 작성

## 위험 / 제약
claims-core 는 50 rps 에서 rate limit 이 걸린다

## 성공 기준
lint 통과, tests(unit + e2e) 통과
`;

export const S10Build1: React.FC = () => {
  return (
    <Slide eyebrow="03 BUILD · 구현" title="계획 없이는 아무것도 구현되지 않는다" index={10}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.15, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "머릿속에만 있는 계획",
              points: [
                "엔지니어가 바로 코딩을 시작한다",
                "어떻게 바꿀지는 본인 머릿속에만 있다",
                "리뷰어는 완성된 diff 만 본다. 그때 되돌리기엔 이미 늦다",
              ],
            }}
            after={{
              heading: "plan mode 를 기본 시작점으로",
              points: [
                "Claude 가 엔지니어를 인터뷰해 plan.md 를 만든다",
                "계획이 승인되기 전까지 파일을 수정할 수 없다",
                "\"무엇이 깨질 수 있는가\"를 물어 계획을 심문한다",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.85, display: "flex", flexDirection: "column", gap: 22 }}>
          <CodeBlock filename="docs/plan/ENG-1042.md" code={PLAN_MD} at={2.9} fontSize={17} />
          <Reveal at={4.0}>
            <div style={{ fontSize: size.small, color: color.textFaint, lineHeight: 1.5 }}>
              원래 intent 와 spec 을 못 본 다른 엔지니어도 구현할 수 있을 만큼 상세해야 한다.
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
