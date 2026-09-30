# npx ai-sdlc-runner CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 러너를 `npx ai-sdlc-runner init` / `start`로 띄우게 한다. 토큰은 `init`에서 입력·검증해 저장한다.

**Architecture:** 러너 내부는 "기준 폴더(baseDir) 아래 `.state`·`.worktrees`"라는 지금 구조를 유지하고, 기준 폴더와 플러그인 위치만 설정에서 받게 바꾼다. 사용자 설정은 `~/.ai-sdlc/repos/<저장소키>/`에 `config.json`·`credentials.json`(600)으로 둔다. CLI는 의존성 없는 인자 파서 + `@clack/prompts`, 검증은 `fetch`로 Slack·Linear API를 직접 부른다(Bolt 미사용). 배포용으로 `tsc`가 `dist/`를 만든다.

**Tech Stack:** Node ≥ 22, TypeScript 5.9 (`rewriteRelativeImportExtensions`), `node:test`, `@clack/prompts` (이미 설치), `@slack/bolt`.

**Spec:** `docs/superpowers/specs/2026-10-01-sdlc-npx-cli-design.md`

## Global Constraints

- 경로는 `AI_SDLC/runner/` 기준. 테스트 `test/*.test.ts`, 검증 `npm test && npx tsc --noEmit`.
- 새 의존성 추가 금지(`@clack/prompts`는 설치됨). `package.json`은 Task 2만 수정한다.
- 사용자 문자열 한국어. 토큰은 출력·로그에 앞 8자까지만.
- 병렬 작업 중 커밋 금지(오케스트레이터가 커밋). 자기 Files 밖 수정 금지. 다른 작업 때문에 생긴 tsc/test 실패는 무시하고 보고.
- 기존 개발 경로(`runner/`에서 `npm start` + `sdlc.config.json` + 환경변수)는 계속 동작해야 한다.

## Review Focus

1. `credentials.json`이 이미 있고 권한이 644 → 읽을 때 경고 후 600으로 교정 (Task 1).
2. 봇 토큰 자리에 `xapp-…`를 붙여 넣음 → API 호출 전에 접두어로 즉시 알리고 그 단계만 다시 묻기 (Task 3).
3. 채널 링크(`https://…slack.com/archives/C0123`)를 붙여 넣음 → 채널 ID 추출 (Task 3).
4. `init` 도중 Ctrl+C → 아무 파일도 쓰지 않음 (Task 3).
5. npx로 설치된 패키지에서 `start` → 상태·worktree가 npm 캐시가 아니라 `~/.ai-sdlc/repos/<키>/` 아래에 생김 (Task 1, Task 5 스모크).

---

## Wave A (Task 1–4 병렬)

### Task 1: 경로·사용자 설정·로더 분리

**Files:**
- Create: `src/paths.ts`, `src/user-config.ts`, `test/paths.test.ts`, `test/user-config.test.ts`
- Modify: `src/config.ts`, `src/index.ts`, `src/pipeline.ts`, `test/config.test.ts`

