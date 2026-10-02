import { ALGORITHMS, sameConfig, type LimiterConfig, type LimiterInfo } from "@/lib/types";
import { Label, NumberField, PanelHead, Segmented, cx } from "./primitives";
import s from "./ui.module.css";

function rateText(c: LimiterConfig) {
  if (!(c.limit >= 1 && c.windowSeconds >= 1)) return null;
  if (c.algorithm === "token-bucket") {
    const every = c.windowSeconds / c.limit;
    return `Bursts up to ${c.limit}, then refills one token every ${every < 10 ? every.toFixed(2).replace(/\.?0+$/, "") : Math.round(every)} s.`;
  }
  return `${c.limit} requests per ${c.windowSeconds} s, per client.`;
}

function shortName(id: string) {
  return ALGORITHMS.find((a) => a.id === id)?.name.toLowerCase() ?? id;
}

export function ConfigPanel({
  draft,
  live,
  dirty,
  limiters,
  disabled,
  onChange,
  onApply,
  onRevert,
  onReset,
}: {
  draft: LimiterConfig;
  live?: LimiterConfig;
  dirty: boolean;
  limiters: LimiterInfo[];
  disabled: boolean;
  onChange: (patch: Partial<LimiterConfig>) => void;
  onApply: () => void;
  onRevert: () => void;
  onReset: () => void;
}) {
  const selected = ALGORITHMS.find((a) => a.id === draft.algorithm) ?? ALGORITHMS[0];
  const invalid = !(draft.limit >= 1 && draft.limit <= 10000 && draft.windowSeconds >= 1 && draft.windowSeconds <= 3600);

  return (
    <section className={s.panel}>
      <PanelHead title="Limiter policy" subtitle="Applied live to every running replica" />

      <Label>Algorithm</Label>
      <div className={s.algoGrid}>
        {ALGORITHMS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={cx(s.algo, draft.algorithm === a.id && s.algoActive)}
            onClick={() => onChange({ algorithm: a.id })}
            aria-pressed={draft.algorithm === a.id}
          >
            <span className={s.algoName}>{a.name}</span>
            <span className={s.algoSummary}>{a.summary}</span>
          </button>
        ))}
      </div>
      <p className={s.hint}>{selected.tradeoff}</p>

      <Label>Limit</Label>
      <div className={s.fieldRow}>
        <NumberField label="Requests" value={draft.limit} min={1} max={10000} onChange={(n) => onChange({ limit: n })} />
        <NumberField
          label="Window"
          value={draft.windowSeconds}
          min={1}
          max={3600}
          suffix="sec"
          onChange={(n) => onChange({ windowSeconds: n })}
        />
      </div>
      <p className={cx(s.hint, invalid && s.hintError)}>
        {invalid ? "Limit must be 1–10000 and window 1–3600 s." : rateText(draft)}
      </p>

      <Label>Counter store</Label>
      <Segmented
        ariaLabel="Counter store"
        value={draft.redisEnabled}
        onChange={(v) => onChange({ redisEnabled: v })}
        options={[
          { value: false, label: "Local memory" },
          { value: true, label: "Redis (shared)" },
        ]}
      />
      <p className={s.hint}>
        {draft.redisEnabled
          ? "Every replica increments one atomic counter in Redis, so the limit holds globally."
          : "Each replica counts in its own memory. Run two and clients get double the limit."}
      </p>

      <Label>If Redis is unreachable</Label>
      <Segmented
        ariaLabel="Fail mode"
        value={draft.failMode}
        onChange={(v) => onChange({ failMode: v })}
        options={[
          { value: "open", label: "Fail open" },
          { value: "closed", label: "Fail closed" },
        ]}
      />
      <p className={s.hint}>
        {draft.failMode === "open"
          ? "Let requests through uncounted. The API stays up, unprotected."
          : "Reject with 503. The API stays protected, but goes down."}
      </p>

      <div className={s.actions}>
        <button className={cx(s.btn, s.btnPrimary)} disabled={!dirty || invalid || disabled} onClick={onApply}>
          Apply to replicas
        </button>
        {dirty && (
          <button className={cx(s.btn, s.btnGhost)} disabled={disabled || !live} onClick={onRevert}>
            Revert
          </button>
        )}
        <span className={s.spacer} />
        <button className={cx(s.btn, s.btnGhost)} disabled={disabled} onClick={onReset} title="Clear all counters and stats">
          Reset counters
        </button>
      </div>

      <div className={s.divider} />
      <Label>Replicas</Label>
      <ul className={s.replicas}>
        {limiters.map((l) => (
          <li key={l.name} className={cx(s.replica, l.online && s.replicaOnline)}>
            <div className={s.replicaTop}>
              <span className={s.dot} />
              <span className={s.replicaName}>{l.name}</span>
              {l.online && l.config ? (
                <>
                  <span className={s.chip}>
                    {shortName(l.config.algorithm)} · {l.config.limit}/{l.config.windowSeconds}s ·{" "}
                    {l.config.redisEnabled ? "redis" : "local"}
                  </span>
                  {live && !sameConfig(l.config, live) && <span className={s.warnChip}>out of sync</span>}
                </>
              ) : (
                <span className={s.muted}>offline</span>
              )}
            </div>
            {l.online && l.stats && (
              <div className={s.replicaStats}>
                <span>
                  allowed <b className={s.ok}>{l.stats.allowed}</b>
                </span>
                <span>
                  denied <b className={s.bad}>{l.stats.denied}</b>
                </span>
                {l.stats.failedOpen + l.stats.failedClosed > 0 && (
                  <span>
                    redis-down <b className={s.warn}>{l.stats.failedOpen + l.stats.failedClosed}</b>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
