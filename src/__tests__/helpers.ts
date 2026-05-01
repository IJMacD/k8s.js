import type { AppState } from "../store/store";
import type { Pod } from "../types/v1/Pod";
import type { PersistentVolume } from "../types/v1/PersistentVolume";
import type { PersistentVolumeClaim } from "../types/v1/PersistentVolumeClaim";
import type { ConfigMap } from "../types/v1/ConfigMap";

/**
 * Creates a minimal initial state for testing
 */
export function createTestState(): AppState {
    return {
        Deployments: [],
        ReplicaSets: [],
        DaemonSets: [],
        StatefulSets: [],
        Pods: [],
        Services: [],
        Endpoints: [],
        Nodes: [],
        Jobs: [],
        CronJobs: [],
        ConfigMaps: [],
        Secrets: [],
        PersistentVolumes: [],
        PersistentVolumeClaims: [],
        StorageClasses: [],
        Events: [],
        Filesystems: {
            Ephemeral: {},
            PVFilesystems: {},
            EmptyDir: {},
        },
    };
}

/**
 * Creates a test pod with specified containers and volumes
 */
export function createTestPod(
    name: string,
    namespace: string,
    containers: Array<{
        name: string;
        volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }>;
    }>,
    volumes?: Array<{
        name: string;
        type: "configMap" | "secret" | "emptyDir" | "pvc";
        configMapName?: string;
        secretName?: string;
        claimName?: string;
    }>,
): Pod {
    const pod: Pod = {
        metadata: {
            name,
            namespace,
            uid: crypto.randomUUID(),
            labels: {},
            annotations: {},
            creationTimestamp: new Date().toISOString(),
        },
        spec: {
            containers: containers.map(c => ({
                name: c.name,
                image: "nginx:latest",
                volumeMounts: c.volumeMounts,
            })),
            volumes: volumes?.map(v => {
                if (v.type === "configMap") {
                    return { name: v.name, configMap: { name: v.configMapName! } };
                } else if (v.type === "secret") {
                    return { name: v.name, secret: { secretName: v.secretName! } };
                } else if (v.type === "emptyDir") {
                    return { name: v.name, emptyDir: {} };
                } else if (v.type === "pvc") {
                    return { name: v.name, persistentVolumeClaim: { claimName: v.claimName! } };
                }
                return { name: v.name, emptyDir: {} };
            }),
        },
        status: {
            phase: "Running",
            podIP: "10.244.0.1",
            hostIP: "192.168.1.1",
        },
    };
    return pod;
}

/**
 * Creates a test ConfigMap
 */
export function createTestConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
): ConfigMap {
    return {
        metadata: {
            name,
            namespace,
            uid: crypto.randomUUID(),
            labels: {},
            annotations: {},
            creationTimestamp: new Date().toISOString(),
        },
        data,
    };
}

/**
 * Creates a test PersistentVolume
 */
export function createTestPV(name: string, capacity: string): PersistentVolume {
    return {
        metadata: {
            name,
            uid: crypto.randomUUID(),
            labels: {},
            annotations: {},
            creationTimestamp: new Date().toISOString(),
        },
        spec: {
            capacity: { storage: capacity },
            accessModes: ["ReadWriteMany"],
            persistentVolumeReclaimPolicy: "Retain",
            storageClassName: "standard",
            hostPath: { path: `/mnt/${name}` },
        },
        status: {
            phase: "Available",
        },
    };
}

/**
 * Creates a test PersistentVolumeClaim
 */
export function createTestPVC(
    name: string,
    namespace: string,
    volumeName?: string,
): PersistentVolumeClaim {
    return {
        metadata: {
            name,
            namespace,
            uid: crypto.randomUUID(),
            labels: {},
            annotations: {},
            creationTimestamp: new Date().toISOString(),
        },
        spec: {
            accessModes: ["ReadWriteMany"],
            resources: { requests: { storage: "1Gi" } },
            volumeName,
        },
        status: volumeName ? { phase: "Bound" } : { phase: "Pending" },
    };
}
