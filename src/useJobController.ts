import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "./store";
import { createPod, updateJobStatus } from "./store";

const RECONCILE_DELAY_MS = 1_000;

/**
 * Simulates the Kubernetes Job controller.
 * Watches Jobs and Pods:
 *  - Creates pods (up to parallelism) until `completions` are reached.
 *  - Marks the Job Complete when succeeded >= completions.
 *  - Marks the Job Failed when failed > backoffLimit.
 */
export function useJobController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Jobs, Pods } = state;
    // Track last-dispatched counts per job to avoid redundant dispatches
    const statusRef = useRef<Map<string, { succeeded: number; failed: number; active: number }>>(
        new Map(),
    );

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        for (const job of Jobs) {
            const { name, namespace } = job.metadata;
            const key = `${namespace}/${name}`;

            const isComplete = job.status.conditions.some(
                c => c.type === "Complete" && c.status === "True",
            );
            const isFailed = job.status.conditions.some(
                c => c.type === "Failed" && c.status === "True",
            );
            if (isComplete || isFailed) continue;

            const jobPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.annotations?.["ownerJob"] === name,
            );

            const succeeded = jobPods.filter(p => p.status.phase === "Succeeded").length;
            const failed = jobPods.filter(p => p.status.phase === "Failed").length;
            const active = jobPods.filter(
                p => p.status.phase === "Pending" || p.status.phase === "Running",
            ).length;

            const { completions, parallelism, backoffLimit } = job.spec;
            const now = () => new Date().toISOString();

            // Dispatch status update only when counts change
            const prev = statusRef.current.get(key);
            const changed =
                !prev ||
                prev.succeeded !== succeeded ||
                prev.failed !== failed ||
                prev.active !== active;

            if (changed) {
                statusRef.current.set(key, { succeeded, failed, active });

                if (succeeded >= completions) {
                    const ts = now();
                    dispatch(
                        updateJobStatus(name, namespace, {
                            active: 0,
                            succeeded,
                            failed,
                            completionTime: ts,
                            conditions: [
                                { type: "Complete", status: "True", lastTransitionTime: ts },
                            ],
                        }),
                    );
                    continue;
                }

                if (failed > backoffLimit) {
                    const ts = now();
                    dispatch(
                        updateJobStatus(name, namespace, {
                            active,
                            succeeded,
                            failed,
                            conditions: [
                                {
                                    type: "Failed",
                                    status: "True",
                                    lastTransitionTime: ts,
                                    reason: "BackoffLimitExceeded",
                                },
                            ],
                        }),
                    );
                    continue;
                }

                dispatch(updateJobStatus(name, namespace, { active, succeeded, failed }));
            }

            // Create pods to fill up parallelism until completions are met
            const needed = Math.min(
                parallelism - active,
                completions - succeeded - active,
            );
            if (needed > 0) {
                const containers = job.spec.template.spec.containers;
                for (let i = 0; i < needed; i++) {
                    timers.push(
                        setTimeout(() => {
                            const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                            dispatch(
                                createPod(
                                    podName,
                                    {
                                        image: containers[0]?.image ?? "",
                                        containerName: containers[0]?.name,
                                        labels: { "job-name": name },
                                        restartPolicy: "Never",
                                        ownerJob: name,
                                    },
                                    namespace,
                                ),
                            );
                        }, RECONCILE_DELAY_MS * (i + 1)),
                    );
                }
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [Jobs, Pods, dispatch]);
}
