import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createPod, deletePod, updateReplicaSetStatus } from "../store/store";

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

        // GC: delete pods whose owning ReplicaSet has been deleted
        for (const pod of Pods) {
            const owner = pod.metadata.ownerReferences?.find(r => r.kind === "ReplicaSet");
            if (!owner) continue;
            const ownerExists = ReplicaSets.some(
                rs => rs.metadata.name === owner.name && rs.metadata.namespace === pod.metadata.namespace,
            );
            if (!ownerExists) {
                timers.push(setTimeout(() => dispatch(deletePod(pod.metadata.name, pod.metadata.namespace)), RECONCILE_DELAY_MS));
            }
        }

        for (const rs of ReplicaSets) {
            const { name, namespace } = rs.metadata;
            const desired = rs.spec.replicas;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "ReplicaSet" && r.name === name),
            );

            const actual = ownedPods.length;

            if (actual < desired) {
                // Create missing pods one at a time, staggering each by RECONCILE_DELAY_MS
                for (let i = actual; i < desired; i++) {
                    const podIndex = i;
                    timers.push(setTimeout(() => {
                        const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                        dispatch(createPod(
                            podName,
                            {
                                metadata: { labels: rs.metadata.labels },
                                spec: rs.spec.template.spec,
                            },
                            namespace,
                            { kind: "ReplicaSet", apiVersion: "apps/v1", name: rs.metadata.name, uid: rs.metadata.uid },
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

    // Status rollup — separate effect with change-detection to avoid cancelling timers above.
    useEffect(() => {
        for (const rs of ReplicaSets) {
            const { name, namespace } = rs.metadata;
            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "ReplicaSet" && r.name === name),
            );
            const replicas = ownedPods.length;
            const readyReplicas = ownedPods.filter(
                p => p.status.conditions?.find(c => c.type === "Ready")?.status === "True",
            ).length;

            // minReadySeconds: a pod is "available" only after it has been ready for at least N seconds.
            // Look up minReadySeconds from the owning Deployment (if any).
            const ownerDeploy = rs.metadata.ownerReferences?.find(r => r.kind === "Deployment");
            const minReadySeconds = ownerDeploy
                ? (state.Deployments.find(
                    d => d.metadata.name === ownerDeploy.name && d.metadata.namespace === namespace,
                )?.spec.minReadySeconds ?? 0)
                : 0;
            const now = Date.now();
            const availableReplicas = ownedPods.filter(p => {
                const readyCond = p.status.conditions?.find(c => c.type === "Ready");
                if (readyCond?.status !== "True") return false;
                if (minReadySeconds <= 0) return true;
                const readySince = readyCond.lastTransitionTime
                    ? new Date(readyCond.lastTransitionTime).getTime()
                    : (p.status.startTime ? new Date(p.status.startTime).getTime() : now);
                return now - readySince >= minReadySeconds * 1000;
            }).length;

            if (
                rs.status.replicas !== replicas ||
                rs.status.readyReplicas !== readyReplicas ||
                rs.status.availableReplicas !== availableReplicas
            ) {
                dispatch(updateReplicaSetStatus(name, namespace, { replicas, readyReplicas, availableReplicas }));
            }
        }
    }, [ReplicaSets, Pods, state.Deployments, dispatch]);
}
