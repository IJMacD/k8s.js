import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { bindPVC } from "../store/store";
import type { PersistentVolume } from "../types/v1/PersistentVolume";
import type { PersistentVolumeClaim } from "../types/v1/PersistentVolumeClaim";

const BIND_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Storage quantity parser
// ---------------------------------------------------------------------------

/** Parse a storage quantity string into bytes. */
function parseStorage(s: string): number {
    if (s.endsWith("Ki")) return parseInt(s.slice(0, -2), 10) * 1024;
    if (s.endsWith("Mi")) return parseInt(s.slice(0, -2), 10) * 1024 ** 2;
    if (s.endsWith("Gi")) return parseInt(s.slice(0, -2), 10) * 1024 ** 3;
    if (s.endsWith("Ti")) return parseInt(s.slice(0, -2), 10) * 1024 ** 4;
    if (s.endsWith("K"))  return parseInt(s.slice(0, -1), 10) * 1000;
    if (s.endsWith("M"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 2;
    if (s.endsWith("G"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 3;
    if (s.endsWith("T"))  return parseInt(s.slice(0, -1), 10) * 1000 ** 4;
    return parseInt(s, 10);
}

// ---------------------------------------------------------------------------
// PV matching logic
// ---------------------------------------------------------------------------

/**
 * Find the best-fit PV for a PVC.
 * Rules (in order):
 *   1. PV.status.phase must be "Available"
 *   2. If PVC.spec.volumeName is set, only that PV qualifies
 *   3. storageClassName must match (both empty counts as a match)
 *   4. PV.spec.accessModes ⊇ PVC.spec.accessModes (PV covers all requested modes)
 *   5. PV capacity ≥ PVC request (best-fit: pick smallest qualifying PV)
 */
function findBestPV(
    pvc: PersistentVolumeClaim,
    pvs: PersistentVolume[],
): PersistentVolume | undefined {
    const requestBytes = parseStorage(pvc.spec.resources.requests.storage);
    const pvcClass = pvc.spec.storageClassName ?? "";

    const candidates = pvs.filter(pv => {
        if (pv.status.phase !== "Available") return false;
        if (pvc.spec.volumeName && pv.metadata.name !== pvc.spec.volumeName) return false;
        const pvClass = pv.spec.storageClassName ?? "";
        if (pvClass !== pvcClass) return false;
        const allModesSupported = pvc.spec.accessModes.every(m =>
            pv.spec.accessModes.includes(m),
        );
        if (!allModesSupported) return false;
        const pvBytes = parseStorage(pv.spec.capacity.storage);
        if (pvBytes < requestBytes) return false;
        return true;
    });

    if (candidates.length === 0) return undefined;

    // Best-fit: smallest PV that satisfies the request
    return candidates.reduce((best, pv) =>
        parseStorage(pv.spec.capacity.storage) < parseStorage(best.spec.capacity.storage)
            ? pv
            : best,
    );
}

// ---------------------------------------------------------------------------
// usePVCBinder
// ---------------------------------------------------------------------------

/**
 * Simulates the Kubernetes PersistentVolume controller.
 * Watches for Pending PVCs and binds them to the best-fit Available PV.
 */
export function usePVCBinder(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { PersistentVolumeClaims, PersistentVolumes } = state;
    const boundRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        const pendingPVCs = PersistentVolumeClaims.filter(
            pvc => pvc.status.phase === "Pending" &&
                !boundRef.current.has(pvc.metadata.uid),
        );

        for (const pvc of pendingPVCs) {
            const best = findBestPV(pvc, PersistentVolumes);
            if (!best) continue; // No suitable PV yet — retry on next state change

            // Mark as being bound now (prevents duplicate binds during the timer window)
            boundRef.current.add(pvc.metadata.uid);

            timersRef.current.push(setTimeout(() => {
                dispatch(bindPVC(pvc.metadata.name, pvc.metadata.namespace, best.metadata.name));
            }, BIND_DELAY_MS));
        }
    }, [PersistentVolumeClaims, PersistentVolumes, dispatch]);

    useEffect(() => {
        const timers = timersRef.current;
        const bound = boundRef.current;
        return () => {
            timers.forEach(clearTimeout);
            bound.clear();
        };
    }, []);
}
