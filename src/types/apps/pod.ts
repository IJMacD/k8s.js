export interface Pod {
    metadata: PodMetadata;
    spec: PodSpec;
}

export interface PodMetadata {
    namespace: string;
    name: string;
    uid: string;
    labels?: Record<string, string>; // A map of {key: value} pairs to categorize the pod
    annotations?: Record<string, string>; // A map of {key: value} pairs to store arbitrary metadata about the pod
    creationTimestamp: string; // ISO 8601 format timestamp indicating when the pod was created
}

export interface PodSpec {
    containers: Container[]; // List of containers that will be part of the pod
}

export interface Container {
    name: string; // Name of the container
    image: string; // Docker image to be used for the container
    ports?: ContainerPort[]; // Optional list of ports to be exposed by the container
    env?: EnvRecord[]; // Optional list of environment variables for the container
    resources?: ResourceRequirements; // Optional resource requirements for the container
}

export interface ContainerPort {
    containerPort: number; // Port number to be exposed by the container
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
