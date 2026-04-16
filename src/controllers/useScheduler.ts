import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { bindPodToNode } from "../store/store";
import type { Pod } from "../types/v1/Pod";
import type { KubeNode } from "../types/v1/Node";

const SCHEDULE_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Resource quantity parsers
// ---------------------------------------------------------------------------

/** Parse a CPU quantity string into millicores (integer). */
function parseCPU(s: string): number {
    if (s.endsWith("m")) return parseInt(s.slice(0, -1), 10);
    return Math.round(parseFloat(s) * 1000);
}

/** Parse a memory quantity string into bytes (integer). */
function parseMemory(s: string): number {
    if (s.endsWith("Ki")) return parseInt(s.slice(0, -2), 10) * 1024;
    if (s.endsWith("Mi")) return parseInt(s.slice(0, -2), 10) * 1024 ** 2;
    if (s.endsWith("Gi")) return parseInt(s.slice(0, -2), 10) * 1024 ** 3;
    if (s.endsWith("Ti")) return parseInt(s.slice(0, -2), 10) * 1024 ** 4;
    if (s.endsWith("K"))  return parseInt(s.slice(0, -1), 10) * 1000;
    if (s.endsWith("M"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 2;
    if (s.endsWith("G"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 3;
    if (s.endsWith("T"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 4;
    return parseInt(s, 10);
}

// ---------------------------------------------------------------------------
// Pod resource request aggregation
// ---------------------------------------------------------------------------

/** Total CPU requested by all containers in a pod, in millicores. */
function podTotalCPU(pod: Pod): number {
    return pod.spec.containers.reduce((sum, c) => {
        const req = c.resources?.requests?.cpu;
        return sum + (req ? parseCPU(req) : 0);
    }, 0);
}

/** Total memory requested by all containers in a pod, in bytes. */
function podTotalMemory(pod: Pod): number {
    return pod.spec.containers.reduce((sum, c) => {
        const req = c.resources?.requests?.memory;
        return sum + (req ? parseMemory(req) : 0);
    }, 0);
}

// ---------------------------------------------------------------------------
// Node remaining allocatable capacity
// ---------------------------------------------------------------------------

/** Remaining allocatable CPU on a node (millicores), after accounting for bound pods. */
function nodeRemainingCPU(node: KubeNode, allPods: Pod[]): number {
    const allocatable = parseCPU(node.status.allocatable.cpu);
    const used = allPods
        .filter(p => p.spec.nodeName === node.metadata.name)
        .reduce((sum, p) => sum + podTotalCPU(p), 0);
    return allocatable - used;
}

/** Remaining allocatable memory on a node (bytes), after accounting for bound pods. */
function nodeRemainingMemory(node: KubeNode, allPods: Pod[]): number {
    const allocatable = parseMemory(node.status.allocatable.memory);
    const used = allPods
        .filter(p => p.spec.nodeName === node.metadata.name)
        .reduce((sum, p) => sum + podTotalMemory(p), 0);
    return allocatable - used;
}

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
            // NOTE: do NOT add to scheduledRef here — only mark when we actually bind,
            // so that pods which can't be placed now are retried when state changes.

            // Filter by nodeSelector: only consider nodes that match all required labels
            const nodeSelector = pod.spec.nodeSelector;
            const selectorFiltered = nodeSelector && Object.keys(nodeSelector).length > 0
                ? readyNodes.filter(n =>
                    Object.entries(nodeSelector).every(([k, v]) => n.metadata.labels[k] === v)
                )
                : readyNodes;

            // Filter by resource requests: exclude nodes that cannot satisfy the pod's requests
            const reqCPU = podTotalCPU(pod);
            const reqMemory = podTotalMemory(pod);
            const eligibleNodes = selectorFiltered.filter(n =>
                nodeRemainingCPU(n, Pods) >= reqCPU &&
                nodeRemainingMemory(n, Pods) >= reqMemory
            );

            if (eligibleNodes.length === 0) continue; // No node can satisfy requests; pod stays Pending

            // Mark as being scheduled now (prevents duplicate binds during the timer window)
            scheduledRef.current.add(pod.metadata.uid);

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
