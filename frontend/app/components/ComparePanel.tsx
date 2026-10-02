"use client";

import { summarize } from "@/lib/client";
import { ALGORITHMS, type HammerEntry } from "@/lib/types";
import { PanelHead, Spinner, cx } from "./primitives";
import { Timeline } from "./Timeline";
import s from "./ui.module.css";

export interface CompareResult {
  algorithm: string;
  entries: HammerEntry[];
}

export function ComparePanel({
  results,
  running,
  onClose,
}: {
  results: CompareResult[];
  running: boolean;
  onClose: () => void;
}) {
  const pendingIdx = results.length;
  return (
    <section className={s.panel}>
      <PanelHead title="Algorithm comparison" subtitle="Same traffic and limit, run once per algorithm on fresh counters">
        {!running && (
          <button className={cx(s.btn, s.btnGhost, s.btnSmall)} onClick={onClose}>
            Close
          </button>
        )}
      </PanelHead>
      <div className={s.compareRows}>
        {ALGORITHMS.map((a, idx) => {
          const result = results.find((r) => r.algorithm === a.id);
          const sum = result ? summarize(result.entries) : null;
          return (
            <div key={a.id} className={s.compareRow}>
              <div className={s.compareName}>
                <strong>{a.name}</strong>
                {sum ? (
                  <span>
                    <b className={s.ok}>{sum.allowed}</b> allowed · <b className={s.bad}>{sum.denied}</b> denied
                    {sum.unavailable + sum.errors > 0 && (
                      <>
                        {" "}
                        · <b className={s.warn}>{sum.unavailable + sum.errors}</b> 5xx
                      </>
                    )}
                  </span>
                ) : (
                  <span>{idx === pendingIdx && running ? "running…" : "waiting"}</span>
                )}
              </div>
              {result ? (
                <Timeline entries={result.entries} compact />
              ) : (
                <div className={s.comparePending}>
                  {idx === pendingIdx && running ? (
                    <>
                      <Spinner /> sending traffic
                    </>
                  ) : (
                    "queued"
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className={s.hint}>
        Tip: add a delay so the run spans more than one window (e.g. 40 requests, 250 ms apart, with a 5 s
        window) to see boundary bursts and refills.
      </p>
    </section>
  );
}
