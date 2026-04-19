import type { AccessMode } from "./PersistentVolume";

export interface PersistentVolumeClaim {
    metadata: PVCMetadata;
    spec: PVCSpec;
    status: PVCStatus;
}

export interface PVCMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}

export interface PVCSpec {
    accessModes: AccessMode[];
    resources: { requests: { storage: string } };
    storageClassName?: string;
    volumeName?: string;
    volumeMode?: "Filesystem" | "Block";
}

export interface PVCStatus {
    phase: "Pending" | "Bound" | "Lost";
    capacity?: { storage: string };
    accessModes?: AccessMode[];
    boundVolume?: string; // Name of the bound PV
}
