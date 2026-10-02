import type { ControlAction, ServiceStatus } from "@/lib/types";
import { PanelHead, Switch } from "./primitives";
import s from "./ui.module.css";

export function InfraPanel({
  services,
  disabled,
  onControl,
}: {
  services: ServiceStatus[] | null;
  disabled: boolean;
  onControl: (action: ControlAction) => void;
}) {
  const state = (name: string) => services?.find((x) => x.service === name)?.state;
  const limiter2 = state("limiter2");
  const redis = state("redis");

  return (
    <section className={s.panel}>
      <PanelHead title="Infrastructure" subtitle="Real containers, started and stopped through Docker" />

      <div className={s.switchRow}>
        <div className={s.switchText}>
          <strong>Second limiter replica</strong>
          <span>limiter2, behind the same nginx load balancer</span>
        </div>
        <Switch
          label="limiter2 running"
          on={limiter2 === "running"}
          disabled={disabled || !limiter2 || limiter2 === "missing"}
          onToggle={() => onControl(limiter2 === "running" ? "limiter2-down" : "limiter2-up")}
        />
      </div>

      <div className={s.switchRow}>
        <div className={s.switchText}>
          <strong>Redis server</strong>
          <span>Turn off to simulate a counter-store outage</span>
        </div>
        <Switch
          label="redis running"
          on={redis === "running"}
          disabled={disabled || !redis || redis === "missing"}
          onToggle={() => onControl(redis === "running" ? "redis-stop" : "redis-start")}
        />
      </div>

      <p className={s.hint}>
        This switches the Redis <em>container</em>. Whether the limiters count in it is the{" "}
        <strong>Counter store</strong> setting.
      </p>
    </section>
  );
}
