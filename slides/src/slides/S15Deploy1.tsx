import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const REVIEW_MD = `# 리뷰 정책

## 3 Passes
1. Bugs — 정확성, 회귀 여부
2. Security — 인증, 입력 검증
3. Compliance — 사내 표준, 라이선스

## 심각도
- Important — 반드시 고쳐야 함
- Nit — 있으면 좋음, 선택

## 보고 규칙
Nit 은 최대 5개까지만 나열한다.
나머지는 "+N개 더" 로 개수만 요약한다.
`;

export const S15Deploy1: React.FC = () => {
  return (
    <Slide eyebrow="05 DEPLOY · 배포" title="리뷰는 계층으로, 사람은 판단에 집중한다" index={15}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.15, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "사람 처리량이 곧 리뷰 용량",
              points: ["리뷰 용량을 사람 산출량에 맞춰 계획한다", "리뷰어 부하에 따라 품질이 들쭉날쭉하다"],
            }}
            after={{
              heading: "모든 PR 이 같은 검사를 받는다",
              points: [
                "Bugs / Security / Compliance 세 번의 패스",
                "심각도 순으로 정렬해 보고한다",
                "사람은 의도와 위험을 판단하는 층으로 올라간다",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.85, display: "flex" }}>
          <CodeBlock filename="REVIEW.md" code={REVIEW_MD} at={2.4} fontSize={24} />
        </div>
      </div>

      <Reveal at={4.2} rise={20} name="ApprovalQuote" style={{ marginTop: 30 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderLeft: `4px solid ${color.accent}`,
            paddingLeft: 28,
          }}
        >
          <div style={{ fontSize: size.title, fontWeight: 800, lineHeight: 1.3 }}>
            “코드를 작성한 에이전트에게는 그것을 승인할 방법이 없다.”
          </div>
          <div style={{ fontSize: size.body, fontFamily: font.mono, color: color.textFaint, fontStyle: "italic" }}>
            The agent that wrote the code has no way to approve it.
          </div>
        </div>
      </Reveal>
    </Slide>
  );
};
