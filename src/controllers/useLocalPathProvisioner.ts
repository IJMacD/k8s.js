import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createPersistentVolume } from "../store/store";
import type { KubeNode } from "../types/v1/Node";

const PROVISIONER = "local-path-provisioner";
const PROVISION_DELAY_MS = 300;

/**
 * Simulates a local-path-provisioner.
 * Watches for Pending PVCs whose StorageClass uses the "local-path-provisioner"
 * provisioner and dynamically creates a matching PV with nodeAffinity pinned
 * to the node selected by the WaitForFirstConsumer scheduler pass.
 */
export function useLocalPathProvisioner(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { PersistentVolumeClaims, PersistentVolumes, Nodes, StorageClasses } = state;
    const provisionedRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        const readyNodes = Nodes.filter(
            n => !n.spec.unschedulable &&
                n.status.conditions.find(c => c.type === "Ready")?.status === "True",
        );
        if (readyNodes.length === 0) return;

        // Collect all storageClassNames backed by this provisioner
        const managedClasses = new Set(
            StorageClasses
                .filter(sc => sc.provisioner === PROVISIONER)
                .map(sc => sc.metadata.name),
        );
        if (managedClasses.size === 0) return;

        const unprovisioned = PersistentVolumeClaims.filter(pvc => {
            if (!pvc.spec.storageClassName || !managedClasses.has(pvc.spec.storageClassName)) return false;
            if (pvc.status.phase !== "Pending") return false;
            if (provisionedRef.current.has(pvc.metadata.uid)) return false;
            // WaitForFirstConsumer: only provision once the scheduler has selected a node
            if (!pvc.metadata.annotations["volume.kubernetes.io/selected-node"]) return false;
            // Don't provision if a suitable Available PV already exists (e.g. user-created)
            const alreadyCovered = PersistentVolumes.some(pv =>
                pv.status.phase === "Available" &&
                !!pv.spec.storageClassName &&
                managedClasses.has(pv.spec.storageClassName) &&
                pvc.spec.accessModes.every(m => pv.spec.accessModes.includes(m)),
            );
            return !alreadyCovered;
        });

        for (const pvc of unprovisioned) {
            // Use the selected-node annotation stamped by the scheduler (WaitForFirstConsumer)
            const selectedNodeName = pvc.metadata.annotations["volume.kubernetes.io/selected-node"];
            const chosenNode: KubeNode | undefined = readyNodes.find(n => n.metadata.name === selectedNodeName);
            if (!chosenNode) continue; // Selected node no longer ready — wait

            provisionedRef.current.add(pvc.metadata.uid);

            const pvName = `pvc-${pvc.metadata.uid}`;
            const path = `/var/local-path-provisioner/${pvc.metadata.namespace}_${pvc.metadata.name}_${pvc.metadata.uid}`;

            timersRef.current.push(setTimeout(() => {
                dispatch(createPersistentVolume(pvName, {
                    capacity: { storage: pvc.spec.resources.requests.storage },
                    accessModes: pvc.spec.accessModes,
                    persistentVolumeReclaimPolicy: "Delete",
                    storageClassName: pvc.spec.storageClassName,
                    ...(pvc.spec.volumeMode ? { volumeMode: pvc.spec.volumeMode } : {}),
                    local: { path },
                    nodeAffinity: {
                        required: {
                            nodeSelectorTerms: [{
                                matchExpressions: [{
                                    key: "kubernetes.io/hostname",
                                    operator: "In",
                                    values: [chosenNode.metadata.name],
                                }],
                            }],
                        },
                    },
                    creationTimestamp: new Date().toISOString(),
                }));
            }, PROVISION_DELAY_MS));
        }
    }, [PersistentVolumeClaims, PersistentVolumes, Nodes, StorageClasses, dispatch]);

    useEffect(() => {
        const timers = timersRef.current;
        const provisioned = provisionedRef.current;
        return () => {
            timers.forEach(clearTimeout);
            provisioned.clear();
        };
    }, []);
}
