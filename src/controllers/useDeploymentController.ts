import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createReplicaSet, deleteReplicaSet, scaleReplicaSet } from "../store/store";

/**
 * Computes a stable 7-char hex hash of a pod template's containers,
 * used to generate ReplicaSet names (mirrors kubectl's pod-template-hash label).
 */
function podTemplateHash(containers: Array<{ name: string; image: string }>): string {
    const str = containers.map(c => `${c.name}=${c.image}`).join(",");
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(7, "0").slice(0, 7);
}

/** Simulated reconciliation delay in milliseconds */
const RECONCILE_DELAY_MS = 2_000;

/**
 * Simulates the Kubernetes Deployment controller.
 * Watches Deployments and reconciles ReplicaSets:
 * - Creates a new ReplicaSet when a Deployment is created or its pod template changes.
 * - Scales the current ReplicaSet when the Deployment's replica count changes.
 * - Scales down old ReplicaSets when the pod template changes.
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
            const containers = deployment.spec.template.spec.containers;
            const hash = podTemplateHash(containers);
            const expectedRsName = `${name}-${hash}`;

            const ownedRSes = ReplicaSets.filter(
                rs =>
                    rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name) &&
                    rs.metadata.namespace === namespace,
            );

            const currentRS = ownedRSes.find(rs => rs.metadata.name === expectedRsName);

            if (!currentRS) {
                timers.push(setTimeout(() => {
                    dispatch(
                        createReplicaSet({
                            name: expectedRsName,
                            namespace,
                            ownerRef: { name, uid: deployment.metadata.uid },
                            replicas: deployment.spec.replicas,
                            selector: deployment.spec.selector,
                            containers,
                        }),
                    );
                    // Scale down any stale RSes from a previous pod template
                    for (const staleRS of ownedRSes) {
                        if (staleRS.spec.replicas > 0) {
                            dispatch(scaleReplicaSet(staleRS.metadata.name, 0, namespace));
                        }
                    }
                }, RECONCILE_DELAY_MS));
            } else if (currentRS.spec.replicas !== deployment.spec.replicas) {
                timers.push(setTimeout(() => {
                    dispatch(scaleReplicaSet(expectedRsName, deployment.spec.replicas, namespace));
                }, RECONCILE_DELAY_MS));
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [Deployments, ReplicaSets, dispatch]);
}
