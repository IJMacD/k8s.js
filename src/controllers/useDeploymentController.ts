import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createReplicaSet, deleteReplicaSet, scaleReplicaSet, updateDeploymentStatus } from "../store/store";
import type { DeploymentStrategy } from "../types/apps/v1/Deployment";

/**
 * Computes a stable 7-char hex hash of a pod template's containers and
 * restart annotation, used to generate ReplicaSet names (mirrors kubectl's
 * pod-template-hash label). Includes image, env vars, resource requirements,
 * and the `kubectl.kubernetes.io/restartedAt` annotation so that `rollout
 * restart` produces a new ReplicaSet (matching real Kubernetes behaviour).
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
 * Resolves the string-or-percent maxSurge and maxUnavailable fields to absolute
 * pod counts, matching the k8s defaults of 25% (surge: ceil, unavailable: floor).
 */
function rollingParams(desired: number, strategy: DeploymentStrategy): { maxSurge: number; maxUnavailable: number } {
    const parse = (value: string | undefined, round: "ceil" | "floor", defaultPct: number): number => {
        if (value === undefined) return Math[round](desired * defaultPct);
        if (value.endsWith("%")) return Math[round](desired * (parseInt(value, 10) / 100));
        return Math.max(0, parseInt(value, 10));
    };
    const ru = strategy.rollingUpdate;
    return {
        maxSurge: parse(ru?.maxSurge, "ceil", 0.25),
        maxUnavailable: parse(ru?.maxUnavailable, "floor", 0.25),
    };
}

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

/**
 * Simulates the Kubernetes Deployment controller.
 * Watches Deployments and reconciles ReplicaSets:
 * - Creates a new ReplicaSet when a Deployment is created or its pod template changes.
 * - Scales the current ReplicaSet when the Deployment's replica count changes.
 * - Drives RollingUpdate rollouts step by step, gated on rs.status.readyReplicas,
 *   respecting maxSurge and maxUnavailable so old pods are only removed once new
 *   pods are confirmed ready.
 */
