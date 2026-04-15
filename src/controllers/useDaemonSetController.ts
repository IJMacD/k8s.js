import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createPod, deletePod, updateDaemonSetStatus } from "../store/store";

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

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
            const containers = ds.spec.template.spec.containers;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "DaemonSet" && r.name === name),
            );

            // Ensure one pod per schedulable node
            for (const node of schedulableNodes) {
                const hasPod = ownedPods.some(p => p.spec.nodeName === node.metadata.name);
                if (!hasPod) {

                    timers.push(setTimeout(() => {
                        const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                        dispatch(createPod(
                            podName,
                            {
                                image: containers[0]?.image ?? "",
                                containerName: containers[0]?.name,
                                ports: containers[0]?.ports,
                                labels: { ...ds.metadata.labels },
                                nodeName: node.metadata.name,
                            },
                            namespace,
                            { kind: "DaemonSet", apiVersion: "apps/v1", name, uid },
                        ));
                    }, RECONCILE_DELAY_MS));
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