**Interfaces (Produces):**
```ts
// paths.ts
export function packageRoot(): string;          // dist/ 또는 src/ 의 부모 (package.json 있는 곳)
export function bundledPluginDir(): string;     // <packageRoot>/plugin 있으면 그것, 없으면 <packageRoot>/../plugin
export function manifestPath(): string;         // <packageRoot>/slack/manifest.yaml
export function defaultHome(env?: NodeJS.ProcessEnv): string;   // env.AI_SDLC_HOME ?? ~/.ai-sdlc
export function repoKey(repoRoot: string): string;              // basename + "-" + sha256(abs path) 앞 10자
export interface RepoLayout { dir: string; configPath: string; credentialsPath: string }
export function repoLayout(home: string, repoRoot: string): RepoLayout;   // dir = <home>/repos/<repoKey>
export function findRepoRoot(cwd: string): string | null;       // git rev-parse --show-toplevel, 실패 시 null
// user-config.ts
export interface Credentials { slackBotToken?: string; slackAppToken?: string; linearApiKey?: string; linearWebhookSecret?: string }
export async function readCredentials(path: string, log?: (m: string) => void): Promise<Credentials>;  // 없으면 {}; 권한 > 600 이면 경고 + chmod 600
export async function writeCredentials(path: string, c: Credentials): Promise<void>;  // 폴더 700, 파일 600, tmp+rename
export async function readUserConfig(path: string): Promise<FileConfig | null>;
export async function writeUserConfig(path: string, c: FileConfig): Promise<void>;
export function maskToken(t: string | undefined): string;       // 앞 8자 + "…"
// config.ts
Config.baseDir: string;    // .state/.worktrees 의 부모. 개발 경로 = runner 폴더, 사용자 경로 = RepoLayout.dir
Config.pluginDir: string;  // 개발 경로 = <repo>/AI_SDLC/plugin, 패키지 = bundledPluginDir()
export interface LoadConfigOptions { env?: NodeJS.ProcessEnv; repo?: string; home?: string; credentials?: Credentials; fileConfig?: FileConfig }
export function loadConfig(opts?: LoadConfigOptions | NodeJS.ProcessEnv): Config;   // 기존 호출(env 하나) 호환
// index.ts
export function startServer(config?: Config): void;   // 인자 없으면 기존처럼 loadConfig()
```
- 선택 규칙: `SDLC_CONFIG_PATH` 있으면 그 파일(개발 경로). 아니면 `opts.fileConfig`가 주어지면 사용자 경로(`baseDir = repoLayout(home, repo).dir`, `repoPath = repo`). 둘 다 아니면 기존처럼 `runner/sdlc.config.json`(개발 경로, `baseDir = runner 폴더`).
- 자격 증명: 환경변수가 있으면 환경변수, 없으면 `opts.credentials`의 값. `SLACK_BOT_TOKEN`↔`slackBotToken`, `SLACK_APP_TOKEN`↔`slackAppToken`, `LINEAR_API_KEY`↔`linearApiKey`, `LINEAR_WEBHOOK_SECRET`↔`linearWebhookSecret`.
- 러너 내부의 `RUNNER_DIR`(index.ts), `PLUGIN_DIR`(pipeline.ts)를 `config.baseDir`, `config.pluginDir`로 교체. 러너가 `runnerDir`를 넘기던 자리는 전부 `config.baseDir`.

- [ ] **Step 1: 실패하는 테스트** — `repoKey` 같은 경로 → 같은 키, 다른 경로 → 다른 키; `repoLayout` 경로 조합; `defaultHome`가 `AI_SDLC_HOME` 우선; `writeCredentials` 후 파일 모드 `0o600`, 폴더 `0o700`; 644 파일 `readCredentials` → 경고 1회 + 모드 600; `maskToken("xoxb-1234567890")` = `"xoxb-123…"`; `loadConfig({ fileConfig, credentials, repo, home, env:{} })` → `baseDir`가 `<home>/repos/<key>`, 토큰이 credentials에서; 같은 호출에 `env.SLACK_BOT_TOKEN` 있으면 env 우선; `loadConfig(process.env 형태 객체)` 기존 호출 그대로 동작.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS (기존 테스트 포함).

### Task 2: 빌드와 패키지

**Files:**
- Create: `tsconfig.build.json`, `scripts/prepare-package.mjs`, `scripts/smoke-pack.mjs`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1:** `tsconfig.build.json` — `extends ./tsconfig.json`, `include: ["src/**/*.ts"]`, `noEmit: false`, `outDir: "dist"`, `rewriteRelativeImportExtensions: true`, `declaration: false`, `sourceMap: false`. `npx tsc -p tsconfig.build.json` 가 `dist/index.js` 등을 만들고 `node dist/index.js`의 import가 `.js`로 해석되는지 확인.
- [ ] **Step 2:** `package.json` — `"name": "ai-sdlc-runner"`, `"version": "0.4.0"`, `private` 제거, `"bin": { "ai-sdlc-runner": "dist/cli.js", "ai-sdlc": "dist/cli.js" }`, `"files": ["dist", "plugin", "slack/manifest.yaml", "README.md"]`, `"engines": { "node": ">=22" }`, scripts: `"build": "tsc -p tsconfig.build.json"`, `"prepack": "npm run build && node scripts/prepare-package.mjs"`, `"smoke:pack": "node scripts/smoke-pack.mjs"`; 기존 `start`/`test`/`typecheck` 유지. `license`, `repository`(`github:PeterCha90/FastCampus`, directory `AI_SDLC/runner`), `description` 채우기.
- [ ] **Step 3:** `prepare-package.mjs` — `../plugin`을 `./plugin`으로 복사(기존 것 지우고), `dist/cli.js` 실행 권한 부여. `.gitignore`에 `dist/`, `plugin/`(runner 안의 복사본) 추가.
- [ ] **Step 4:** `smoke-pack.mjs` — `npm pack --json`으로 tarball 생성 → 임시 폴더에 `npm init -y && npm i <tarball>` → `npx ai-sdlc-runner --help`와 `npx ai-sdlc-runner manifest` 종료 코드 0 확인, 설치된 패키지 안에 `plugin/skills/sdlc-intent/SKILL.md`와 `slack/manifest.yaml`이 있는지 확인 → 임시 폴더 삭제. `src/cli.ts`가 아직 없으면 "cli 없음"을 출력하고 종료 코드 2(Task 3 후 오케스트레이터가 실행).
- [ ] **Step 5:** `npm run build` 성공, `npm test && npx tsc --noEmit` PASS.

