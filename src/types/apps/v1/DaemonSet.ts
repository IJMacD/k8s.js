import type { PodTemplateSpec } from "../../v1/Pod";

export interface DaemonSet {
    metadata: DaemonSetMetadata;
    spec: DaemonSetSpec;
    status: DaemonSetStatus;
}

export interface DaemonSetMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
    generation: number;
}

export interface DaemonSetSpec {
    selector: LabelSelector;
    template: PodTemplateSpec;
    updateStrategy: DaemonSetUpdateStrategy;
}

export interface LabelSelector {
    matchLabels: Record<string, string>;
}

export interface DaemonSetUpdateStrategy {
    type: "RollingUpdate" | "OnDelete";
}

export interface DaemonSetStatus {
    desiredNumberScheduled: number;
    currentNumberScheduled: number;
    numberReady: number;
    numberAvailable: number;
    updatedNumberScheduled: number;
    observedGeneration: number;
}
