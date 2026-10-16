/** Korean formatting helpers for times and durations. */

/** "방금 전" / "23분 전" / "3시간 전" / "어제" / "3일 전" / "9월 2일" */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diffMs = now - then;
  if (diffMs < 0) return "방금 전";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;

  const date = new Date(then);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** "9월 20일 17:42" — the absolute stamp shown next to the relative one. */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${hh}:${mm}`;
}

/**
 * "4.6초" / "1분 12초". Sub-minute runs keep a decimal because the whole
 * point of the demo is that a hundred classifications take seconds.
 */
export function duration(ms: number): string {
  if (ms <= 0) return "0.0초";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}분 ${rest}초`;
}

/** "12.4건/초" — the figure that matters once a run is hundreds of emails. */
export function throughput(count: number, ms: number): string {
  if (ms <= 0 || count <= 0) return "—";
  return `${(count / (ms / 1000)).toFixed(1)}건/초`;
}
