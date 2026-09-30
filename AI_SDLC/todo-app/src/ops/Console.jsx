import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

const METRICS = {
  api_5xx_rate: { label: "5xx", name: "서버 오류율", threshold: 0.06, color: "var(--red)" },
  api_4xx_rate: { label: "4xx", name: "클라이언트 오류율", threshold: 0.1875, color: "var(--amber)" },
};
const TIER = {
  null: { text: "표본 부족", cls: "t-idle" },
  0: { text: "정상", cls: "t-ok" },
  1: { text: "1σ · 기록", cls: "t-1" },
  2: { text: "2σ · 진단 대상", cls: "t-2" },
  3: { text: "3σ · 티켓", cls: "t-3" },
};
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const hms = (iso) => new Date(iso).toTimeString().slice(0, 8);
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}초 전` : `${Math.floor(s / 60)}분 전`;
};

export default function Console() {
  const [stats, setStats] = useState(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStats(await api("GET", "/api/_ops/stats"));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  async function burst(id, n, fn) {
    setBusy(id);
    for (let i = 0; i < n; i++) await fn(i).catch(() => {});
    setBusy("");
    refresh();
  }

  async function setChaos(errorRate) {
    await api("POST", "/api/_ops/chaos", { errorRate }).catch(() => {});
    refresh();
  }

  const monitor = stats?.monitor ?? {};
  const lastRun = monitor.lastRun;
  const monitorAlive = lastRun && Date.now() - Date.parse(lastRun.at) < 45_000;
  const incidents = Object.values(monitor.incidents ?? {});
  const chaosRate = stats?.chaos.errorRate ?? 0;

  return (
    <div className="console">
      <div className="orb orb-a" aria-hidden />
      <div className="orb orb-b" aria-hidden />

      <nav className="island">
        <span className="brand">
          <span className="brand-dot" />
          Daybook <b>Ops</b>
        </span>
        <span className="sep" />
        <span className="env">production · todo-api</span>
        <span className={`live ${offline ? "down" : ""}`}>
          <span className="pulse" />
          {offline ? "API 연결 끊김" : "LIVE"}
        </span>
        <a className="nav-link" href="/" target="daybook-app">
          앱 열기
          <span className="nav-link-icon">↗</span>
        </a>
      </nav>

      {!stats ? (
        <div className="bento">
          <Card className="span-12 reveal">
            <div className="empty">{offline ? "API 서버(:4100)에 연결할 수 없습니다 — npm run dev" : "불러오는 중…"}</div>
          </Card>
        </div>
      ) : (
        <div className="bento">
          <Card className="span-8 reveal" style={{ "--d": "60ms" }}>
            <CardHead title="에러율 추이" meta="최근 10분 · 15초 간격" />
            <div className="kpis">
              {Object.entries(METRICS).map(([key, m]) => {
                const r = stats.rates[key];
                const tier = lastRun?.results?.[key]?.tier ?? null;
                return (
                  <div key={key} className="kpi">
                    <div className="kpi-top">
                      <span className="swatch" style={{ background: m.color }} />
                      {m.name}
                      <span className={`tier ${TIER[tier].cls}`}>{TIER[tier].text}</span>
                    </div>
                    <div className="kpi-num">{pct(r.rate)}</div>
                    <div className="kpi-sub">
                      최근 {stats.windowSec / 60}분 {stats.total}건 중 {r.count}건 · 티켓 기준 {pct(m.threshold)}
                    </div>
                  </div>
                );
              })}
            </div>
            <Chart series={stats.series} />
          </Card>

          <Card className="span-4 reveal" style={{ "--d": "120ms" }}>
            <CardHead title="모니터" meta={lastRun ? `마지막 판정 ${ago(lastRun.at)}` : "대기"} />
            <div className={`watch ${monitorAlive ? "alive" : ""}`}>
              <span className="watch-ring" />
              <div>
                <div className="watch-state">{monitorAlive ? "감시 중" : lastRun ? "응답 없음" : "시작 전"}</div>
                <div className="watch-sub">{monitorAlive ? "15초마다 로그를 판정합니다" : "npm run monitor 로 시작"}</div>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>3σ 이탈 시</dt>
                <dd>{lastRun?.destination ?? "—"}</dd>
              </div>
              <div>
                <dt>판정</dt>
                <dd>
                  <code>ops/detect.sh</code> · 모델 없음
                </dd>
              </div>
              <div>
                <dt>창 / 최소 표본</dt>
                <dd>{lastRun ? `${lastRun.windowSec}초 / 10건` : "—"}</dd>
              </div>
            </dl>
            <div className="sub-head">판정 기준 · ops/bands.yaml</div>
            <div className="bands">
              <div className="bands-row bands-head">
                <span />
                <span>1σ 기록</span>
                <span>2σ 진단</span>
                <span>3σ 티켓</span>
              </div>
              {[
                ["5xx", [0.02, 0.04, 0.06]],
                ["4xx", [0.0625, 0.125, 0.1875]],
              ].map(([label, steps]) => (
                <div key={label} className="bands-row">
                  <span className="mono">{label}</span>
                  {steps.map((v, i) => (
                    <span key={i} className={`mono band-${i + 1}`}>
                      {pct(v)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card className="span-5 reveal" style={{ "--d": "180ms" }}>
            <CardHead title="사건" meta={incidents.length ? `${incidents.length}건 진행 중` : "모두 정상"} />
            {incidents.length === 0 ? (
              <div className="calm">
                <span className="calm-dot" />
                열린 사건이 없습니다
              </div>
            ) : (
              <div className="incidents">
                {incidents.map((i) => (
                  <Incident key={i.metric} incident={i} />
                ))}
              </div>
            )}
            {(monitor.history ?? []).length > 0 && (
              <>
                <div className="sub-head">최근 해결</div>
                <ul className="history">
                  {monitor.history.slice(0, 3).map((h) => (
                    <li key={h.openedAt + h.metric}>
                      <span className="mono">{METRICS[h.metric]?.label}</span>
                      <TicketLink incident={h} />
                      <span className="muted">{ago(h.resolvedAt)} 회복</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className="span-7 reveal" style={{ "--d": "240ms" }}>
            <CardHead title="모니터 활동" meta="판정이 바뀔 때만 기록" />
            <ul className="feed">
              {(monitor.events ?? []).slice(0, 9).map((e, i) => (
                <li key={e.at + i} className={`ev ev-${e.kind}`}>
                  <span className="ev-dot" />
                  <span className="mono muted">{hms(e.at)}</span>
                  <span className="ev-text">{e.text.replace(/DRY-RUN \S+/, "초안")}</span>
                </li>
              ))}
              {!(monitor.events ?? []).length && <li className="empty">아직 기록이 없습니다</li>}
            </ul>
          </Card>

          <Card className="span-4 reveal" style={{ "--d": "300ms" }}>
            <CardHead title="장애 주입" meta="시연용 제어" />
            <div className="sub-head">서버 오류 (요청 중 500 비율)</div>
            <div className="seg">
              {[0, 0.1, 0.3, 0.6].map((r) => (
                <button key={r} className={chaosRate === r ? (r === 0 ? "on ok" : "on") : ""} onClick={() => setChaos(r)}>
                  {r === 0 ? "끔" : `${r * 100}%`}
                </button>
              ))}
            </div>
            <div className="sub-head">트래픽 발생</div>
            <div className="actions">
              <Action id="ok" busy={busy} label="정상 요청" sub="GET /api/todos × 30" onClick={() => burst("ok", 30, () => api("GET", "/api/todos"))} />
              <Action id="400" busy={busy} label="잘못된 입력" sub="POST 빈 제목 × 15 → 400" onClick={() => burst("400", 15, () => api("POST", "/api/todos", { title: "" }))} />
              <Action
                id="dup"
                busy={busy}
                label="같은 할 일 반복 추가"
                sub="POST 같은 제목 × 8 → 원래는 409"
                onClick={() => burst("dup", 8, () => api("POST", "/api/todos", { title: "우유 사기" }))}
              />
              <Action id="404" busy={busy} label="없는 리소스" sub="DELETE 없는 id × 15 → 404" onClick={() => burst("404", 15, (i) => api("DELETE", `/api/todos/ghost-${Date.now()}-${i}`))} />
            </div>
          </Card>

          <Card className="span-8 reveal" style={{ "--d": "360ms" }}>
            <CardHead title="에러 로그" meta="logs/access.jsonl · 최근 10분" />
            <div className="log">
              {stats.recentErrors.slice(0, 12).map((e, i) => (
                <div key={e.ts + i} className="log-row">
                  <span className="mono muted">{hms(e.ts)}</span>
                  <span className={`code c${String(e.status)[0]}`}>{e.status}</span>
                  <span className="mono path">
                    {e.method} {e.path}
                  </span>
                  <span className="msg">{e.error}</span>
                </div>
              ))}
              {stats.recentErrors.length === 0 && <div className="empty">에러가 없습니다</div>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ className = "", style, children }) {
  return (
    <section className={`shell ${className}`} style={style}>
      <div className="card">{children}</div>
    </section>
  );
}

function CardHead({ title, meta }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      <span className="muted">{meta}</span>
    </div>
  );
}

function TicketLink({ incident }) {
  if (incident.url?.startsWith("http")) {
    return (
      <a className="ticket" href={incident.url} target="_blank" rel="noreferrer">
        {incident.key} ↗
      </a>
    );
  }
  return <span className="ticket mono">{incident.key?.startsWith("DRY-RUN") ? "초안 (outbox)" : incident.key}</span>;
}

function Incident({ incident: i }) {
  const m = METRICS[i.metric];
  const triaging = i.status === "triaging";
  return (
    <article className={`incident ${triaging ? "triaging" : ""}`}>
      <div className="incident-top">
        <span className="sev">SEV · {m?.label}</span>
        <span className="muted">{ago(i.openedAt)} 감지 · 최고 {pct(i.peakRate ?? 0)}</span>
      </div>
      {triaging ? (
        <div className="thinking">
          <span className="spark" />
          클로드가 로그와 코드를 읽고 원인을 찾는 중…
        </div>
      ) : (
        <>
          <div className="incident-ticket">
            <TicketLink incident={i} />
            <span className="muted">{i.via === "claude" ? "클로드 · Linear MCP" : i.via === "dry-run" ? "클로드 · 드라이런" : "틀 티켓"}</span>
          </div>
          {i.rootCause && <p className="cause">{i.rootCause}</p>}
        </>
      )}
    </article>
  );
}

function Action({ id, busy, label, sub, onClick }) {
  return (
    <button className={`action ${busy === id ? "running" : ""}`} disabled={!!busy} onClick={onClick}>
      <span>
        <span className="action-label">{label}</span>
        <span className="action-sub mono">{sub}</span>
      </span>
      <span className="action-icon">{busy === id ? "…" : "→"}</span>
    </button>
  );
}

/** 15초 칸마다의 5xx·4xx 비율을 선으로, 요청 수를 바닥 막대로 그린다. 점선은 3σ 티켓 기준. */
function Chart({ series }) {
  if (!series?.length) return null;
  const W = 720;
  const H = 180;
  const n = series.length;
  const rates = series.map((b) => ({ e5: b.total ? b.e5 / b.total : 0, e4: b.total ? b.e4 / b.total : 0, total: b.total }));
  const peak = Math.max(0.25, ...rates.map((r) => Math.max(r.e5, r.e4)) ) * 1.1;
  const maxTotal = Math.max(1, ...rates.map((r) => r.total));
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - (v / peak) * H;
  const line = (k) => rates.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const area = (k) => `${line(k)} L${W},${H} L0,${H} Z`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H + 24}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="g5" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5d5d" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ff5d5d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="g4" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5b54a" stopOpacity="0.25" />
            <stop offset="1" stopColor="#f5b54a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {rates.map((r, i) => (
          <rect key={i} x={x(i) - 2} y={H + 24 - (r.total / maxTotal) * 18} width="4" height={(r.total / maxTotal) * 18} rx="1" className="vol" />
        ))}
        {Object.values(METRICS).map((m) => (
          <g key={m.label}>
            <line x1="0" x2={W} y1={y(m.threshold)} y2={y(m.threshold)} className={`thr thr-${m.label}`} />
            <text x={W - 4} y={y(m.threshold) - 5} textAnchor="end" className="thr-label">
              {m.label} 3σ {pct(m.threshold)}
            </text>
          </g>
        ))}
        <path d={area("e4")} fill="url(#g4)" />
        <path d={line("e4")} className="ln ln-4" />
        <path d={area("e5")} fill="url(#g5)" />
        <path d={line("e5")} className="ln ln-5" />
      </svg>
      <div className="axis mono">
        <span>{hms(series[0].t)}</span>
        <span>지금</span>
      </div>
    </div>
  );
}
