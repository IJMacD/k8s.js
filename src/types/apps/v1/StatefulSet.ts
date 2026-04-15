import type { PodTemplateSpec } from "../../v1/Pod";

export interface StatefulSet {
    metadata: StatefulSetMetadata;
    spec: StatefulSetSpec;
    status: StatefulSetStatus;
}

export interface StatefulSetMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
    generation: number;
}

export interface StatefulSetSpec {
    replicas: number;
    selector: { matchLabels: Record<string, string> };
    template: PodTemplateSpec;
    serviceName: string;
    podManagementPolicy?: "OrderedReady" | "Parallel";
    updateStrategy?: { type: "RollingUpdate" | "OnDelete" };
    revisionHistoryLimit?: number;
}

export interface StatefulSetStatus {
    observedGeneration: number;
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    updatedReplicas: number;
    currentRevision?: string;
    updateRevision?: string;
    collisionCount?: number;
}
