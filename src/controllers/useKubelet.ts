import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { updatePodStatus } from "../store/store";

/**
 * Simulates the Kubernetes kubelet.
 * Watches Pods and drives each one through its lifecycle:
 *
 *   Pending (no conditions)
 *     → +1.0s  PodScheduled=True
 *     → +2.0s  Initialized=True
 *     → +3.5s  ContainersReady=True, Ready=True
 *              phase=Running, startTime set, podIP assigned
 */
export function useKubelet(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    // Track pods we've already scheduled transitions for (by uid)
    const scheduledRef = useRef<Set<string>>(new Set());
    // Accumulate all timers so they can be cleared on unmount only
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const { Pods, Nodes } = state;

    useEffect(() => {
        for (const pod of Pods) {
            const uid = pod.metadata.uid;
            // Only drive Pending pods that have been bound to a node
            if (pod.status.phase !== "Pending") continue;
            if (!pod.spec.nodeName) continue;

            // Determine how far through the lifecycle this pod has already progressed,
            // so timers for already-completed transitions are skipped.
            // This makes the kubelet idempotent across re-renders and page restores —
            // no external scheduledRef tracking needed.
            const conditions = pod.status.conditions ?? [];
            const hasScheduled    = conditions.some(c => c.type === "PodScheduled"    && c.status === "True");
            const hasInitialized  = conditions.some(c => c.type === "Initialized"     && c.status === "True");
            const hasReady        = conditions.some(c => c.type === "ContainersReady" && c.status === "True");

            // Already fully transitioned — nothing to do (phase update from a prior run
            // may just not have persisted yet; skip to avoid double-scheduling).
            if (hasReady) continue;

            // Guard against scheduling the same pod's transitions more than once per mount.
            // This still uses scheduledRef, but it is now a secondary guard, not the
            // primary source of truth. The conditions above are the real gate.
            if (scheduledRef.current.has(uid)) continue;
            scheduledRef.current.add(uid);

            const { name, namespace } = pod.metadata;

            const now = () => new Date().toISOString();

            // t+1.0s: PodScheduled (skip if already set)
            if (!hasScheduled) {
                timersRef.current.push(setTimeout(() => {
                    dispatch(updatePodStatus(name, namespace, {
                        conditions: [
                            { type: "PodScheduled", status: "True", lastTransitionTime: now() },
                        ],
                    }));
                }, 1_000));
            }

            // t+2.0s: Initialized (skip if already set)
            if (!hasInitialized) {
                timersRef.current.push(setTimeout(() => {
                    dispatch(updatePodStatus(name, namespace, {
                        conditions: [
                            ...(hasScheduled
                                ? conditions.filter(c => c.type === "PodScheduled")
                                : [{ type: "PodScheduled", status: "True" as const, lastTransitionTime: now() }]),
                            { type: "Initialized", status: "True", lastTransitionTime: now() },
                        ],
                    }));
                }, hasScheduled ? 1_000 : 2_000));
            }

            // t+3.5s (or sooner if earlier stages were already done): Running + Ready
            const node = Nodes.find(n => n.metadata.name === pod.spec.nodeName);
            const isBatch = pod.spec.restartPolicy === "OnFailure" || pod.spec.restartPolicy === "Never";
            const runningDelay = hasInitialized ? 1_500 : hasScheduled ? 2_500 : 3_500;
            timersRef.current.push(setTimeout(() => {
                const startTime = now();
                const podIP = node?.spec.podCIDR
                    ? podIPFromCIDR(node.spec.podCIDR)
                    : `10.${rand(0, 255)}.${rand(0, 255)}.${rand(2, 254)}`;
                const hostIP = node?.status.addresses.find(a => a.type === "InternalIP")?.address;
                dispatch(updatePodStatus(name, namespace, {
                    phase: "Running",
                    startTime,
                    podIP,
                    ...(hostIP && { hostIP }),
                    conditions: [
                        { type: "PodScheduled",    status: "True", lastTransitionTime: startTime },
                        { type: "Initialized",     status: "True", lastTransitionTime: startTime },
                        { type: "ContainersReady", status: "True", lastTransitionTime: startTime },
                        { type: "Ready",           status: "True", lastTransitionTime: startTime },
                    ],
                }));
                // Batch pods run to completion ~2s after reaching Running
                if (isBatch) {
                    timersRef.current.push(setTimeout(() => {
                        const completionTime = now();
                        dispatch(updatePodStatus(name, namespace, {
                            phase: "Succeeded",
                            conditions: [
                                { type: "PodScheduled",    status: "True",  lastTransitionTime: startTime },
                                { type: "Initialized",     status: "True",  lastTransitionTime: startTime },
                                { type: "ContainersReady", status: "False", lastTransitionTime: completionTime },
                                { type: "Ready",           status: "False", lastTransitionTime: completionTime },
                            ],
                        }));
                    }, 2_000));
                }
            }, runningDelay));
        }
    }, [Pods, Nodes, dispatch]);

    // Clear timers and tracking state on unmount.
    // scheduledRef must also be reset so that React Strict Mode's
    // simulated unmount/remount cycle doesn't leave pending pods
    // stranded — timers are cancelled on the simulated unmount but
    // the Set survives it, causing pods to be skipped on remount.
    useEffect(() => {
        const timers = timersRef.current;
        const scheduled = scheduledRef.current;
        return () => {
            timers.forEach(clearTimeout);
            scheduled.clear();
        };
    }, []);
}

function rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random host address within a /24 CIDR block (e.g. "10.244.1.0/24" → "10.244.1.x") */
function podIPFromCIDR(cidr: string): string {
    const base = cidr.split('/')[0];
    const parts = base.split('.');
    parts[3] = String(rand(2, 254));
    return parts.join('.');
}
