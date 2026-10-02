import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import { Spinner, cx } from "./primitives";
import s from "./ui.module.css";

export function Scenarios({
  activeId,
  disabled,
  onRun,
}: {
  activeId: string | null;
  disabled: boolean;
  onRun: (scenario: Scenario) => void;
}) {
  return (
    <section>
      <div className={s.sectionHead}>
        <h2>Guided lab</h2>
        <p>Each scenario sets up replicas, Redis and policy, resets counters, then sends traffic.</p>
      </div>
      <div className={s.scenarios}>
        {SCENARIOS.map((sc, idx) => (
          <article key={sc.id} className={cx(s.scenario, activeId === sc.id && s.scenarioActive)}>
            <div className={s.scenarioTop}>
              <span className={s.step}>{idx + 1}</span>
              <h3>{sc.title}</h3>
            </div>
            <p>{sc.description}</p>
            <p className={s.expect}>{sc.expect}</p>
            <button
              className={cx(s.btn, s.btnSmall, activeId === sc.id ? s.btnPrimary : s.btnGhost)}
              disabled={disabled}
              onClick={() => onRun(sc)}
            >
              {activeId === sc.id ? (
                <>
                  <Spinner /> Running
                </>
              ) : (
                "Run scenario"
              )}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
