import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "./store";
import { createPod, deletePod } from "./store";

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

/**
 * Simulates the Kubernetes ReplicaSet controller.
 * Watches ReplicaSets and reconciles Pods:
 * - Creates pods owned by a ReplicaSet when the actual count is below desired.
 * - Deletes excess pods when the actual count is above desired (e.g. after scale-down).
 */
export function useReplicaSetController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { ReplicaSets, Pods } = state;

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        for (const rs of ReplicaSets) {
            const { name, namespace } = rs.metadata;
            const desired = rs.spec.replicas;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.annotations?.["ownerReplicaSet"] === name,
            );

            const actual = ownedPods.length;
            const containers = rs.spec.template.spec.containers;

            if (actual < desired) {
                // Create missing pods one at a time, staggering each by RECONCILE_DELAY_MS
                for (let i = actual; i < desired; i++) {
                    const podIndex = i;
                    timers.push(setTimeout(() => {
                        const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                        dispatch(createPod(
                            podName,
                            { image: containers[0]?.image ?? "", containerName: containers[0]?.name },
                            namespace,
                            name,
                        ));
                    }, RECONCILE_DELAY_MS * (podIndex - actual + 1)));
                }
            } else if (actual > desired) {
                // Delete excess pods, newest first
                const excess = ownedPods
                    .slice()
                    .sort((a, b) =>
                        new Date(b.metadata.creationTimestamp).getTime() -
                        new Date(a.metadata.creationTimestamp).getTime()
                    )
                    .slice(0, actual - desired);

                excess.forEach((pod, i) => {
                    timers.push(setTimeout(() => {
                        dispatch(deletePod(pod.metadata.name, namespace));
                    }, RECONCILE_DELAY_MS * (i + 1)));
                });
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [ReplicaSets, Pods, dispatch]);
}
