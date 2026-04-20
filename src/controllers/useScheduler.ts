import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { bindPodToNode } from "../store/store";
import type { Pod } from "../types/v1/Pod";
import type { KubeNode } from "../types/v1/Node";
import type { NodeSelectorRequirement } from "../types/v1/PersistentVolume";

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
 * Evaluate a single nodeAffinity matchExpression against a node's labels.
 * Exported for testability.
 */
export function matchNodeSelectorExpr(expr: NodeSelectorRequirement, labels: Record<string, string>): boolean {
    const val = labels[expr.key];
    switch (expr.operator) {
        case "In":          return expr.values !== undefined && expr.values.includes(val ?? "");
        case "NotIn":       return expr.values !== undefined && !expr.values.includes(val ?? "");
        case "Exists":      return val !== undefined;
        case "DoesNotExist": return val === undefined;
    }
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
    const { Pods, Nodes, PersistentVolumeClaims, PersistentVolumes } = state;
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

        // Track PVC→node assignments made in this scheduling pass so RWO pinning
        // applies correctly across multiple pods scheduled simultaneously.
        // For RWOP, a true value means the PVC has already been claimed this pass.
        const pvcNodeInFlight = new Map<string, string>();   // "ns/pvcName" → nodeName (RWO)
        const pvcClaimedInFlight = new Set<string>();        // "ns/pvcName"            (RWOP)

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

            // ---------------------------------------------------------------
            // PVC constraint 1: All PVC volumes must be already Bound.
            // If any referenced PVC is still Pending/Lost, skip this pod.
            // ---------------------------------------------------------------
            const pvClaimNames = (pod.spec.volumes ?? []).flatMap(v =>
                v.persistentVolumeClaim ? [v.persistentVolumeClaim.claimName] : []
            );
            const pvcRefs = pvClaimNames.map(cn =>
                PersistentVolumeClaims.find(
                    c => c.metadata.name === cn && c.metadata.namespace === pod.metadata.namespace
                )
            );
            if (pvcRefs.some(c => !c || c.status.phase !== "Bound")) continue;

            // ---------------------------------------------------------------
            // PVC constraint 2: nodeAffinity from bound PVs must be satisfied.
            // ---------------------------------------------------------------
            let affinityFiltered = selectorFiltered;
            for (const pvc of pvcRefs as NonNullable<typeof pvcRefs[number]>[]) {
                const pvName = pvc.status.boundVolume;
                const pv = pvName ? PersistentVolumes.find(p => p.metadata.name === pvName) : undefined;
                const terms = pv?.spec.nodeAffinity?.required?.nodeSelectorTerms;
                if (!terms || terms.length === 0) continue;
                // Terms are OR'd; within a term matchExpressions are AND'd
                affinityFiltered = affinityFiltered.filter(node =>
                    terms.some(term =>
                        (term.matchExpressions ?? []).every(expr =>
                            matchNodeSelectorExpr(expr, node.metadata.labels)
                        ) &&
                        (term.matchFields ?? []).every(expr =>
                            matchNodeSelectorExpr(expr, { metadata: node.metadata.name } as unknown as Record<string, string>)
                        )
                    )
                );
            }

            // ---------------------------------------------------------------
            // PVC constraint 3: RWO / RWOP access-mode pinning.
            //   RWO  → at most one node may have the volume mounted at once;
            //          if another Running pod already uses this PVC on node X,
            //          constrain scheduling to node X only.
            //   RWOP → the volume can only be used by a single pod at a time;
            //          if any Running pod already uses this PVC, no node is eligible.
            // ---------------------------------------------------------------
            for (const pvc of pvcRefs as NonNullable<typeof pvcRefs[number]>[]) {
                const modes = pvc.spec.accessModes;
                if (modes.includes("ReadWriteOncePod")) {
                    // RWOP: only one pod cluster-wide may mount this PVC at a time.
                    // Block if another non-terminal pod already has it, or if one was
                    // assigned earlier in this same scheduling pass.
                    const pvcKey = `${pvc.metadata.namespace}/${pvc.metadata.name}`;
                    const claimedInFlight = pvcClaimedInFlight.has(pvcKey);
                    const inUse = claimedInFlight || Pods.some(p =>
                        p.metadata.uid !== pod.metadata.uid &&
                        p.status.phase !== "Succeeded" &&
                        p.status.phase !== "Failed" &&
                        p.spec.nodeName &&
                        (p.spec.volumes ?? []).some(v =>
                            v.persistentVolumeClaim?.claimName === pvc.metadata.name &&
                            p.metadata.namespace === pvc.metadata.namespace
                        )
                    );
                    if (inUse) {
                        affinityFiltered = [];
                        break;
                    }
                } else if (modes.includes("ReadWriteOnce")) {
                    // Find the node where this PVC is already actively mounted:
                    // check bound-but-not-yet-Running pods too, and in-flight assignments
                    // from the current scheduling pass.
                    const pvcKey = `${pvc.metadata.namespace}/${pvc.metadata.name}`;
                    const inFlightNode = pvcNodeInFlight.get(pvcKey);
                    const pinnedNode = inFlightNode ?? Pods.find(p =>
                        p.metadata.uid !== pod.metadata.uid &&
                        p.status.phase !== "Succeeded" &&
                        p.status.phase !== "Failed" &&
                        p.spec.nodeName &&
                        (p.spec.volumes ?? []).some(v =>
                            v.persistentVolumeClaim?.claimName === pvc.metadata.name &&
                            p.metadata.namespace === pvc.metadata.namespace
                        )
                    )?.spec.nodeName;
                    if (pinnedNode) {
                        affinityFiltered = affinityFiltered.filter(n => n.metadata.name === pinnedNode);
                    }
                }
            }

            // Filter by resource requests: exclude nodes that cannot satisfy the pod's requests
            const reqCPU = podTotalCPU(pod);
            const reqMemory = podTotalMemory(pod);
            const eligibleNodes = affinityFiltered.filter(n =>
                nodeRemainingCPU(n, Pods) >= reqCPU &&
                nodeRemainingMemory(n, Pods) >= reqMemory
            );

            if (eligibleNodes.length === 0) continue; // No node can satisfy requests; pod stays Pending

            // Mark as being scheduled now (prevents duplicate binds during the timer window)
            scheduledRef.current.add(pod.metadata.uid);

            // Spread-aware scoring: prefer nodes with fewer same-owner pods (spread),
            // then break ties by fewest total pods (least-loaded).
            const ownerUid = pod.metadata.ownerReferences?.[0]?.uid ?? null;
            const nodeScore = (node: KubeNode) => {
                const nodePods = Pods.filter(p => p.spec.nodeName === node.metadata.name);
                const spreadCount = ownerUid
                    ? nodePods.filter(p => p.metadata.ownerReferences?.[0]?.uid === ownerUid).length
                    : 0;
                // Lower spread count is better; use total count as a tiebreaker with small weight
                return spreadCount * 1000 + nodePods.length;
            };
            const chosen = eligibleNodes.reduce((best, node) =>
                nodeScore(node) < nodeScore(best) ? node : best
            );

            // Record in-flight PVC→node so subsequent pods in this pass respect RWO
            for (const pvc of pvcRefs as NonNullable<typeof pvcRefs[number]>[]) {
                const pvcKey = `${pvc.metadata.namespace}/${pvc.metadata.name}`;
                if (pvc.spec.accessModes.includes("ReadWriteOncePod")) {
                    pvcClaimedInFlight.add(pvcKey);
                } else if (pvc.spec.accessModes.includes("ReadWriteOnce")) {
                    pvcNodeInFlight.set(pvcKey, chosen.metadata.name);
                }
            }

            timersRef.current.push(setTimeout(() => {
                dispatch(bindPodToNode(pod.metadata.name, pod.metadata.namespace, chosen.metadata.name));
            }, SCHEDULE_DELAY_MS));
        }
    }, [Pods, Nodes, PersistentVolumeClaims, PersistentVolumes, dispatch]);

    useEffect(() => {
        const timers = timersRef.current;
        const scheduled = scheduledRef.current;
        return () => {
            timers.forEach(clearTimeout);
            scheduled.clear();
        };
    }, []);
}
