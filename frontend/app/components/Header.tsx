import type { ServiceStatus } from "@/lib/types";
import { Spinner, cx } from "./primitives";
import s from "./ui.module.css";

function pillClass(svc: ServiceStatus) {
  if (svc.state !== "running") return s.pillDown;
  if (svc.health === "starting") return s.pillStarting;
  if (svc.health === "unhealthy") return s.pillDown;
  return s.pillUp;
}

export function Header({
  services,
  dockerError,
  busy,
}: {
  services: ServiceStatus[] | null;
  dockerError: string | null;
  busy: string | null;
}) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <div className={s.logo} aria-hidden>
          <div className={s.logoBars}>
            <span style={{ height: "45%" }} />
            <span style={{ height: "100%" }} />
            <span style={{ height: "70%" }} />
          </div>
        </div>
        <div>
          <h1>Rate Limiter Lab</h1>
          <p>Replicas, shared counters and failure modes, live.</p>
        </div>
      </div>
      <div className={s.headerRight}>
        {busy && (
          <span className={s.busy}>
            <Spinner /> {busy}
          </span>
        )}
        <div className={s.statusRow}>
          {dockerError ? (
            <span className={cx(s.pill, s.pillDown)} title={dockerError}>
              <span className={s.dot} /> docker unreachable
            </span>
          ) : (
            services?.map((svc) => (
              <span
                key={svc.service}
                className={cx(s.pill, pillClass(svc))}
                title={`${svc.state}${svc.health ? ` · ${svc.health}` : ""}`}
              >
                <span className={s.dot} />
                {svc.service}
              </span>
            ))
          )}
        </div>
      </div>
    </header>
  );
}
