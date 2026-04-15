export interface KubeNode {
    metadata: NodeMetadata;
    spec: NodeSpec;
    status: NodeStatus;
}

export interface NodeMetadata {
    uid: string;
    name: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}

export interface NodeSpec {
    unschedulable: boolean;
    podCIDR?: string; // e.g. "10.244.0.0/24"
}

export interface NodeStatus {
    conditions: NodeCondition[];
    capacity: NodeResources;
    allocatable: NodeResources;
    /** Hostname or IP used to reach the node */
    addresses: NodeAddress[];
}

export interface NodeCondition {
    type: "Ready" | "MemoryPressure" | "DiskPressure" | "PIDPressure";
    status: "True" | "False" | "Unknown";
    lastTransitionTime: string;
    reason?: string;
    message?: string;
}

export interface NodeResources {
    cpu: string;   // e.g. "4"
    memory: string; // e.g. "8Gi"
    pods: string;   // e.g. "110"
}

export interface NodeAddress {
    type: "InternalIP" | "Hostname";
    address: string;
}
