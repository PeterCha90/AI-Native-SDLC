// API 서버와 Vite 를 한 터미널에서 같이 띄운다. 모니터는 로그를 따로 보도록 다른 터미널에서 돌린다.
import { spawn } from "node:child_process";

const procs = [
  ["server", "node", ["server/index.mjs"]],
  ["web", "npx", ["vite"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  // 서버는 스스로 [server] 를 찍으므로, 이미 [..] 로 시작하는 줄에는 접두어를 붙이지 않는다.
  const prefix = (chunk) => chunk.toString().replace(/^(?=[^\[\n])/gm, `[${name}] `);
  p.stdout.on("data", (c) => process.stdout.write(prefix(c)));
  p.stderr.on("data", (c) => process.stderr.write(prefix(c)));
  p.on("exit", (code) => {
    console.log(`[${name}] 종료 (code ${code})`);
    shutdown();
  });
  return p;
});

function shutdown() {
  for (const p of procs) if (p.exitCode === null) p.kill();
  process.exit();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
