// 시연을 처음 상태로 돌린다: 접근 로그, 모니터 상태, 드라이런 outbox 를 지운다.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_LOG, APP_ROOT, MONITOR_STATE } from "../ops/metrics.mjs";

for (const p of [ACCESS_LOG, MONITOR_STATE, join(APP_ROOT, "ops", "outbox")]) {
  rmSync(p, { recursive: true, force: true });
  console.log(`[reset] 삭제 ${p}`);
}
