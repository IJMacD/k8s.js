import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "./store";
import { updateReplicaSetStatus, updateDeploymentStatus } from "./store";

/**
 * Watches pods and propagates ready/available counts up to owning
 * ReplicaSets and then to owning Deployments — mirroring what the
 * kube-controller-manager's RS and Deployment controllers do in real k8s.
 */
export function useStatusController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Pods, ReplicaSets, Deployments } = state;

    useEffect(() => {
        // --- ReplicaSet status ---
        for (const rs of ReplicaSets) {
            const { name, namespace } = rs.metadata;

            const ownedPods = Pods.filter(
                p =>
                    p.metadata.namespace === namespace &&
                    p.metadata.annotations?.["ownerReplicaSet"] === name,
            );

            const replicas = ownedPods.length;
            const readyReplicas = ownedPods.filter(
                p => p.status.conditions?.find(c => c.type === "Ready")?.status === "True",
            ).length;
            const availableReplicas = readyReplicas;

            if (
                rs.status.replicas !== replicas ||
                rs.status.readyReplicas !== readyReplicas ||
                rs.status.availableReplicas !== availableReplicas
            ) {
                dispatch(updateReplicaSetStatus(name, namespace, { replicas, readyReplicas, availableReplicas }));
            }
        }

        // --- Deployment status ---
        for (const d of Deployments) {
            const { name, namespace } = d.metadata;

            const ownedRSes = ReplicaSets.filter(
                rs =>
                    rs.metadata.namespace === namespace &&
                    rs.metadata.annotations["ownerDeployment"] === name,
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
    }, [Pods, ReplicaSets, Deployments, dispatch]);
}
