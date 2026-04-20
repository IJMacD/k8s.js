export interface StorageClass {
    metadata: StorageClassMetadata;
    provisioner: string;
    reclaimPolicy: "Retain" | "Delete";
    volumeBindingMode: "Immediate" | "WaitForFirstConsumer";
    allowVolumeExpansion?: boolean;
    parameters?: Record<string, string>;
}

export interface StorageClassMetadata {
    uid: string;
    name: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
    // StorageClasses are cluster-scoped — no namespace
}
