import { Slide } from "../components/Slide";
import { CodeBlock } from "../components/CodeBlock";
import { Reveal } from "../components/Reveal";
import { color, font, size } from "../theme";

const GATE_SH = `#!/usr/bin/env bash
set -euo pipefail

if [[ -z "\${RELEASE_APPROVED_BY:-}" ]]; then
  echo "release approval required" >&2
  exit 2
fi
`;

const GateNode: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      backgroundColor: color.surface,
      border: `2px solid ${color.border}`,
      borderRadius: 14,
      padding: "22px 28px",
      fontSize: size.body,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </div>
);

const Arrow: React.FC = () => <span style={{ fontFamily: font.mono, fontSize: 30, color: color.textFaint }}>→</span>;

const OutcomeBox: React.FC<{ tag: string; label: string; tone: "good" | "warn" | "danger" }> = ({
  tag,
  label,
  tone,
}) => {
  const c = { good: color.good, warn: color.warn, danger: color.danger }[tone];
  return (
    <div
      style={{
        backgroundColor: color.surfaceHi,
        border: `2px solid ${c}`,
        borderRadius: 12,
        padding: "10px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 130,
      }}
    >
      <div style={{ fontFamily: font.mono, fontSize: size.tiny, color: c, fontWeight: 700 }}>{tag}</div>
      <div style={{ fontSize: size.body, fontWeight: 800, color: color.text }}>{label}</div>
    </div>
  );
};

export const S16Deploy2: React.FC = () => {
  return (
    <Slide eyebrow="05 DEPLOY · 배포" title="hook 이 승인 게이트가 된다" index={16}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Reveal at={0.4} rise={20} name="NodeAgentChange">
            <GateNode label="에이전트 변경" />
          </Reveal>

          <Reveal at={1.0} rise={0} name="ArrowToHook">
            <Arrow />
          </Reveal>

          <Reveal at={1.1} rise={20} name="NodeHookCheck">
            <GateNode label="hook 검사" />
          </Reveal>

          <Reveal at={1.6} rise={0} name="ArrowToBranches">
            <Arrow />
          </Reveal>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              borderLeft: `3px solid ${color.border}`,
              paddingLeft: 26,
            }}
          >
            <Reveal at={1.7} rise={16} name="BranchAllow" style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <OutcomeBox tag="allow" label="통과" tone="good" />
              <Arrow />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <GateNode label="프로덕션 배포" />
                <Reveal at={2.6} rise={0} name="ApprovalBadge">
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: size.tiny,
                      color: color.warn,
                      border: `1px solid ${color.warn}`,
                      borderRadius: 999,
                      padding: "5px 12px",
                      display: "inline-block",
                    }}
                  >
                    지명된 사람 승인 필요
                  </div>
                </Reveal>
              </div>
            </Reveal>

            <Reveal at={2.1} rise={16} name="BranchAsk">
              <OutcomeBox tag="ask" label="사람 확인" tone="warn" />
            </Reveal>

            <Reveal at={2.5} rise={16} name="BranchBlock" style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <OutcomeBox tag="block" label="차단" tone="danger" />
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: size.tiny,
                  color: color.danger,
                  border: `1px solid ${color.danger}`,
                  borderRadius: 12,
                  padding: "8px 14px",
                  maxWidth: 380,
                  lineHeight: 1.4,
                }}
              >
                exit code 2 — 동작을 막고 그 이유를 Claude 에게 되돌려준다
              </div>
            </Reveal>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 40, marginTop: 4, alignItems: "center" }}>
        <Reveal at={4.6} name="EdgeStatement" style={{ flex: 1.1 }}>
          <div
            style={{
              fontSize: size.subtitle,
              fontWeight: 800,
              lineHeight: 1.4,
              borderLeft: `4px solid ${color.accent}`,
              paddingLeft: 26,
            }}
          >
            에이전트는 프로덕션 게이트까지 모든 것을 하고,
            <br />
            그 너머로는 <span style={{ color: color.accent }}>아무것도</span> 하지 않는다.
          </div>
        </Reveal>
        <div style={{ flex: 0.9, display: "flex" }}>
          <CodeBlock filename=".claude/hooks/production-gate.sh" code={GATE_SH} at={3.8} fontSize={17} />
        </div>
      </div>
    </Slide>
  );
};
