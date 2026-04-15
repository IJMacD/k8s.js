import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "./store";
import { createJob, updateCronJobStatus } from "./store";

// ---------------------------------------------------------------------------
// Minimal cron parser — supports *, */n, and single numeric values per field.
// Fields: minute hour day-of-month month day-of-week
// ---------------------------------------------------------------------------

function parseField(field: string, min: number, max: number): number[] {
    if (field === "*") {
        return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    }
    if (field.startsWith("*/")) {
        const step = parseInt(field.slice(2), 10);
        if (isNaN(step) || step <= 0) return [];
        return Array.from({ length: max - min + 1 }, (_, i) => i + min).filter(
            v => (v - min) % step === 0,
        );
    }
    const n = parseInt(field, 10);
    return !isNaN(n) && n >= min && n <= max ? [n] : [];
}

/** Returns the next Date after `after` that matches the 5-field cron schedule. */
function nextCronFire(schedule: string, after: Date = new Date()): Date {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`Invalid cron schedule: "${schedule}"`);
    const [minF, hourF, domF, monF, dowF] = parts;

    const minutes = parseField(minF, 0, 59);
    const hours = parseField(hourF, 0, 23);
    const doms = parseField(domF, 1, 31);
    const months = parseField(monF, 1, 12);
    const dows = parseField(dowF, 0, 6);

    // Advance to the start of the next minute
    const start = new Date(after);
    start.setSeconds(0);
    start.setMilliseconds(0);
    start.setMinutes(start.getMinutes() + 1);

    // Search up to 366 days ahead (minute by minute)
    for (let i = 0; i < 366 * 24 * 60; i++) {
        const d = new Date(start.getTime() + i * 60_000);
        if (
            months.includes(d.getMonth() + 1) &&
            doms.includes(d.getDate()) &&
            dows.includes(d.getDay()) &&
            hours.includes(d.getHours()) &&
            minutes.includes(d.getMinutes())
        ) {
            return d;
        }
    }
    throw new Error(`No valid fire time found for schedule: "${schedule}"`);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Simulates the Kubernetes CronJob controller.
 * For each CronJob, schedules a setTimeout to fire at the next cron tick,
 * creating a Job and rescheduling itself on each fire.
 */
export function useCronJobController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { CronJobs } = state;
    // uid → cancel function for the pending timeout
    const schedulersRef = useRef<Map<string, () => void>>(new Map());

    useEffect(() => {
        const knownUids = new Set(CronJobs.map(c => c.metadata.uid));

        // Cancel schedulers for removed CronJobs
        for (const [uid, cancel] of schedulersRef.current) {
            if (!knownUids.has(uid)) {
                cancel();
                schedulersRef.current.delete(uid);
            }
        }

        // Set up a scheduler for each new (unsuspended) CronJob
        for (const cj of CronJobs) {
            if (schedulersRef.current.has(cj.metadata.uid)) continue;
            if (cj.spec.suspend) continue;

            const { name, namespace } = cj.metadata;
            const { schedule, jobTemplate } = cj.spec;
            const jobSpec = jobTemplate.spec;

            function scheduleNext() {
                let next: Date;
                try {
                    next = nextCronFire(schedule);
                } catch {
                    return; // Invalid or unsatisfiable schedule — bail out
                }

                const delay = Math.max(0, next.getTime() - Date.now());
                const id = setTimeout(() => {
                    const jobName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                    dispatch(
                        createJob(
                            jobName,
                            {
                                image: jobSpec.template.spec.containers[0]?.image ?? "",
                                completions: jobSpec.completions,
                                parallelism: jobSpec.parallelism,
                                backoffLimit: jobSpec.backoffLimit,
                                ownerCronJob: name,
                            },
                            namespace,
                        ),
                    );
                    dispatch(
                        updateCronJobStatus(name, namespace, {
                            lastScheduleTime: new Date().toISOString(),
                        }),
                    );
                    scheduleNext();
                }, delay);

                // Store the latest cancel fn (previous timeout already fired)
                schedulersRef.current.set(cj.metadata.uid, () => clearTimeout(id));
            }

            scheduleNext();
        }
    }, [CronJobs, dispatch]);

    // Cancel all pending timers on unmount
    useEffect(() => {
        const map = schedulersRef.current;
        return () => map.forEach(cancel => cancel());
    }, []);
}
