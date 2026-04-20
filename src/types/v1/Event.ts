export interface KubeEvent {
    uid: string;
    namespace: string;
    involvedObject: {
        kind: string;
        name: string;
        namespace: string;
    };
    reason: string;
    message: string;
    type: "Normal" | "Warning";
    firstTimestamp: string;
    lastTimestamp: string;
    count: number;
}
