import { Slide } from "../components/Slide";
import { BeforeAfter } from "../components/BeforeAfter";
import { CodeBlock } from "../components/CodeBlock";
import { color, size } from "../theme";
import { Reveal } from "../components/Reveal";

const INTENT_MD = `# 청구 상태 셀프서비스

## 문제
상담원 통화 시간의 약 1/3이 "내 청구 어떻게 됐나요"
하나에 쓰인다.

## 원하는 결과
고객이 로그인 후 청구 상태를 직접 확인한다.

## 영향 범위
claims-core API, 고객 포털

## 제약
claims-core 는 50 rps 에서 rate limit 이 걸린다.
`;

export const S08Plan: React.FC = () => {
  return (
    <Slide eyebrow="01 PLAN · 계획" title="아이디어가 사람을 거치며 닳는다" index={8}>
      <div style={{ display: "flex", gap: 40, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1.15, display: "flex" }}>
          <BeforeAfter
            compact
            before={{
              heading: "핸드오프마다 유실",
              points: [
                "백로그 항목, 사용자 스토리, 스토리 포인트, 리파인먼트 회의를 차례로 통과",
                "단계마다 주인이 바뀐다",
                "엔지니어에게 도착한 것은 발안자가 의도한 것에서 여러 단계 떨어져 있다",
              ],
            }}
            after={{
              heading: "발안자가 직접 쓴다",
              points: [
                "문제를 겪은 사람이 Claude와 브레인스토밍한다",
                "결과를 자기 언어 그대로 intent.md 로 남긴다",
                "사람이 읽을 수 있고 기계가 실행할 수 있는 형태",
              ],
            }}
          />
        </div>

        <div style={{ flex: 0.85, display: "flex", flexDirection: "column", gap: 22 }}>
          <CodeBlock filename="docs/intent/ENG-1042.md" code={INTENT_MD} at={2.9} fontSize={24} />
          <Reveal at={4.0}>
            <div style={{ fontSize: size.small, color: color.textFaint, lineHeight: 1.5 }}>
              제품 책임자가 커밋 전에 검토하고 교정한다.
              <br />
              버전 관리되는 이 파일이 다음 단계의 유일한 입력이다.
            </div>
          </Reveal>
        </div>
      </div>
    </Slide>
  );
};