### Task 3: CLI 명령

**Files:**
- Create: `src/cli.ts`, `src/cli/args.ts`, `src/cli/verify.ts`, `src/cli/init.ts`, `src/cli/doctor.ts`, `src/cli/commands.ts`, `test/cli-args.test.ts`, `test/cli-verify.test.ts`, `test/cli-init.test.ts`, `test/cli-doctor.test.ts`

**Interfaces:**
- Consumes (Task 1, 병렬 작성 중 — 이름·타입 그대로): `paths.ts`·`user-config.ts` 전부, `loadConfig(LoadConfigOptions)`, `startServer(config)`, `Credentials`, `FileConfig`.
- Produces:
  ```ts
  // cli/args.ts — 의존성 없는 파서
  export interface ParsedArgs { command: "init" | "start" | "doctor" | "manifest" | "config" | "help"; repo?: string; home?: string; yes: boolean; open: boolean; skipChecks: boolean; channel?: string; team?: string }
  export function parseArgs(argv: string[]): ParsedArgs;    // 모르는 명령/옵션 → help
  // cli/verify.ts — fetch 주입 가능
  export type TokenKind = "slackBot" | "slackApp" | "linear";
  export function checkTokenPrefix(kind: TokenKind, token: string): string | null;   // 틀리면 한국어 이유, 맞으면 null (xoxb- / xapp- / lin_api_)
  export function parseChannelInput(input: string): string | null;                   // "C0123…" 또는 …/archives/C0123… → ID
  export interface Verifier {
    slackBot(token: string): Promise<{ ok: true; team: string; botName: string; botUserId: string } | { ok: false; error: string }>;      // auth.test
    slackApp(token: string): Promise<{ ok: true } | { ok: false; error: string }>;                                                        // apps.connections.open
    postTest(botToken: string, channel: string): Promise<{ ok: true } | { ok: false; error: string }>;                                   // chat.postMessage "AI-SDLC 연결 확인"
    userGroups(botToken: string): Promise<Array<{ id: string; handle: string; name: string }>>;                                          // usergroups.list
    linear(apiKey: string): Promise<{ ok: true; viewer: string; teams: Array<{ id: string; key: string; name: string }> } | { ok: false; error: string }>;
  }
  export function createVerifier(fetchImpl?: typeof fetch): Verifier;
  // cli/init.ts — 프롬프트 주입 가능
  export interface Prompter { text(o: { message: string; initialValue?: string; placeholder?: string }): Promise<string | symbol>; password(o: { message: string }): Promise<string | symbol>;
    select<T>(o: { message: string; options: Array<{ value: T; label: string; hint?: string }>; initialValue?: T }): Promise<T | symbol>; confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
    note(msg: string, title?: string): void; log(msg: string): void; isCancel(v: unknown): boolean }
  export interface InitDeps { prompter: Prompter; verifier: Verifier; repoRoot: string; home: string; installTemplates: (repoRoot: string) => Promise<string[]>; now?: () => Date }
  export async function runInit(d: InitDeps): Promise<{ saved: boolean; layout: RepoLayout }>;
  export async function runInitNonInteractive(d: Omit<InitDeps, "prompter"> & { env: NodeJS.ProcessEnv; channel?: string; team?: string }): Promise<{ saved: boolean; errors: string[] }>;
  // cli/doctor.ts
  export interface Check { name: string; ok: boolean; detail: string; fix?: string; blocking: boolean }
  export interface DoctorDeps { exec: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>; verifier: Verifier; repoRoot: string | null; config: FileConfig | null; credentials: Credentials }
  export async function runDoctor(d: DoctorDeps): Promise<Check[]>;
  export function formatChecks(checks: Check[]): string;
  ```
