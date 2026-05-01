export interface KubeEvent {
    metadata: EventMetadata;
    involvedObject: EventInvolvedObject;
    reason: string;
    message: string;
    type: "Normal" | "Warning";
    firstTimestamp: string;
    lastTimestamp: string;
    count: number;
    source?: EventSource;
}

export interface EventMetadata {
    uid: string;
    name: string;
    namespace: string;
    creationTimestamp: string;
}

export interface EventInvolvedObject {
    kind: string;
    name: string;
    namespace: string;
    uid?: string;
}

export interface EventSource {
    component?: string;
    host?: string;
}
