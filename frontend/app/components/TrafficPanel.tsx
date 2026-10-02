"use client";

import { useMemo } from "react";
import { summarize } from "@/lib/client";
import type { HammerEntry, TrafficSettings } from "@/lib/types";
import { NumberField, PanelHead, Spinner, cx } from "./primitives";
import { Timeline } from "./Timeline";
import s from "./ui.module.css";

function describeTraffic(t: TrafficSettings) {
  if (![t.requests, t.concurrency, t.clients, t.delayMs].every(Number.isFinite)) return "";
  const pace =
    t.concurrency > 1 ? `in parallel batches of ${t.concurrency}` : "one at a time";
  const gap = t.delayMs > 0 ? `, ${t.delayMs} ms apart` : "";
  const who = t.clients > 1 ? `spread over ${t.clients} clients` : "as a single client";
  const batches = Math.ceil(t.requests / Math.max(1, t.concurrency));
  const est = t.delayMs > 0 ? ` (≈ ${((batches - 1) * t.delayMs / 1000).toFixed(1)} s)` : "";
  return `${t.requests} requests ${pace}${gap}, ${who}${est}.`;
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={cx(s.tile, tone)}>
      <div className={s.tileLabel}>{label}</div>
      <div className={s.tileValue}>{value}</div>
    </div>
  );
}

function ReplicaBars({ byLimiter }: { byLimiter: ReturnType<typeof summarize>["byLimiter"] }) {
  const names = Object.keys(byLimiter).sort();
  if (names.length === 0) return null;
  const max = Math.max(...names.map((n) => byLimiter[n].allowed + byLimiter[n].denied + byLimiter[n].other));
  return (
    <div className={s.bars}>
      {names.map((n) => {
        const b = byLimiter[n];
        const total = b.allowed + b.denied + b.other;
        const pct = (v: number) => `${(v / total) * 100}%`;
        return (
          <div key={n} className={s.barRow}>
            <span className={s.barName}>
              <i className={n === "limiter2" ? s.shapeCircle : s.shapeSquare} />
              {n}
            </span>
            <div className={s.barTrack}>
              <div className={s.barFill} style={{ width: `${(total / max) * 100}%` }}>
                <span style={{ width: pct(b.allowed), background: "var(--ok)" }} />
                <span style={{ width: pct(b.denied), background: "var(--bad)" }} />
                <span style={{ width: pct(b.other), background: "var(--warn)" }} />
              </div>
            </div>
            <span className={s.barCounts}>
              <b className={s.ok}>{b.allowed}</b> allowed · <b className={s.bad}>{b.denied}</b> denied
              {b.other > 0 && (
                <>
                  {" "}
                  · <b className={s.warn}>{b.other}</b> 5xx
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TrafficPanel({
  settings,
  onChange,
  onNewClient,
  entries,
  running,
  disabled,
  durationMs,
  expectation,
  onRun,
  onStop,
  onCompare,
}: {
  settings: TrafficSettings;
  onChange: (patch: Partial<TrafficSettings>) => void;
  onNewClient: () => void;
  entries: HammerEntry[];
  running: boolean;
  disabled: boolean;
  durationMs: number | null;
  expectation: { title: string; expect: string } | null;
  onRun: () => void;
  onStop: () => void;
  onCompare: () => void;
}) {
  const sum = useMemo(() => summarize(entries), [entries]);
  const valid =
    settings.client.trim() !== "" &&
    settings.requests >= 1 &&
    settings.concurrency >= 1 &&
    settings.clients >= 1 &&
    settings.delayMs >= 0;

  return (
    <section className={s.panel}>
      <PanelHead title="Traffic generator" subtitle="Requests travel nginx → limiter → api, exactly like real clients">
        {running && (
          <span className={s.busy}>
            <Spinner /> {entries.length}/{settings.requests}
          </span>
        )}
        {!running && durationMs !== null && entries.length > 0 && (
          <span className={s.muted} style={{ fontSize: 12.5 }}>
            finished in {(durationMs / 1000).toFixed(1)} s
          </span>
        )}
      </PanelHead>

      <div className={s.trafficForm}>
        <label className={s.field}>
          <span className={s.fieldLabel}>Client ID (X-Client header)</span>
          <span className={s.inputGroup}>
            <input
              className={s.input}
              value={settings.client}
              maxLength={64}
              onChange={(e) => onChange({ client: e.target.value })}
            />
            <button type="button" className={cx(s.btn, s.btnGhost, s.btnSmall)} onClick={onNewClient} title="Fresh client with empty counters">
              New
            </button>
          </span>
        </label>
        <NumberField label="Requests" value={settings.requests} min={1} max={1000} onChange={(n) => onChange({ requests: n })} />
        <NumberField label="Parallel" value={settings.concurrency} min={1} max={50} onChange={(n) => onChange({ concurrency: n })} />
        <NumberField label="Delay" value={settings.delayMs} min={0} max={5000} step={50} suffix="ms" onChange={(n) => onChange({ delayMs: n })} />
        <NumberField label="Clients" value={settings.clients} min={1} max={50} onChange={(n) => onChange({ clients: n })} />
      </div>
      <p className={s.hint}>{describeTraffic(settings)}</p>

      <div className={s.actions}>
        {running ? (
          <button className={cx(s.btn, s.btnDanger)} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className={cx(s.btn, s.btnPrimary)} disabled={disabled || !valid} onClick={onRun}>
            Send traffic
          </button>
        )}
        <button
          className={cx(s.btn, s.btnGhost)}
          disabled={disabled || running || !valid}
          onClick={onCompare}
          title="Run this exact traffic once per algorithm"
        >
          Compare all algorithms
        </button>
      </div>

      {expectation && (
        <div className={s.expectBanner}>
          <strong>{expectation.title}.</strong> Expect: {expectation.expect}
        </div>
      )}

      {entries.length === 0 && !running ? (
        <div className={s.empty}>No traffic yet. Run a scenario above, or set a pattern and send traffic.</div>
      ) : (
        <>
          <div className={s.tiles}>
            <Tile label="Sent" value={sum.sent} />
            <Tile label="Allowed" value={sum.allowed} tone={s.tileOk} />
            <Tile label="Denied 429" value={sum.denied} tone={s.tileBad} />
            <Tile label="Unavailable 5xx" value={sum.unavailable + sum.errors} tone={s.tileWarn} />
            <Tile label="Avg latency" value={`${sum.avgLatency}ms`} />
          </div>
          <ReplicaBars byLimiter={sum.byLimiter} />
          <Timeline entries={entries} />
        </>
      )}
    </section>
  );
}
