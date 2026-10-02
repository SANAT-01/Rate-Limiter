"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHead, Segmented, cx } from "./primitives";
import s from "./ui.module.css";

const SERVICES = ["limiter1", "limiter2", "lb", "api", "redis"] as const;
type Service = (typeof SERVICES)[number];

// Structured JSON events (startup, config changes, resets) → one readable line.
function prettify(line: string) {
  if (!line.startsWith("{")) return line;
  try {
    const { ts, level, service, msg, ...rest } = JSON.parse(line);
    void ts;
    void service;
    const extra = Object.entries(rest)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return `· ${level}: ${msg}${extra ? `  ${extra}` : ""}`;
  } catch {
    return line;
  }
}

function lineClass(line: string) {
  if (line.startsWith("ALLOW")) return s.logAllow;
  if (line.startsWith("DENY")) return s.logDeny;
  if (line.includes("REDIS DOWN")) return s.logWarn;
  if (line.startsWith("{")) return s.logEvent;
  return undefined;
}

export function LogsPanel() {
  const [service, setService] = useState<Service>("limiter1");
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (svc: Service) => {
    try {
      const res = await fetch(`/api/logs?service=${svc}&lines=120`, { cache: "no-store" });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setLines([]);
      } else {
        setError(null);
        setLines((data.logs as string).split("\n").filter(Boolean));
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => load(service), 0);
    const id = follow ? setInterval(() => load(service), 2500) : undefined;
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [service, follow, load]);

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, follow]);

  return (
    <section className={s.panel}>
      <PanelHead title="Container logs" subtitle="Every ALLOW / DENY decision, straight from the containers" />
      <div className={s.logControls}>
        <Segmented ariaLabel="Service" value={service} onChange={setService} options={SERVICES.map((v) => ({ value: v, label: v }))} />
        <label className={s.checkbox}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Live follow
        </label>
      </div>
      <div className={s.logBox} ref={boxRef}>
        {error ? (
          <div className={cx(s.logLine, s.logWarn)}>{error}</div>
        ) : lines.length === 0 ? (
          <div className={s.logLine}>No output yet.</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={cx(s.logLine, lineClass(line))}>
              {prettify(line)}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
