import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { PodCondition } from "./types/apps/Pod";
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

    const { Pods } = state;

    useEffect(() => {
        for (const pod of Pods) {
            const uid = pod.metadata.uid;
            if (scheduledRef.current.has(uid)) continue;
            // Only drive Pending pods
            if (pod.status.phase !== "Pending") continue;

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
            timersRef.current.push(setTimeout(() => {
                const startTime = now();
                const podIP = `10.${rand(0, 255)}.${rand(0, 255)}.${rand(2, 254)}`;
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
            }, 3_500));
        }
    }, [Pods, dispatch]);

    // Clear timers only on unmount
    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach(clearTimeout);
    }, []);
}

function rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
