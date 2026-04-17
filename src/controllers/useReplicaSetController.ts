import { useEffect, useRef } from "react";
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

    // Tracks how many pod-creation timers are currently in-flight per RS key (namespace/name).
    // This ref is NOT cleared during effect cleanup so that creation timers survive re-runs
    // caused by pod status updates (kubelet fires several updates per pod in quick succession,
    // each of which would otherwise cancel and reschedule the creation timers indefinitely).
    const creationInFlightRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        // Only deletion/GC timers go here — they ARE cancelled on re-run so that stale
        // deletes don't fire after a RS is recreated or scaled back up.
        const deletionTimers: ReturnType<typeof setTimeout>[] = [];

        // GC: delete pods whose owning ReplicaSet has been deleted
        for (const pod of Pods) {
            const owner = pod.metadata.ownerReferences?.find(r => r.kind === "ReplicaSet");
            if (!owner) continue;
            const ownerExists = ReplicaSets.some(
                rs => rs.metadata.name === owner.name && rs.metadata.namespace === pod.metadata.namespace,
            );
            if (!ownerExists) {
                deletionTimers.push(setTimeout(() => dispatch(deletePod(pod.metadata.name, pod.metadata.namespace)), RECONCILE_DELAY_MS));
            }
        }

        for (const rs of ReplicaSets) {
            const { name, namespace } = rs.metadata;
            const desired = rs.spec.replicas;
            const rsKey = `${namespace}/${name}`;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.ownerReferences?.some(r => r.kind === "ReplicaSet" && r.name === name),
            );

            const actual   = ownedPods.length;
            const inFlight = creationInFlightRef.current.get(rsKey) ?? 0;
            // "effective" counts both existing pods and those whose creation timers are pending.
            // This prevents re-runs from scheduling duplicate creates while timers are in flight.
            const effective = actual + inFlight;

            if (effective < desired) {
                // Create missing pods — timers are deliberately NOT added to deletionTimers
                // so they survive effect re-runs triggered by pod status updates.
                const toCreate = desired - effective;
                creationInFlightRef.current.set(rsKey, inFlight + toCreate);
                for (let i = 0; i < toCreate; i++) {
                    setTimeout(() => {
                        const podName = `${name}-${crypto.randomUUID().slice(0, 5)}`;
                        dispatch(createPod(
                            podName,
                            {
                                metadata: { labels: rs.spec.template.metadata?.labels },
                                spec: rs.spec.template.spec,
                            },
                            namespace,
                            { kind: "ReplicaSet", apiVersion: "apps/v1", name: rs.metadata.name, uid: rs.metadata.uid },
                        ));
                        const cur = creationInFlightRef.current.get(rsKey) ?? 1;
                        creationInFlightRef.current.set(rsKey, Math.max(0, cur - 1));
                    }, RECONCILE_DELAY_MS * (i + 1));
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
                    deletionTimers.push(setTimeout(() => {
                        dispatch(deletePod(pod.metadata.name, namespace));
                    }, RECONCILE_DELAY_MS * (i + 1)));
                });
            }
        }

        // Purge inFlight entries for RSes that no longer exist
        for (const key of creationInFlightRef.current.keys()) {
            const slashIdx = key.indexOf('/');
            const ns   = key.slice(0, slashIdx);
            const rname = key.slice(slashIdx + 1);
            if (!ReplicaSets.some(rs => rs.metadata.namespace === ns && rs.metadata.name === rname)) {
                creationInFlightRef.current.delete(key);
            }
        }

        return () => deletionTimers.forEach(clearTimeout);
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
