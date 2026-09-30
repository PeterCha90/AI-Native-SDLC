- [https://claude.com/blog/the-ai-native-sdlc-playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) 내용을 반영하여 하고자 하는 일은 크게 두 파트로 나뉜다.
  - 참고자료 - [https://www.youtube.com/watch?v=LoMOPj-lO8U](https://www.youtube.com/watch?v=LoMOPj-lO8U) 



1. Linear Ticket 생성을 자동으로 인지하고 AI-SDLC 자동화 파이프라인을 설계하고 누구나 참고해서 반영할 수 있는 Github plugin을 만드는 것

- 이 때, Linear가 아닌 Jira와 같은 다른 툴로 Trigger가 되는 Ticket 제공 파트는 변경할 수 있도록 유연하게 설계.
- 실제로 참고자료에 나오는 것 같이 lint 같은 훅을 설정하는 것과 같은 모든 단계를 세세하게 살펴보고 단계단계를 섬세하게 세팅할 것. 
  - e2e review는 ego-lite/Aside cli를 사용해서 진행하도록 세팅. ego-lite가 default.
- [https://zoetrope.furkankly.dev/](https://zoetrope.furkankly.dev/) 로 시각화해서 내 SDLC가 어떻게 흐르는지 시각화해서 사람이 볼 수 있는 페이지도 제공할 것.

- 모든 단계가 생성이 완료되었다면, 시연을 위한 작은 프로젝트를 생성하고 - 내가 어떻게 다른 사람들에게 이것을 시연하면 좋을지 시나리오를 작성해줘.
  - React vite + Node API 서버 스택으로 가볍게 만들어줄 것 (구현: `AI_SDLC/todo-app/`). 
  - 실제로 작은 에러로 인해 Ticket 이 자동 생성되고 거기서 intent.md가 생성되고 SDLC가 흘러가는지 zoetrope로 볼 수 있도록 해줄 것.



&nbsp;

2. AI-native SDLC의 개념은 무엇인지부터, 원문([https://claude.com/blog/the-ai-native-sdlc-playbook](https://claude.com/blog/the-ai-native-sdlc-playbook))에 나오는 장표를 기준으로 설명을하는 Remotion으로 만들어진 Animation 발표자료를 @slides/ 에 생성. 참고자료 링크 화자의 멘트를 모두 참고해서 개념을 원문의 before/after에 충실하게 설명할 것.

