export type AccessMode = "ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany" | "ReadWriteOncePod";

export interface NodeSelectorRequirement {
    key: string;
    operator: "In" | "NotIn" | "Exists" | "DoesNotExist";
    values?: string[];
}

export interface NodeSelectorTerm {
    matchExpressions?: NodeSelectorRequirement[];
    matchFields?: NodeSelectorRequirement[];
}

export interface PersistentVolume {
    metadata: PVMetadata;
    spec: PVSpec;
    status: PVStatus;
}

export interface PVMetadata {
    uid: string;
    name: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
    // PVs are cluster-scoped — no namespace
}

export interface PVSpec {
    capacity: { storage: string };
    accessModes: AccessMode[];
    persistentVolumeReclaimPolicy: "Retain" | "Delete";
    storageClassName?: string;
    volumeMode?: "Filesystem" | "Block";
    claimRef?: { name: string; namespace: string; uid?: string };
    nodeAffinity?: {
        required: { nodeSelectorTerms: NodeSelectorTerm[] };
    };
    // Volume sources (at most one will be set)
    hostPath?: { path: string; type?: string };
    nfs?: { server: string; path: string; readOnly?: boolean };
    local?: { path: string; fsType?: string };
}

export interface PVStatus {
    phase: "Available" | "Bound" | "Released" | "Failed";
    message?: string;
    reason?: string;
}
