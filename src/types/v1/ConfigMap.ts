export interface ConfigMap {
    metadata: ConfigMapMetadata;
    data: Record<string, string>;
    binaryData?: Record<string, string>;
}

export interface ConfigMapMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}
