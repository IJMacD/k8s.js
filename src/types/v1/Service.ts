export type ServiceType = "ClusterIP" | "NodePort" | "LoadBalancer";

export interface Service {
    metadata: ServiceMetadata;
    spec: ServiceSpec;
    status: ServiceStatus;
}

export interface ServiceMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}

export interface ServiceSpec {
    type: ServiceType;
    selector: Record<string, string>;
    ports: ServicePort[];
    clusterIP: string;
}

export interface ServicePort {
    name?: string;
    port: number;
    targetPort: number | string;  // number = port number, string = named container port
    protocol: "TCP" | "UDP";
    nodePort?: number;
}

export interface ServiceStatus {
    loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> };
}

// ---------------------------------------------------------------------------

export interface Endpoints {
    metadata: {
        name: string;
        namespace: string;
    };
    subsets: EndpointSubset[];
}

export interface EndpointSubset {
    addresses: EndpointAddress[];
    ports: Array<{ port: number; protocol: "TCP" | "UDP" }>;
}

export interface EndpointAddress {
    ip: string;
    targetRef?: { kind: "Pod"; name: string; namespace: string };
}
