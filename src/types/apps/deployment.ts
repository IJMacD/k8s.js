import type { PodTemplateSpec } from "./Pod";

export interface Deployment {
    metadata: DeploymentMetadata;
    spec: DeploymentSpec;
    status: DeploymentStatus;
}

export interface DeploymentMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string; // ISO 8601 format
    generation: number; // A sequence number representing the generation of the deployment
}
export interface DeploymentStatus {
    observedGeneration: number; // The most recent generation observed by the deployment controller
    replicas: number; // Number of replicas currently running
    updatedReplicas: number; // Number of replicas that have been updated to the desired state
    readyReplicas: number; // Number of replicas that are ready
    availableReplicas: number; // Number of replicas that are available
}

export interface DeploymentSpec {
    replicas: number; // Desired number of replicas
    selector: LabelSelector; // Label selector to identify the pods managed by this deployment
    template: PodTemplateSpec; // Template for the pods to be created
    strategy: DeploymentStrategy; // Strategy for updating the deployment
    revisionHistoryLimit?: number; // Optional limit on the number of old ReplicaSets to retain
}

export interface LabelSelector {
    matchLabels: Record<string, string>; // A map of {key: value} pairs to match against the labels of pods
}

export interface DeploymentStrategy {
    type: "RollingUpdate" | "Recreate"; // Type of deployment strategy
    rollingUpdate?: RollingUpdateDeployment; // Details for rolling update strategy
}

export interface RollingUpdateDeployment {
    maxUnavailable: string; // Maximum number of pods that can be unavailable during the update (e.g., "25%")
    maxSurge: string; // Maximum number of pods that can be created above the desired number of replicas during the update (e.g., "25%")
}