- `init` 흐름은 스펙 §5 순서 그대로. 기존 설정이 있으면 각 값을 기본값으로(토큰은 "기존 값 유지" 선택지). 검증 실패는 그 단계만 재질문(최대 3회, 이후 중단·미저장). `isCancel`이면 즉시 중단·미저장. 템플릿 설치는 `bundledPluginDir()/templates`에서 `CLAUDE.md.template→CLAUDE.md`, `REVIEW.md`, `ops/bands.yaml`, `ops/detect.sh`(실행 권한), 이미 있으면 건너뜀.
- `doctor` 점검: Node ≥ 22, `claude --version`, `claude auth status` 로그인(실패 시 blocking), `claude mcp list`에 linear 연결(blocking — `start`가 막음), 토큰 3개 검증, 채널 테스트 게시는 하지 않고 `conversations.info` 대신 `postTest`를 쓰지 않음(스팸 방지) — 채널은 `init` 때만 검증, 저장소 git 여부, 템플릿 파일 유무(경고), `ego-browser` 준비(경고).
- `cli.ts`: 첫 줄 `#!/usr/bin/env node`. `init`(`--yes`면 비대화형), `start`(설정 없으면 init 안내·exit 1; `--skip-checks` 없으면 blocking 점검 실패 시 exit 1; 통과하면 `startServer(loadConfig({ repo, home, fileConfig, credentials }))`), `doctor`(표 출력, blocking 실패 시 exit 1), `manifest`(`manifestPath()` 내용 출력, `--open`이면 `https://api.slack.com/apps?new_app=1` 를 `open`/`xdg-open`으로), `config`(설정 + 마스킹된 토큰), `help`.

- [ ] **Step 1: 실패하는 테스트** — args: `["init","--repo","/x","--yes"]` 파싱, 모르는 명령 → help; verify: 접두어 규칙 3종, 채널 링크 추출(`https://acme.slack.com/archives/C0ABC123/p1` → `C0ABC123`), 가짜 fetch로 auth.test ok/invalid_auth, linear viewer+teams 매핑; init: 가짜 prompter 시나리오 — 정상 흐름 저장(credentials 600, config에 channelId·linearTeamId·startMode·roleGroups), 봇 토큰 자리 `xapp-` → 재질문 후 성공, `not_in_channel` → 안내 후 재시도 성공, 중간 cancel → 파일 없음, 3회 실패 → 미저장; 비대화형: env 토큰 + `--channel` + `--team` → 저장, 토큰 누락 → errors; doctor: 가짜 exec로 claude 미설치 → blocking 실패, mcp 목록에 linear 없음 → blocking 실패, ego-browser 없음 → 비차단 경고, `formatChecks` 표에 ✅/❌/⚠️.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS.

### Task 4: 문서

**Files:**
- Modify: `../README.md`(AI_SDLC), `README.md`(runner), `../../README.md`(루트 "시작하기")

- [ ] **Step 1:** `AI_SDLC/README.md` 3-B·3-C를 `npx ai-sdlc-runner init` → `start` 중심으로 재작성: init이 묻는 것 표(순서대로), 토큰을 어디서 얻는지(봇 토큰·앱 토큰·Linear 키 각각 한 줄), `doctor`·`manifest`·`config` 명령 표, 설정이 저장되는 위치(`~/.ai-sdlc/repos/<키>/`, 토큰 파일 권한 600), 환경변수가 파일보다 우선, 서버용 `init --yes`. 클론·`sdlc.config.json`·`export`는 "개발자용: 소스에서 실행" 절로 아래에 모은다. 트러블슈팅에 `doctor` 안내 추가. 설치 섹션의 러너 관련 문장 정리.
- [ ] **Step 2:** runner README: 패키지 사용법(`npx`), 빌드(`npm run build`), 배포 전 `npm run smoke:pack`, 파일 배치.
- [ ] **Step 3:** 루트 README "시작하기"에 러너 두 줄 추가.

## Wave B

### Task 5: 패키지 스모크와 전체 리뷰

- [ ] `npm run smoke:pack` 통과 (설치된 패키지에서 `--help`, `manifest`, 동봉 파일 확인).
- [ ] 임시 HOME으로 `AI_SDLC_HOME=<tmp> npx ai-sdlc-runner config --repo <tmp repo>` → "먼저 init" 안내와 종료 코드 1.
- [ ] 브랜치 전체 리뷰(스펙 대비, Review Focus 5개), 지적 반영 후 전체 테스트·커밋.
