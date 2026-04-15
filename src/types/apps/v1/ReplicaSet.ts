import type { PodTemplateSpec } from "../../v1/Pod";
import type { OwnerReference } from "../../v1/ObjectMeta";

export interface ReplicaSet {
    metadata: ReplicaSetMetadata;
    spec: ReplicaSetSpec;
    status: ReplicaSetStatus;
}

export interface ReplicaSetMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    ownerReferences?: OwnerReference[];
    creationTimestamp: string;
    generation: number;
}

export interface ReplicaSetStatus {
    observedGeneration: number; // The most recent generation observed by the replicaset controller
    replicas: number; // Number of replicas currently running
    readyReplicas: number; // Number of replicas that are ready
    availableReplicas: number; // Number of replicas that are available
}

export interface ReplicaSetSpec {
    replicas: number; // Desired number of replicas
    selector: LabelSelector; // Label selector to identify the pods managed by this replicaset
    template: PodTemplateSpec; // Template for the pods to be created
}

export interface LabelSelector {
    matchLabels: Record<string, string>; // A map of {key: value} pairs to match against the labels of pods
}
