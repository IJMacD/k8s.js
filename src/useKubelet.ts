import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { PodCondition } from "./types/v1/Pod";
import type { AppState, Action } from "./store";
import { updatePodStatus } from "./store";

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
            if (scheduledRef.current.has(uid)) continue;
            // Only drive Pending pods that have been bound to a node
            if (pod.status.phase !== "Pending") continue;
            if (!pod.spec.nodeName) continue;

            scheduledRef.current.add(uid);

            const { name, namespace } = pod.metadata;

            function setConditions(conditions: PodCondition[]) {
                return (prev: PodCondition[] = []) => {
                    const merged = [...prev];
                    for (const c of conditions) {
                        const idx = merged.findIndex(x => x.type === c.type);
                        if (idx >= 0) merged[idx] = c;
                        else merged.push(c);
                    }
                    return merged;
                };
            }

            const now = () => new Date().toISOString();

            // t+1.0s: PodScheduled
            timersRef.current.push(setTimeout(() => {
                dispatch(updatePodStatus(name, namespace, {
                    conditions: setConditions([
                        { type: "PodScheduled", status: "True", lastTransitionTime: now() },
                    ])(pod.status.conditions),
                }));
            }, 1_000));

            // t+2.0s: Initialized
            timersRef.current.push(setTimeout(() => {
                dispatch(updatePodStatus(name, namespace, {
                    conditions: setConditions([
                        { type: "PodScheduled", status: "True", lastTransitionTime: now() },
                        { type: "Initialized",  status: "True", lastTransitionTime: now() },
                    ])(pod.status.conditions),
                }));
            }, 2_000));

            // t+3.5s: Running + Ready
            const node = Nodes.find(n => n.metadata.name === pod.spec.nodeName);
            // Pods with OnFailure or Never restart policy run to completion (Succeeded) after a short delay
            const isBatch = pod.spec.restartPolicy === "OnFailure" || pod.spec.restartPolicy === "Never";
            timersRef.current.push(setTimeout(() => {
                const startTime = now();
                const podIP = node?.spec.podCIDR
                    ? podIPFromCIDR(node.spec.podCIDR)
                    : `10.${rand(0, 255)}.${rand(0, 255)}.${rand(2, 254)}`;
                dispatch(updatePodStatus(name, namespace, {
                    phase: "Running",
                    startTime,
                    podIP,
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
                                { type: "PodScheduled", status: "True", lastTransitionTime: startTime },
                                { type: "Initialized", status: "True", lastTransitionTime: startTime },
                                { type: "ContainersReady", status: "False", lastTransitionTime: completionTime },
                                { type: "Ready", status: "False", lastTransitionTime: completionTime },
                            ],
                        }));
                    }, 2_000));
                }
            }, 3_500));
        }
    }, [Pods, Nodes, dispatch]);

    // Clear timers only on unmount
    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach(clearTimeout);
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
