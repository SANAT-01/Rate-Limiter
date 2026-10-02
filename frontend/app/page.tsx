"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, freshClientId, streamTraffic } from "@/lib/client";
import type { Scenario } from "@/lib/scenarios";
import {
  ALGORITHMS,
  DEFAULT_CONFIG,
  sameConfig,
  type ControlAction,
  type HammerEntry,
  type LimiterConfig,
  type LimiterInfo,
  type ServiceStatus,
  type TrafficSettings,
} from "@/lib/types";
import { ComparePanel, type CompareResult } from "./components/ComparePanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { Header } from "./components/Header";
import { InfraPanel } from "./components/InfraPanel";
import { LogsPanel } from "./components/LogsPanel";
import { Scenarios } from "./components/Scenarios";
import { Toasts, type Toast } from "./components/Toasts";
import { TrafficPanel } from "./components/TrafficPanel";
import s from "./components/ui.module.css";

const CONTROL_LABELS: Record<ControlAction, string> = {
  "limiter2-up": "Starting limiter2",
  "limiter2-down": "Stopping limiter2",
  "redis-start": "Starting Redis",
  "redis-stop": "Stopping Redis",
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function Dashboard() {
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [limiters, setLimiters] = useState<LimiterInfo[]>([]);

  const [draft, setDraft] = useState<LimiterConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<TrafficSettings>({
    client: "demo-user",
    clients: 1,
    requests: 30,
    concurrency: 1,
    delayMs: 0,
  });
  const [entries, setEntries] = useState<HammerEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [expectation, setExpectation] = useState<{ title: string; expect: string } | null>(null);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareResult[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const servicesRef = useRef<ServiceStatus[] | null>(null);
  const toastId = useRef(0);

  const live = limiters.find((l) => l.online && l.config)?.config;

  const toast = useCallback((kind: Toast["kind"], title: string, body?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const markDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };

  const refresh = useCallback(async () => {
    const [st, lim] = await Promise.allSettled([
      fetch("/api/status", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/limiters", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (st.status === "fulfilled" && !st.value.error) {
      setServices(st.value.services);
      servicesRef.current = st.value.services;
      setDockerError(null);
    } else {
      setDockerError(st.status === "fulfilled" ? st.value.error : errorMessage(st.reason));
    }
    if (lim.status === "fulfilled" && lim.value.limiters) {
      const infos: LimiterInfo[] = lim.value.limiters;
      setLimiters(infos);
      const cfg = infos.find((l) => l.online && l.config)?.config;
      if (cfg && !dirtyRef.current) {
        const { algorithm, limit, windowSeconds, redisEnabled, failMode } = cfg;
        setDraft({ algorithm, limit, windowSeconds, redisEnabled, failMode });
      }
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  // ------------------------------------ actions ------------------------------------
  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast("error", `${label} failed`, errorMessage(err));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const applyDraft = () =>
    withBusy("Applying policy", async () => {
      await api.applyConfig(draft);
      markDirty(false);
      const algo = ALGORITHMS.find((a) => a.id === draft.algorithm)?.name;
      toast("ok", "Policy applied", `${algo} · ${draft.limit}/${draft.windowSeconds}s · ${draft.redisEnabled ? "Redis" : "local memory"} · fail ${draft.failMode}`);
    });

  const resetCounters = () =>
    withBusy("Resetting counters", async () => {
      await api.reset();
      toast("ok", "Counters reset", "Every client starts with a full allowance.");
    });

  const control = (action: ControlAction) =>
    withBusy(CONTROL_LABELS[action], async () => {
      await api.control(action);
      toast("ok", CONTROL_LABELS[action].replace("Starting", "Started").replace("Stopping", "Stopped"));
    });

  async function ensureService(name: "limiter2" | "redis", want: "up" | "down") {
    const running = servicesRef.current?.find((x) => x.service === name)?.state === "running";
    if (want === "up" && !running) await api.control(name === "redis" ? "redis-start" : "limiter2-up");
    if (want === "down" && running) await api.control(name === "redis" ? "redis-stop" : "limiter2-down");
  }

  async function runTraffic(settings: TrafficSettings): Promise<HammerEntry[] | null> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setEntries([]);
    setDurationMs(null);
    setRunning(true);

    const collected: HammerEntry[] = [];
    let pending: HammerEntry[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length) setEntries((prev) => prev.concat(batch));
    };

    try {
      const summary = await streamTraffic(settings, controller.signal, (e) => {
        collected.push(e);
        pending.push(e);
        if (!frame) frame = requestAnimationFrame(flush);
      });
      if (frame) cancelAnimationFrame(frame);
      flush();
      setDurationMs(summary.durationMs);
      return collected;
    } catch (err) {
      if (frame) cancelAnimationFrame(frame);
      flush();
      if (controller.signal.aborted) toast("info", "Traffic stopped", `${collected.length} requests sent.`);
      else toast("error", "Traffic run failed", errorMessage(err));
      return null;
    } finally {
      setRunning(false);
      refresh();
    }
  }

  const sendTraffic = () => {
    setExpectation(null);
    runTraffic(traffic);
  };

  async function runScenario(scenario: Scenario) {
    setActiveScenario(scenario.id);
    setExpectation({ title: scenario.title, expect: scenario.expect });
    setComparison(null);
    try {
      setBusy(`Preparing “${scenario.title}”`);
      if (scenario.limiter2) await ensureService("limiter2", scenario.limiter2);
      if (scenario.redis === "up") await ensureService("redis", "up");
      await api.applyConfig(scenario.config);
      setDraft(scenario.config);
      markDirty(false);
      await api.reset();
      if (scenario.redis === "down") await ensureService("redis", "down");
      await refresh();
      setBusy(null);

      const settings = { ...scenario.traffic, client: freshClientId(scenario.id) };
      setTraffic(settings);
      await runTraffic(settings);
    } catch (err) {
      toast("error", "Scenario failed", errorMessage(err));
    } finally {
      setBusy(null);
      setActiveScenario(null);
      refresh();
    }
  }

  async function compareAlgorithms() {
    setExpectation(null);
    setComparing(true);
    const results: CompareResult[] = [];
    setComparison(results);
    try {
      for (const algo of ALGORITHMS) {
        await api.applyConfig({ ...draft, algorithm: algo.id });
        await api.reset();
        const run = await runTraffic({ ...traffic, client: freshClientId(`cmp-${algo.id}`) });
        if (!run) break;
        results.push({ algorithm: algo.id, entries: run });
        setComparison([...results]);
      }
      await api.applyConfig(draft);
      markDirty(false);
    } catch (err) {
      toast("error", "Comparison failed", errorMessage(err));
    } finally {
      setComparing(false);
      refresh();
    }
  }

  const locked = busy !== null || running || comparing || activeScenario !== null;

  return (
    <main className={s.shell}>
      <Header services={services} dockerError={dockerError} busy={busy} />

      <Scenarios activeId={activeScenario} disabled={locked} onRun={runScenario} />

      <div className={s.grid}>
        <div className={s.stack}>
          <ConfigPanel
            draft={draft}
            live={live}
            dirty={dirty}
            limiters={limiters}
            disabled={locked}
            onChange={(patch) => {
              const next = { ...draft, ...patch };
              setDraft(next);
              markDirty(!sameConfig(next, live));
            }}
            onApply={applyDraft}
            onRevert={() => {
              if (live) setDraft(live);
              markDirty(false);
            }}
            onReset={resetCounters}
          />
          <InfraPanel services={services} disabled={locked} onControl={control} />
        </div>

        <div className={s.stack}>
          <TrafficPanel
            settings={traffic}
            onChange={(patch) => setTraffic((t) => ({ ...t, ...patch }))}
            onNewClient={() => setTraffic((t) => ({ ...t, client: freshClientId() }))}
            entries={entries}
            running={running}
            disabled={locked}
            durationMs={durationMs}
            expectation={expectation}
            onRun={sendTraffic}
            onStop={() => abortRef.current?.abort()}
            onCompare={compareAlgorithms}
          />
          {comparison && (
            <ComparePanel results={comparison} running={comparing} onClose={() => setComparison(null)} />
          )}
          <LogsPanel />
        </div>
      </div>

      <Toasts toasts={toasts} />
    </main>
  );
}
