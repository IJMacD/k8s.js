export interface Pod {
    metadata: PodMetadata;
    status: PodStatus;
    spec: PodSpec;
}

export interface PodTemplateSpec {
    metadata: PodTemplateMetadata;
    spec: PodSpec;
}

import type { OwnerReference } from "./ObjectMeta";

export interface PodTemplateMetadata {
    namespace: string;
    name: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: OwnerReference[];
}

export interface PodMetadata extends PodTemplateMetadata {
    uid: string;
    creationTimestamp: string; // ISO 8601 format timestamp indicating when the pod was created
}

export interface PodStatus {
    phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown"; // Current phase of the pod
    conditions?: PodCondition[]; // Optional list of conditions that describe the current state of the pod
    hostIP?: string; // Optional IP address of the node hosting the pod
    podIP?: string; // Optional IP address assigned to the pod
    startTime?: string; // Optional ISO 8601 format timestamp indicating when the pod started running
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
}

export interface ContainerStatus {
    name: string;
    ready: boolean;
    started: boolean;
    restartCount: number;
    state: ContainerState;
}

export interface ContainerState {
    running?: { startedAt: string };
    waiting?: { reason: string };
    terminated?: { exitCode: number; reason?: string };
}

export interface PodCondition {
    type: string; // Type of condition (e.g., "Ready", "Initialized")
    status: "True" | "False" | "Unknown"; // Status of the condition
    lastProbeTime?: string; // Optional ISO 8601 format timestamp indicating when the condition was last probed
    lastTransitionTime?: string; // Optional ISO 8601 format timestamp indicating when the condition last transitioned from one status to another
}

export interface PodSpec {
    nodeName?: string; // Name of the node the pod is scheduled on
    nodeSelector?: Record<string, string>; // Node label selector constraints for scheduling
    restartPolicy?: "Always" | "OnFailure" | "Never";
    initContainers?: Container[]; // Optional list of init containers that run before app containers
    containers: Container[]; // List of containers that will be part of the pod
}

export interface Probe {
    initialDelaySeconds?: number; // Seconds after container start before the probe is first run
    periodSeconds?: number;       // How often (in seconds) to perform the probe
    timeoutSeconds?: number;      // Seconds after which the probe times out
    successThreshold?: number;
    failureThreshold?: number;
    httpGet?: { path: string; port: number | string; scheme?: "HTTP" | "HTTPS" };
    tcpSocket?: { port: number | string };
    exec?: { command: string[] };
}

export interface Container {
    name: string; // Name of the container
    image: string; // Docker image to be used for the container
    ports?: ContainerPort[]; // Optional list of ports to be exposed by the container
    env?: EnvRecord[]; // Optional list of environment variables for the container
    resources?: ResourceRequirements; // Optional resource requirements for the container
    readinessProbe?: Probe;
    livenessProbe?: Probe;
    startupProbe?: Probe;
}

export interface ContainerPort {
    name?: string;          // Optional named port (e.g. "http", "metrics")
    containerPort: number; // Port number to be exposed by the container
    protocol?: "TCP" | "UDP"; // Protocol for the port
}

export interface ResourceRequirements {
    limits?: ResourceList; // Optional resource limits for the container
    requests?: ResourceList; // Optional resource requests for the container
}

export interface ResourceList {
    cpu?: string; // CPU resource quantity
    memory?: string; // Memory resource quantity
}

export interface EnvRecord {
    name: string; // Name of the environment variable
    value?: string; // Value of the environment variable
    valueFrom?: EnvVarSource; // Optional source for the environment variable's value
}

export interface EnvVarSource {
    configMapKeyRef?: ConfigMapKeySelector; // Optional reference to a key in a ConfigMap
    secretKeyRef?: SecretKeySelector; // Optional reference to a key in a Secret
    fieldRef?: ObjectFieldSelector; // Optional reference to a field in the pod's metadata or status
}

export interface ConfigMapKeySelector {
    name: string; // Name of the ConfigMap
    key: string; // Key within the ConfigMap to be used as the value of the environment variable
}

export interface SecretKeySelector {
    name: string; // Name of the Secret
    key: string; // Key within the Secret to be used as the value of the environment variable
}

export interface ObjectFieldSelector {
    apiVersion: string; // API version of the field to be used as the value of the environment variable (e.g., "v1")
    fieldPath: string; // Path of the field to be used as the value of the environment variable (e.g., "metadata.name")
}
