export interface Secret {
    metadata: SecretMetadata;
    type: string;
    data: Record<string, string>;
    stringData?: Record<string, string>;
}

export interface SecretMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}