export function useDeploymentController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Deployments, ReplicaSets } = state;

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        // GC: clean up ReplicaSets whose owning Deployment has been deleted
        for (const rs of ReplicaSets) {
            const owner = rs.metadata.ownerReferences?.find(r => r.kind === "Deployment");
            if (!owner) continue;
            const ownerExists = Deployments.some(
                d => d.metadata.name === owner.name && d.metadata.namespace === rs.metadata.namespace,
            );
            if (!ownerExists) {
                if (rs.spec.replicas > 0) {
                    // Scale to 0 so the RS controller cleans up pods first
                    timers.push(setTimeout(() => dispatch(scaleReplicaSet(rs.metadata.name, 0, rs.metadata.namespace)), RECONCILE_DELAY_MS));
                } else {
                    // Pods already gone — delete the RS itself
                    timers.push(setTimeout(() => dispatch(deleteReplicaSet(rs.metadata.name, rs.metadata.namespace)), RECONCILE_DELAY_MS));
                }
            }
        }

        for (const deployment of Deployments) {
            const { name, namespace } = deployment.metadata;
            const desired = deployment.spec.replicas;
            const hash = podTemplateHash(deployment.spec.template);
            const expectedRsName = `${name}-${hash}`;

            const ownedRSes = ReplicaSets.filter(
                rs =>
                    rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name) &&
                    rs.metadata.namespace === namespace,
            );

            const currentRS = ownedRSes.find(rs => rs.metadata.name === expectedRsName);
            // Old RSes that still have pods running (active rollout or rollback in progress)
            const activeOldRSes = ownedRSes.filter(
                rs => rs.metadata.name !== expectedRsName && rs.spec.replicas > 0,
            );

            const makeRS = (replicas: number) =>
                createReplicaSet({ name: expectedRsName, namespace, ownerRef: { name, uid: deployment.metadata.uid }, replicas, selector: deployment.spec.selector, template: deployment.spec.template });

            if (deployment.spec.strategy.type === "Recreate") {
                // Recreate: kill all old pods first, then bring new RS up
                if (activeOldRSes.length > 0) {
                    for (const oldRS of activeOldRSes) {
                        timers.push(setTimeout(() => dispatch(scaleReplicaSet(oldRS.metadata.name, 0, namespace)), RECONCILE_DELAY_MS));
                    }
                } else if (!currentRS) {
                    timers.push(setTimeout(() => dispatch(makeRS(desired)), RECONCILE_DELAY_MS));
                } else if (currentRS.spec.replicas !== desired) {
                    timers.push(setTimeout(() => dispatch(scaleReplicaSet(expectedRsName, desired, namespace)), RECONCILE_DELAY_MS));
                }
            } else {
                // RollingUpdate: step through using readyReplicas as the gate
                if (activeOldRSes.length === 0) {
                    // No rollout in progress — straightforward create or scale
                    if (!currentRS) {
                        timers.push(setTimeout(() => dispatch(makeRS(desired)), RECONCILE_DELAY_MS));
                    } else if (currentRS.spec.replicas !== desired) {
                        timers.push(setTimeout(() => dispatch(scaleReplicaSet(expectedRsName, desired, namespace)), RECONCILE_DELAY_MS));
                    }
                } else {
                    // Rollout/rollback in progress: drive one step at a time
                    const { maxSurge, maxUnavailable } = rollingParams(desired, deployment.spec.strategy);

                    const newSpec = currentRS?.spec.replicas ?? 0;
                    const newReady = currentRS?.status.readyReplicas ?? 0;
                    const totalOldSpec = activeOldRSes.reduce((s, rs) => s + rs.spec.replicas, 0);
                    const totalOldReady = activeOldRSes.reduce((s, rs) => s + rs.status.readyReplicas, 0);

                    // Step 1: scale up new RS within the surge budget
                    const maxTotal = desired + maxSurge;
                    const scaleUpBy = Math.max(0, maxTotal - (newSpec + totalOldSpec));
                    const newSpecTarget = Math.min(desired, newSpec + scaleUpBy);
                    if (!currentRS) {
                        timers.push(setTimeout(() => dispatch(makeRS(newSpecTarget)), RECONCILE_DELAY_MS));
                    } else if (newSpecTarget !== newSpec) {
                        timers.push(setTimeout(() => dispatch(scaleReplicaSet(expectedRsName, newSpecTarget, namespace)), RECONCILE_DELAY_MS));
                    }

                    // Step 2: scale down old RSes, gated on ready pods — never drop below minAvailable
                    const minAvailable = Math.max(0, desired - maxUnavailable);
                    const totalReady = newReady + totalOldReady;
                    let scaleDownBudget = Math.max(0, totalReady - minAvailable);
                    if (scaleDownBudget > 0) {
                        // Drain oldest old RSes first
                        const sorted = [...activeOldRSes].sort((a, b) =>
                            new Date(a.metadata.creationTimestamp).getTime() -
                            new Date(b.metadata.creationTimestamp).getTime(),
                        );
                        for (const oldRS of sorted) {
                            if (scaleDownBudget <= 0) break;
                            const reduce = Math.min(oldRS.spec.replicas, scaleDownBudget);
                            const target = oldRS.spec.replicas - reduce;
                            timers.push(setTimeout(() => dispatch(scaleReplicaSet(oldRS.metadata.name, target, namespace)), RECONCILE_DELAY_MS));
                            scaleDownBudget -= reduce;
                        }
                    }
                }
            }

            // Revision history pruning: delete stale scaled-to-0 RSes beyond revisionHistoryLimit
            const historyLimit = deployment.spec.revisionHistoryLimit ?? 10;
            const staleRSes = ownedRSes
                .filter(rs => rs.metadata.name !== expectedRsName && rs.spec.replicas === 0)
                .sort((a, b) =>
                    new Date(a.metadata.creationTimestamp).getTime() -
                    new Date(b.metadata.creationTimestamp).getTime(),
                );
            const excess = staleRSes.length - historyLimit;
            if (excess > 0) {
                for (const rs of staleRSes.slice(0, excess)) {
                    timers.push(setTimeout(() => dispatch(deleteReplicaSet(rs.metadata.name, namespace)), RECONCILE_DELAY_MS));
                }
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [Deployments, ReplicaSets, dispatch]);

    // Status rollup — separate effect with change-detection to avoid cancelling timers above.
    useEffect(() => {
        for (const d of Deployments) {
            const { name, namespace } = d.metadata;

            const ownedRSes = ReplicaSets.filter(
                rs =>
                    rs.metadata.namespace === namespace &&
                    rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name),
            );

            const readyReplicas = ownedRSes.reduce((sum, rs) => sum + rs.status.readyReplicas, 0);
            const availableReplicas = ownedRSes.reduce((sum, rs) => sum + rs.status.availableReplicas, 0);
            const updatedReplicas = ownedRSes.reduce((sum, rs) => sum + rs.status.replicas, 0);

            if (
                d.status.readyReplicas !== readyReplicas ||
                d.status.availableReplicas !== availableReplicas ||
                d.status.updatedReplicas !== updatedReplicas
            ) {
                dispatch(updateDeploymentStatus(name, namespace, { readyReplicas, availableReplicas, updatedReplicas }));
            }
        }
    }, [Deployments, ReplicaSets, dispatch]);
}
