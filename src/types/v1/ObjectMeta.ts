/** Mirrors k8s.io/apimachinery/pkg/apis/meta/v1.OwnerReference */
export interface OwnerReference {
    apiVersion: string;
    kind: string;
    name: string;
    uid: string;
    controller?: boolean;
    blockOwnerDeletion?: boolean;
}
