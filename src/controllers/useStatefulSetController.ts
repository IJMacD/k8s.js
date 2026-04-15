import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createPod, deletePod, updateStatefulSetStatus } from "../store/store";

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

/**
 * Simulates the Kubernetes StatefulSet controller.
 * Manages pods with stable, ordinal names: <sts-name>-0, <sts-name>-1, etc.
 *
 * OrderedReady (default): pods are created one at a time in ascending order,
 * each must reach Running before the next is created; scale-down deletes the
 * highest-index pod first, one at a time.
 *
 * Parallel: all pods are created/deleted simultaneously (like a ReplicaSet).
 */
export function useStatefulSetController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { StatefulSets, Pods } = state;

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        // GC: delete pods whose owning StatefulSet has been deleted
        for (const pod of Pods) {
            const owner = pod.metadata.ownerReferences?.find(r => r.kind === "StatefulSet");
            if (!owner) continue;
            const ownerExists = StatefulSets.some(
                sts => sts.metadata.name === owner.name && sts.metadata.namespace === pod.metadata.namespace,
            );
            if (!ownerExists) {
                timers.push(setTimeout(() => dispatch(deletePod(pod.metadata.name, pod.metadata.namespace)), RECONCILE_DELAY_MS));
            }
        }

        for (const sts of StatefulSets) {
            const { name, namespace, uid } = sts.metadata;
            const desired = sts.spec.replicas;
            const policy = sts.spec.podManagementPolicy ?? "OrderedReady";

            // Collect only pods owned by this StatefulSet with a valid ordinal index
            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "StatefulSet" && r.name === name),
            );

            const indexedPods = ownedPods
                .map(p => {
                    const suffix = p.metadata.name.slice(name.length + 1);
                    const index = /^\d+$/.test(suffix) ? parseInt(suffix, 10) : -1;
                    return { pod: p, index };
                })
                .filter(x => x.index >= 0)
                .sort((a, b) => a.index - b.index);

            const podByIndex = new Map(indexedPods.map(({ pod, index }) => [index, pod]));

            const makePod = (podIndex: number) => {
                const podName = `${name}-${podIndex}`;
                dispatch(createPod(
                    podName,
                    {
                        metadata: {
                            labels: {
                                ...sts.spec.selector.matchLabels,
                                "statefulset.kubernetes.io/pod-name": podName,
                            },
                        },
                        spec: sts.spec.template.spec,
                    },
                    namespace,
                    { kind: "StatefulSet", apiVersion: "apps/v1", name, uid },
                ));
            };

            if (policy === "Parallel") {
                // Create all missing pods simultaneously
                for (let i = 0; i < desired; i++) {
                    if (!podByIndex.has(i)) {
                        const podIndex = i;
                        timers.push(setTimeout(() => makePod(podIndex), RECONCILE_DELAY_MS));
                    }
                }
                // Delete all excess pods simultaneously
                for (const { pod, index } of indexedPods) {
                    if (index >= desired) {
                        timers.push(setTimeout(() => dispatch(deletePod(pod.metadata.name, namespace)), RECONCILE_DELAY_MS));
                    }
                }
            } else {
                // OrderedReady: one pod at a time in ordinal order

                // Scale up: create the lowest missing ordinal, gated on its predecessor being Running
                for (let i = 0; i < desired; i++) {
                    if (!podByIndex.has(i)) {
                        const prevReady = i === 0 || podByIndex.get(i - 1)?.status.phase === "Running";
                        if (prevReady) {
                            const podIndex = i;
                            timers.push(setTimeout(() => makePod(podIndex), RECONCILE_DELAY_MS));
                        }
                        break; // never create more than one pod per reconcile pass
                    }
                }

                // Scale down: delete only the single highest-index pod above desired
                const excessPods = indexedPods.filter(({ index }) => index >= desired);
                if (excessPods.length > 0) {
                    const highest = excessPods[excessPods.length - 1];
                    timers.push(setTimeout(() => dispatch(deletePod(highest.pod.metadata.name, namespace)), RECONCILE_DELAY_MS));
                }
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [StatefulSets, Pods, dispatch]);

    // Status rollup — separate effect with change-detection to avoid cancelling timers above.
    useEffect(() => {
        for (const sts of StatefulSets) {
            const { name, namespace } = sts.metadata;
            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "StatefulSet" && r.name === name),
            );
            const replicas = ownedPods.length;
            const readyReplicas = ownedPods.filter(
                p => p.status.conditions?.find(c => c.type === "Ready")?.status === "True",
            ).length;
            const availableReplicas = readyReplicas;
            const updatedReplicas = replicas;

            if (
                sts.status.replicas !== replicas ||
                sts.status.readyReplicas !== readyReplicas ||
                sts.status.availableReplicas !== availableReplicas ||
                sts.status.updatedReplicas !== updatedReplicas
            ) {
                dispatch(updateStatefulSetStatus(name, namespace, {
                    replicas,
                    readyReplicas,
                    availableReplicas,
                    updatedReplicas,
                }));
            }
        }
    }, [StatefulSets, Pods, dispatch]);
}
