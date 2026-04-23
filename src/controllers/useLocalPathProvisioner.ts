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
            if (!pvc.spec.storageClassName) return false;
            const sc = StorageClasses.find(s => s.metadata.name === pvc.spec.storageClassName && s.provisioner === PROVISIONER);
            if (!sc) return false;
            if (pvc.status.phase !== "Pending") return false;
            if (provisionedRef.current.has(pvc.metadata.uid)) return false;
            if (sc.volumeBindingMode === "WaitForFirstConsumer" && !pvc.metadata.annotations["volume.kubernetes.io/selected-node"]) {
                // WaitForFirstConsumer: only provision once the scheduler has selected a node
                return false;
            }
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
            const sc = StorageClasses.find(s => s.metadata.name === pvc.spec.storageClassName && s.provisioner === PROVISIONER);

            const chosenNode: KubeNode | undefined = sc?.volumeBindingMode === "WaitForFirstConsumer" ?
                readyNodes.find(n => n.metadata.name === pvc.metadata.annotations["volume.kubernetes.io/selected-node"]) :
                pick(readyNodes);
            if (!chosenNode) continue; // Selected node no longer ready — wait

            provisionedRef.current.add(pvc.metadata.uid);

            const pvName = `pvc-${pvc.metadata.uid}`;
            const path = `/var/local-path-provisioner/${pvc.metadata.namespace}_${pvc.metadata.name}_${pvc.metadata.uid}`;
            const reclaimPolicy = sc?.reclaimPolicy ?? "Delete";

            timersRef.current.push(setTimeout(() => {
                dispatch(createPersistentVolume(pvName, {
                    capacity: { storage: pvc.spec.resources.requests.storage },
                    accessModes: pvc.spec.accessModes,
                    persistentVolumeReclaimPolicy: reclaimPolicy,
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

function pick<T>(items: T[]): T | undefined {
    // Pick a random item
    return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : undefined;
}

