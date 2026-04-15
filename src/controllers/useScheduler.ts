import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { bindPodToNode } from "../store/store";

const SCHEDULE_DELAY_MS = 500;

/**
 * Simulates the Kubernetes scheduler.
 * Watches for Pending pods with no nodeName and binds them to a Ready,
 * schedulable node using a least-loaded (fewest pods) strategy.
 */
export function useScheduler(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Pods, Nodes } = state;
    const scheduledRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        const readyNodes = Nodes.filter(
            n => !n.spec.unschedulable &&
                n.status.conditions.find(c => c.type === "Ready")?.status === "True",
        );

        if (readyNodes.length === 0) return;

        const unscheduled = Pods.filter(
            p => p.status.phase === "Pending" &&
                !p.spec.nodeName &&
                !scheduledRef.current.has(p.metadata.uid),
        );

        for (const pod of unscheduled) {
            scheduledRef.current.add(pod.metadata.uid);

            // Filter by nodeSelector: only consider nodes that match all required labels
            const nodeSelector = pod.spec.nodeSelector;
            const eligibleNodes = nodeSelector && Object.keys(nodeSelector).length > 0
                ? readyNodes.filter(n =>
                    Object.entries(nodeSelector).every(([k, v]) => n.metadata.labels[k] === v)
                )
                : readyNodes;

            if (eligibleNodes.length === 0) continue; // No matching node; pod stays Pending

            // Least-loaded: pick node with fewest pods currently assigned
            const chosen = eligibleNodes.reduce((best, node) => {
                const count = Pods.filter(p => p.spec.nodeName === node.metadata.name).length;
                const bestCount = Pods.filter(p => p.spec.nodeName === best.metadata.name).length;
                return count < bestCount ? node : best;
            });

            timersRef.current.push(setTimeout(() => {
                dispatch(bindPodToNode(pod.metadata.name, pod.metadata.namespace, chosen.metadata.name));
            }, SCHEDULE_DELAY_MS));
        }
    }, [Pods, Nodes, dispatch]);

    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach(clearTimeout);
    }, []);
}
