"use client";

import { useMemo, useState } from "react";
import type { HammerEntry } from "@/lib/types";
import { cx } from "./primitives";
import s from "./ui.module.css";

function tone(e: HammerEntry) {
  if (e.status === 200) return s.cellOk;
  if (e.status === 429) return s.cellBad;
  if (e.status !== null) return s.cellWarn;
  return undefined;
}

export function describeEntry(e: HammerEntry) {
  const parts = [
    `#${e.i + 1}`,
    `+${e.t} ms`,
    e.client,
    e.status === null ? `error: ${e.error}` : String(e.status),
  ];
  if (e.limiter) parts.push(e.limiter);
  if (e.remaining !== null) parts.push(`remaining ${e.remaining}`);
  if (e.retryAfter !== null) parts.push(`retry in ${e.retryAfter}s`);
  if (e.backend) parts.push(e.backend);
  parts.push(`${e.latencyMs} ms`);
  return parts.join(" · ");
}

export function Timeline({ entries, compact = false }: { entries: HammerEntry[]; compact?: boolean }) {
  const [hover, setHover] = useState<HammerEntry | null>(null);
  const sorted = useMemo(() => [...entries].sort((a, b) => a.i - b.i), [entries]);

  return (
    <div className={compact ? undefined : s.timelineWrap}>
      <div className={cx(s.timeline, compact && s.timelineCompact)} onMouseLeave={() => setHover(null)}>
        {sorted.map((e) => (
          <span
            key={e.i}
            className={cx(s.cell, tone(e), e.limiter === "limiter2" && s.cellRound)}
            onMouseEnter={() => setHover(e)}
            title={compact ? describeEntry(e) : undefined}
          />
        ))}
      </div>
      {!compact && (
        <div className={s.timelineFoot}>
          <div className={s.legend}>
            <span>
              <i className={s.swatch} style={{ background: "var(--ok)" }} /> allowed
            </span>
            <span>
              <i className={s.swatch} style={{ background: "var(--bad)" }} /> 429
            </span>
            <span>
              <i className={s.swatch} style={{ background: "var(--warn)" }} /> 5xx
            </span>
            <span>
              <i className={s.shapeSquare} /> limiter1
            </span>
            <span>
              <i className={s.shapeCircle} /> limiter2
            </span>
          </div>
          <span className={s.detail}>{hover ? describeEntry(hover) : "Hover a request for details"}</span>
        </div>
      )}
    </div>
  );
}
