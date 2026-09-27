## 01 Plan

Capture as intent.md.
Originator.

1.the product owner reviews and corrects the agent-written intent.md before it is committed.

2. 

A technical team member needs to stand up the intent home and decide who can write to it, since many contributors will come from across the organization.
intent/ 폴더를 어디에 위치 시켜야할지, 누가 여기에 intent.md를 쓸 수 있는지 정해야한다. 안그럼 여러조직의 많은 사람들이 관여할 수 있기 때문에.
모노레포일수록 좋다.

3. 

레포 위치 정해지면,클로드가 알아서 커밋하게 설정하면 된다. 

How to execute it

1. 그냥 평소에 말하듯이 말한다.
2. 구체적으로 자리잡을 때까지 brainstorming을 claude와 한다. 인터뷰 당한다. 스콥, 사용자, 제약사항, 성공적이라면 어떤 모양일지.
3. 그 결과를 intent.md로 만들어 달라고 한다. 조직의 형식에 따라서 - 스킬로 되어 있다. 개발자가 공식적으로 리더에게 허가를 받은 - 문제, 결과물, 영향을 끼칠 사용자, 시스템, 제약상황, 미결 사항(TBD) 등.
4. 여기서 클로드가 잘못 알아들은거 있으면 고친다.
5. 됐으면 커밋.

그다음, Product owner가 받을지 말지 결정하고 Design 단계로 넘긴다. 

Intent/Intent.md
Skill로 Organization’s template
Example

```
# Intent: claims status self-service
Author: J. Ortiz (claims operations). Status: draft.

## Problem
Customers phone the contact center to ask where their claim is.
Handlers spend roughly a third of call time on status-only queries.

## Proposed outcome
Customers see claim status, next step and expected date in the portal.

## Affected users and systems
Claims handlers, portal team, claims-core API.

## Constraints
No new PII in the portal session. Existing authentication only.

## Open questions
Do third-party loss adjusters need access too?
```

선행지표 - 당장 좋아지고 있나?

- 몇 일, 몇 주 걸리던 것이 몇 시간 안에 끝났는지?

- elicitation — 요구사항 도출. 현업 인터뷰하고 워크숍 돌려서 뭘 원하는지 캐내는 그 과정입니다.

- 
후행지표 - 실제로 좋은것이 맞았나?

- spec.md 커밋 이후에 intent.md에 가해진 수정 횟수도 함께 본다.

- survival rate — 만들어진 intent 문서 중 살아남아 다음 단계로 간 비율.
- 

- 

—

2. Design

  - 
  intent.md 를 보고, 아래 프롬프트에서 챙길거 챙기고 spec.md 생성
  사람이 spec 승인. Build 모드 시작.

Read the attached intent.md and produce a requirements and design spec for integrating it into our existing codebase. Apply the skills available to you so the plan conforms to our brand guidelines, security policies and UX standards. Document the spec fully as spec.md, ready to hand to the engineering team. Describe clearly any areas of concern, especially where you cannot satisfy contradicting policies.

입력 고정 — 첨부된 intent.md를 근거로 삼고, 기존 코드베이스 위에 얹히는 설계를 요구
제약 주입 — 조직 스킬(브랜드·보안·UX)을 참고가 아니라 준수 조건으로 적용
출력 규격 — 개발팀에 바로 넘길 수 있는 완결된 spec.md 한 파일
우려 사항 표면화 — 걸리는 지점, 특히 정책끼리 충돌해 다 만족시킬 수 없는 부분을 반드시 명시

이후 우려점을 ‘지정된 각 영역 담당자’들과 상의 및 진행여부 결정. 

3. Build
CLAUDE.md 가 여기서 등장.  있으면 좋다. 
Do / Do not

훅의 역할은 코드를 수정하고 작업이 끝나서 커밋을 할 때는 훅으로 ‘plan.md와 다르게 진행된 작업이 있는지 체크하고 있으면 plan.md 수정 후 다시 커밋’ 같은 걸 걸어놔라. 

Auto-mode는 ‘촘촘한 - a tight spec.md’와 좁은 영항 범위, 테스트가 자동화 됐을 때 써라고 가이드. 

Hook, skill, subagent 에 대해서도 가이드



## 4. Test

- **Feedback Loop** - 브라우저가 알아서 테스트할 수 있는 기준과 Loop를 만들어라. 
- CLAUDE.md, .claude/** 수정되면 테스트 돌려봐라. - 과거시점 실제 수정 사항으로 타임머신태우고 돌아가서, 시켜보기

## 5. Deploy

