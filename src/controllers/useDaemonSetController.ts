import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createPod, deletePod, updateDaemonSetStatus } from "../store/store";

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

/**
 * Computes a stable hash of a pod template spec for change detection.
 */
function podTemplateHash(template: import("../types/v1/Pod").PodTemplateSpec): string {
    const sortedReplacer = (_key: string, value: unknown) =>
        value !== null && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
            : value;
    const str = JSON.stringify(template, sortedReplacer);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(7, "0").slice(0, 7);
}

/**
 * Simulates the Kubernetes DaemonSet controller.
 * Ensures exactly one pod per schedulable node for each DaemonSet.
 * Pods are pre-bound to their target node (bypassing the scheduler).
 */
export function useDaemonSetController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { DaemonSets, Pods, Nodes } = state;

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        // GC: delete pods whose owning DaemonSet has been deleted
        for (const pod of Pods) {
            const owner = pod.metadata.ownerReferences?.find(r => r.kind === "DaemonSet");
            if (!owner) continue;
            const ownerExists = DaemonSets.some(
                ds => ds.metadata.name === owner.name && ds.metadata.namespace === pod.metadata.namespace,
            );
            if (!ownerExists) {
                timers.push(setTimeout(() => dispatch(deletePod(pod.metadata.name, pod.metadata.namespace)), RECONCILE_DELAY_MS));
            }
        }

        // Schedulable nodes: Ready and not cordoned
        const schedulableNodes = Nodes.filter(
            n => !n.spec.unschedulable &&
                n.status.conditions.some(c => c.type === "Ready" && c.status === "True"),
        );

        for (const ds of DaemonSets) {
            const { name, namespace, uid } = ds.metadata;
            const currentHash = podTemplateHash(ds.spec.template);

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "DaemonSet" && r.name === name),
            );

            // Group pods by node
            const podsByNode = new Map<string, typeof ownedPods[0]>();
            for (const pod of ownedPods) {
                if (pod.spec.nodeName) {
                    podsByNode.set(pod.spec.nodeName, pod);
                }
            }

            // Ensure one pod per schedulable node
            for (const node of schedulableNodes) {
                const nodeName = node.metadata.name;
                const existingPod = podsByNode.get(nodeName);

                if (!existingPod) {
                    // No pod on this node - create one
                    timers.push(setTimeout(() => {
                        const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                        dispatch(createPod(
                            podName,
                            {
                                metadata: {
                                    labels: {
                                        ...ds.spec.template.metadata?.labels,
                                        "controller-revision-hash": currentHash,
                                    },
                                },
                                spec: { ...ds.spec.template.spec, nodeName },
                            },
                            namespace,
                            { kind: "DaemonSet", apiVersion: "apps/v1", name, uid },
                        ));
                    }, RECONCILE_DELAY_MS));
                } else {
                    // Pod exists - check if template has changed
                    const podHash = existingPod.metadata.labels?.["controller-revision-hash"];
                    // If pod has no hash label (legacy pod) or hash doesn't match, it needs updating
                    if (!podHash || podHash !== currentHash) {
                        // Template changed - handle based on update strategy
                        if (ds.spec.updateStrategy.type === "RollingUpdate") {
                            // Delete the old pod, controller will recreate it on next pass
                            timers.push(setTimeout(() => {
                                dispatch(deletePod(existingPod.metadata.name, namespace));
                            }, RECONCILE_DELAY_MS));
                        }
                        // OnDelete: do nothing, user must manually delete pods
                    }
                }
            }

            // Delete pods on nodes that are now cordoned or gone
            for (const pod of ownedPods) {
                if (!pod.spec.nodeName) continue;
                const node = Nodes.find(n => n.metadata.name === pod.spec.nodeName);
                const isSchedulable =
                    node &&
                    !node.spec.unschedulable &&
                    node.status.conditions.some(c => c.type === "Ready" && c.status === "True");
                if (!isSchedulable) {
                    timers.push(setTimeout(() => {
                        dispatch(deletePod(pod.metadata.name, namespace));
                    }, RECONCILE_DELAY_MS));
                }
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [DaemonSets, Pods, Nodes, dispatch]);

    // Status rollup — kept in a separate effect with change-detection to avoid
    // cancelling the pod-create timers above on every render.
    useEffect(() => {
        const schedulableNodes = Nodes.filter(
            n => !n.spec.unschedulable &&
                n.status.conditions.some(c => c.type === "Ready" && c.status === "True"),
        );

        for (const ds of DaemonSets) {
            const { name, namespace } = ds.metadata;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "DaemonSet" && r.name === name),
            );

            const desired = schedulableNodes.length;
            const current = ownedPods.length;
            const ready = ownedPods.filter(p => p.status.phase === "Running").length;

            if (
                ds.status.desiredNumberScheduled !== desired ||
                ds.status.currentNumberScheduled !== current ||
                ds.status.numberReady !== ready ||
                ds.status.numberAvailable !== ready ||
                ds.status.updatedNumberScheduled !== current
            ) {
                dispatch(updateDaemonSetStatus(name, namespace, {
                    desiredNumberScheduled: desired,
                    currentNumberScheduled: current,
                    numberReady: ready,
                    numberAvailable: ready,
                    updatedNumberScheduled: current,
                    observedGeneration: ds.metadata.generation,
                }));
            }
        }
    }, [DaemonSets, Pods, Nodes, dispatch]);
}
