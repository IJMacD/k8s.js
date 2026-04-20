/**
 * Canonical map from every accepted resource alias to its normalised singular kind.
 * A single source of truth used by kubectl-get-yaml, kubectl-edit, kubectl-delete,
 * kubectl-patch, kubectl-annotate, and kubectl-label.
 */
export const kindAliases: Record<string, string> = {
    pods: "pod", pod: "pod", po: "pod",
    deployments: "deployment", deployment: "deployment", deploy: "deployment",
    replicasets: "replicaset", replicaset: "replicaset", rs: "replicaset",
    daemonsets: "daemonset", daemonset: "daemonset", ds: "daemonset",
    statefulsets: "statefulset", statefulset: "statefulset", sts: "statefulset",
    services: "service", service: "service", svc: "service",
    endpoints: "endpoints", endpoint: "endpoints", ep: "endpoints",
    nodes: "node", node: "node",
    jobs: "job", job: "job",
    cronjobs: "cronjob", cronjob: "cronjob", cj: "cronjob",
    configmaps: "configmap", configmap: "configmap", cm: "configmap",
    secrets: "secret", secret: "secret",
    persistentvolumes: "persistentvolume", persistentvolume: "persistentvolume", pv: "persistentvolume",
    persistentvolumeclaims: "persistentvolumeclaim", persistentvolumeclaim: "persistentvolumeclaim", pvc: "persistentvolumeclaim",
    storageclasses: "storageclass", storageclass: "storageclass", sc: "storageclass",
};
