"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wall-clock milliseconds since a run started, ticking while `running`.
 * Freezes on the final value when the run stops, so the number on screen
 * during the run and the number after it are the same measurement.
 */
export function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      return;
    }

    startedAt.current = performance.now();
    setElapsed(0);

    const id = window.setInterval(() => {
      if (startedAt.current !== null) {
        setElapsed(performance.now() - startedAt.current);
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [running]);

  return elapsed;
}
