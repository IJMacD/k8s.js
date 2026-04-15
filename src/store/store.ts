import type { Deployment } from "../types/apps/v1/Deployment";
import type { Pod } from "../types/v1/Pod";
import type { ReplicaSet } from "../types/apps/v1/ReplicaSet";
import type { DaemonSet } from "../types/apps/v1/DaemonSet";
import type { StatefulSet } from "../types/apps/v1/StatefulSet";
import type { Service, Endpoints } from "../types/v1/Service";
import type { KubeNode } from "../types/v1/Node";
import type { Job, CronJob } from "../types/batch/v1/Job";
import type { OwnerReference } from "../types/v1/ObjectMeta";

export interface AppState {
    Deployments: Deployment[];
    ReplicaSets: ReplicaSet[];
    DaemonSets: DaemonSet[];
    StatefulSets: StatefulSet[];
    Pods: Pod[];
    Services: Service[];
    Endpoints: Endpoints[];
    Nodes: KubeNode[];
    Jobs: Job[];
    CronJobs: CronJob[];
}

const CreateDeploymentType = "CREATE_DEPLOYMENT";
const CreatePodType = "CREATE_POD";
const DeletePodType = "DELETE_POD";
const ScaleDeploymentType = "SCALE_DEPLOYMENT";
const CreateReplicaSetType = "CREATE_REPLICASET";
const ScaleReplicaSetType = "SCALE_REPLICASET";
const UpdatePodStatusType = "UPDATE_POD_STATUS";
const UpdateReplicaSetStatusType = "UPDATE_REPLICASET_STATUS";
const UpdateDeploymentStatusType = "UPDATE_DEPLOYMENT_STATUS";
const SetDeploymentImageType = "SET_DEPLOYMENT_IMAGE";
const CreateServiceType = "CREATE_SERVICE";
const UpdateEndpointsType = "UPDATE_ENDPOINTS";
const CreateNodeType = "CREATE_NODE";
const UpdateNodeSpecType = "UPDATE_NODE_SPEC";
const BindPodToNodeType = "BIND_POD_TO_NODE";
const CreateJobType = "CREATE_JOB";
const UpdateJobStatusType = "UPDATE_JOB_STATUS";
const CreateCronJobType = "CREATE_CRONJOB";
const UpdateCronJobStatusType = "UPDATE_CRONJOB_STATUS";
const DeleteDeploymentType = "DELETE_DEPLOYMENT";
const DeleteReplicaSetType = "DELETE_REPLICASET";
const DeleteServiceType = "DELETE_SERVICE";
const DeleteJobType = "DELETE_JOB";
const DeleteCronJobType = "DELETE_CRONJOB";
const CreateDaemonSetType = "CREATE_DAEMONSET";
const DeleteDaemonSetType = "DELETE_DAEMONSET";
const UpdateDaemonSetStatusType = "UPDATE_DAEMONSET_STATUS";
const CreateStatefulSetType = "CREATE_STATEFULSET";
const DeleteStatefulSetType = "DELETE_STATEFULSET";
const UpdateStatefulSetStatusType = "UPDATE_STATEFULSET_STATUS";
const ScaleStatefulSetType = "SCALE_STATEFULSET";
const PatchResourceType = "PATCH_RESOURCE";

export type ActionType =
    | typeof CreateDeploymentType
    | typeof CreatePodType
    | typeof DeletePodType
    | typeof ScaleDeploymentType
    | typeof CreateReplicaSetType
    | typeof ScaleReplicaSetType
    | typeof UpdatePodStatusType
    | typeof UpdateReplicaSetStatusType
    | typeof UpdateDeploymentStatusType
    | typeof SetDeploymentImageType
    | typeof CreateServiceType
    | typeof UpdateEndpointsType
    | typeof CreateNodeType
    | typeof UpdateNodeSpecType
    | typeof BindPodToNodeType
    | typeof CreateJobType
    | typeof UpdateJobStatusType
    | typeof CreateCronJobType
    | typeof UpdateCronJobStatusType
    | typeof DeleteDeploymentType
    | typeof DeleteReplicaSetType
    | typeof DeleteServiceType
    | typeof DeleteJobType
    | typeof DeleteCronJobType
    | typeof CreateDaemonSetType
    | typeof DeleteDaemonSetType
    | typeof UpdateDaemonSetStatusType
    | typeof CreateStatefulSetType
    | typeof DeleteStatefulSetType
    | typeof UpdateStatefulSetStatusType
    | typeof ScaleStatefulSetType
    | typeof PatchResourceType;

export interface CreateDeploymentAction {
    type: typeof CreateDeploymentType;
    payload: { name: string; namespace: string; image: string; replicas: number; containers?: import("../types/v1/Pod").Container[] };
}

export interface CreatePodAction {
    type: typeof CreatePodType;
    payload: {
        name: string;
        namespace: string;
        image: string;
        containerName?: string;
        ports?: Array<{ name?: string; containerPort: number; protocol?: "TCP" | "UDP" }>;
        env?: import("../types/v1/Pod").EnvRecord[];
        labels?: Record<string, string>;
        restartPolicy?: "Always" | "OnFailure" | "Never";
        nodeName?: string;
        creationTimestamp: string;
        ownerReferences?: OwnerReference[];
    };
}

export interface CreateDaemonSetAction {
    type: typeof CreateDaemonSetType;
    payload: { name: string; namespace: string; image: string; containers?: import("../types/v1/Pod").Container[] };
}

export interface CreateStatefulSetAction {
    type: typeof CreateStatefulSetType;
    payload: { name: string; namespace: string; image: string; replicas: number; serviceName: string; containers?: import("../types/v1/Pod").Container[] };
}

export interface UpdateStatefulSetStatusAction {
    type: typeof UpdateStatefulSetStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("../types/apps/v1/StatefulSet").StatefulSetStatus>;
    };
}

export interface UpdateDaemonSetStatusAction {
    type: typeof UpdateDaemonSetStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("../types/apps/v1/DaemonSet").DaemonSetStatus>;
    };
}

export interface CreateJobAction {
    type: typeof CreateJobType;
    payload: {
        name: string;
        namespace: string;
        image: string;
        completions: number;
        parallelism: number;
        backoffLimit: number;
        ownerReferences?: OwnerReference[];
        creationTimestamp: string;
        containers?: import("../types/v1/Pod").Container[];
    };
}

export interface UpdateJobStatusAction {
    type: typeof UpdateJobStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("../types/batch/v1/Job").JobStatus>;
    };
}

export interface CreateCronJobAction {
    type: typeof CreateCronJobType;
    payload: {
        name: string;
        namespace: string;
        image: string;
        schedule: string;
        completions: number;
        parallelism: number;
        backoffLimit: number;
        creationTimestamp: string;
        containers?: import("../types/v1/Pod").Container[];
    };
}

export interface UpdateCronJobStatusAction {
    type: typeof UpdateCronJobStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("../types/batch/v1/Job").CronJobStatus>;
    };
}

export interface CreateServiceAction {
    type: typeof CreateServiceType;
    payload: {
        name: string;
        namespace: string;
        selector: Record<string, string>;
        ports: Array<{ name?: string; port: number; targetPort: number | string; protocol?: "TCP" | "UDP" }>;
        clusterIP: string;
        serviceType: import("../types/v1/Service").ServiceType;
    };
}

export function createService(
    name: string,
    payload: Omit<CreateServiceAction["payload"], "name" | "namespace">,
    namespace = "default",
): CreateServiceAction {
    return { type: CreateServiceType, payload: { name, namespace, ...payload } };
}

export interface UpdateEndpointsAction {
    type: typeof UpdateEndpointsType;
    payload: import("../types/v1/Service").Endpoints;
}

export function updateEndpoints(endpoints: import("../types/v1/Service").Endpoints): UpdateEndpointsAction {
    return { type: UpdateEndpointsType, payload: endpoints };
}

export interface CreateNodeAction {
    type: typeof CreateNodeType;
    payload: {
        name: string;
        cpu: string;
        memory: string;
        internalIP: string;
    };
}

export function createNode(
    name: string,
    resources: { cpu: string; memory: string; internalIP: string },
): CreateNodeAction {
    return { type: CreateNodeType, payload: { name, ...resources } };
}

export interface UpdateNodeSpecAction {
    type: typeof UpdateNodeSpecType;
    payload: { name: string; patch: Partial<import("../types/v1/Node").NodeSpec> };
}

export function updateNodeSpec(
    name: string,
    patch: Partial<import("../types/v1/Node").NodeSpec>,
): UpdateNodeSpecAction {
    return { type: UpdateNodeSpecType, payload: { name, patch } };
}

export interface BindPodToNodeAction {
    type: typeof BindPodToNodeType;
    payload: { podName: string; namespace: string; nodeName: string };
}

export function bindPodToNode(
    podName: string,
    namespace: string,
    nodeName: string,
): BindPodToNodeAction {
    return { type: BindPodToNodeType, payload: { podName, namespace, nodeName } };
}

export interface SetDeploymentImageAction {
    type: typeof SetDeploymentImageType;
    payload: { name: string; namespace: string; container: string; image: string };
}

export function setDeploymentImage(
    name: string,
    container: string,
    image: string,
    namespace = "default",
): SetDeploymentImageAction {
    return { type: SetDeploymentImageType, payload: { name, namespace, container, image } };
}

export type Action =
    | CreateDeploymentAction
    | CreatePodAction
    | DeletePodAction
    | ScaleDeploymentAction
    | CreateReplicaSetAction
    | ScaleReplicaSetAction
    | UpdatePodStatusAction
    | UpdateReplicaSetStatusAction
    | UpdateDeploymentStatusAction
    | SetDeploymentImageAction
    | CreateServiceAction
    | UpdateEndpointsAction
    | CreateNodeAction
    | UpdateNodeSpecAction
    | BindPodToNodeAction
    | CreateJobAction
    | UpdateJobStatusAction
    | CreateCronJobAction
    | UpdateCronJobStatusAction
    | { type: typeof DeleteDeploymentType; payload: { name: string; namespace: string } }
    | { type: typeof DeleteReplicaSetType; payload: { name: string; namespace: string } }
    | { type: typeof DeleteServiceType; payload: { name: string; namespace: string } }
    | { type: typeof DeleteJobType; payload: { name: string; namespace: string } }
    | { type: typeof DeleteCronJobType; payload: { name: string; namespace: string } }
    | CreateDaemonSetAction
    | UpdateDaemonSetStatusAction
    | { type: typeof DeleteDaemonSetType; payload: { name: string; namespace: string } }
    | CreateStatefulSetAction
    | UpdateStatefulSetStatusAction
    | { type: typeof ScaleStatefulSetType; payload: { name: string; namespace: string; replicas: number } }
    | { type: typeof DeleteStatefulSetType; payload: { name: string; namespace: string } }
    | { type: typeof PatchResourceType; payload: { kind: string; name: string; namespace: string; patch: Record<string, unknown> } };

export function deleteDeployment(name: string, namespace = "default") {
    return { type: DeleteDeploymentType as typeof DeleteDeploymentType, payload: { name, namespace } };
}
export function deleteReplicaSet(name: string, namespace = "default") {
    return { type: DeleteReplicaSetType as typeof DeleteReplicaSetType, payload: { name, namespace } };
}
export function deleteService(name: string, namespace = "default") {
    return { type: DeleteServiceType as typeof DeleteServiceType, payload: { name, namespace } };
}
export function deleteJob(name: string, namespace = "default") {
    return { type: DeleteJobType as typeof DeleteJobType, payload: { name, namespace } };
}
export function deleteCronJob(name: string, namespace = "default") {
    return { type: DeleteCronJobType as typeof DeleteCronJobType, payload: { name, namespace } };
}

export function createDaemonSet(
    name: string,
    spec: { image: string; containers?: import("../types/v1/Pod").Container[] },
    namespace = "default",
): CreateDaemonSetAction {
    return { type: CreateDaemonSetType, payload: { name, namespace, image: spec.image, containers: spec.containers } };
}

export function deleteDaemonSet(name: string, namespace = "default") {
    return { type: DeleteDaemonSetType as typeof DeleteDaemonSetType, payload: { name, namespace } };
}

export function createStatefulSet(
    name: string,
    spec: { image: string; replicas?: number; serviceName?: string; containers?: import("../types/v1/Pod").Container[] },
    namespace = "default",
): CreateStatefulSetAction {
    return {
        type: CreateStatefulSetType,
        payload: {
            name,
            namespace,
            image: spec.image,
            replicas: spec.replicas ?? 1,
            serviceName: spec.serviceName ?? name,
            containers: spec.containers,
        },
    };
}

export function deleteStatefulSet(name: string, namespace = "default") {
    return { type: DeleteStatefulSetType as typeof DeleteStatefulSetType, payload: { name, namespace } };
}

export function patchResource(
    kind: string,
    name: string,
    patch: Record<string, unknown>,
    namespace = "default",
) {
    return { type: PatchResourceType as typeof PatchResourceType, payload: { kind, name, namespace, patch } };
}

export function scaleStatefulSet(name: string, replicas: number, namespace = "default") {
    return { type: ScaleStatefulSetType as typeof ScaleStatefulSetType, payload: { name, namespace, replicas } };
}

export function updateStatefulSetStatus(
    name: string,
    namespace: string,
    patch: Partial<import("../types/apps/v1/StatefulSet").StatefulSetStatus>,
): UpdateStatefulSetStatusAction {
    return { type: UpdateStatefulSetStatusType, payload: { name, namespace, patch } };
}

export function updateDaemonSetStatus(
    name: string,
    namespace: string,
    patch: Partial<import("../types/apps/v1/DaemonSet").DaemonSetStatus>,
): UpdateDaemonSetStatusAction {
    return { type: UpdateDaemonSetStatusType, payload: { name, namespace, patch } };
}

export function createJob(
    name: string,
    spec: { image: string; completions?: number; parallelism?: number; backoffLimit?: number; containers?: import("../types/v1/Pod").Container[] },
    namespace = "default",
    ownerRef?: { kind: string; apiVersion: string; name: string; uid: string },
): CreateJobAction {
    return {
        type: CreateJobType,
        payload: {
            name,
            namespace,
            image: spec.image,
            completions: spec.completions ?? 1,
            parallelism: spec.parallelism ?? 1,
            backoffLimit: spec.backoffLimit ?? 6,
            containers: spec.containers,
            ownerReferences: ownerRef
                ? [{ ...ownerRef, controller: true, blockOwnerDeletion: true }]
                : undefined,
            creationTimestamp: new Date().toISOString(),
        },
    };
}

export function updateJobStatus(
    name: string,
    namespace: string,
    patch: Partial<import("../types/batch/v1/Job").JobStatus>,
): UpdateJobStatusAction {
    return { type: UpdateJobStatusType, payload: { name, namespace, patch } };
}

export function createCronJob(
    name: string,
    spec: { image: string; schedule: string; completions?: number; parallelism?: number; backoffLimit?: number; containers?: import("../types/v1/Pod").Container[] },
    namespace = "default",
): CreateCronJobAction {
    return {
        type: CreateCronJobType,
        payload: {
            name,
            namespace,
            image: spec.image,
            schedule: spec.schedule,
            completions: spec.completions ?? 1,
            parallelism: spec.parallelism ?? 1,
            backoffLimit: spec.backoffLimit ?? 6,
            containers: spec.containers,
            creationTimestamp: new Date().toISOString(),
        },
    };
}

export function updateCronJobStatus(
    name: string,
    namespace: string,
    patch: Partial<import("../types/batch/v1/Job").CronJobStatus>,
): UpdateCronJobStatusAction {
    return { type: UpdateCronJobStatusType, payload: { name, namespace, patch } };
}

export interface UpdateReplicaSetStatusAction {
    type: typeof UpdateReplicaSetStatusType;
    payload: { name: string; namespace: string; replicas: number; readyReplicas: number; availableReplicas: number };
}

export interface UpdateDeploymentStatusAction {
    type: typeof UpdateDeploymentStatusType;
    payload: { name: string; namespace: string; readyReplicas: number; availableReplicas: number; updatedReplicas: number };
}

export function updateReplicaSetStatus(
    name: string,
    namespace: string,
    status: Omit<UpdateReplicaSetStatusAction["payload"], "name" | "namespace">,
): UpdateReplicaSetStatusAction {
    return { type: UpdateReplicaSetStatusType, payload: { name, namespace, ...status } };
}

export function updateDeploymentStatus(
    name: string,
    namespace: string,
    status: Omit<UpdateDeploymentStatusAction["payload"], "name" | "namespace">,
): UpdateDeploymentStatusAction {
    return { type: UpdateDeploymentStatusType, payload: { name, namespace, ...status } };
}

export interface UpdatePodStatusAction {
    type: typeof UpdatePodStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("../types/v1/Pod").PodStatus>;
    };
}

export function updatePodStatus(
    name: string,
    namespace: string,
    patch: Partial<import("../types/v1/Pod").PodStatus>,
): UpdatePodStatusAction {
    return { type: UpdatePodStatusType, payload: { name, namespace, patch } };
}

export interface DeletePodAction {
    type: typeof DeletePodType;
    payload: { name: string; namespace: string };
}

export function deletePod(name: string, namespace = "default"): DeletePodAction {
    return { type: DeletePodType, payload: { name, namespace } };
}

export interface CreateReplicaSetAction {
    type: typeof CreateReplicaSetType;
    payload: {
        name: string;
        namespace: string;
        ownerRef: { name: string; uid: string };
        replicas: number;
        selector: { matchLabels: Record<string, string> };
        containers: import("../types/v1/Pod").Container[];
    };
}

export interface ScaleReplicaSetAction {
    type: typeof ScaleReplicaSetType;
    payload: { name: string; namespace: string; replicas: number };
}

export function createReplicaSet(
    payload: CreateReplicaSetAction["payload"],
): CreateReplicaSetAction {
    return { type: CreateReplicaSetType, payload };
}

export function scaleReplicaSet(
    name: string,
    replicas: number,
    namespace = "default",
): ScaleReplicaSetAction {
    return { type: ScaleReplicaSetType, payload: { name, namespace, replicas } };
}

export interface ScaleDeploymentAction {
    type: typeof ScaleDeploymentType;
    payload: { name: string; namespace: string; replicas: number };
}

export function scaleDeployment(
    name: string,
    replicas: number,
    namespace = "default",
): ScaleDeploymentAction {
    return {
        type: ScaleDeploymentType,
        payload: { name, namespace, replicas },
    };
}

export function createDeployment(
    name: string,
    spec: { image: string; replicas?: number; containers?: import("../types/v1/Pod").Container[] },
    namespace = "default",
): CreateDeploymentAction {
    return {
        type: CreateDeploymentType,
        payload: {
            name,
            namespace,
            image: spec.image,
            replicas: spec.replicas ?? 1,
            containers: spec.containers,
        },
    };
}

export function createPod(
    name: string,
    spec: { image: string; containerName?: string; ports?: Array<{ containerPort: number }>; env?: import("../types/v1/Pod").EnvRecord[]; labels?: Record<string, string>; restartPolicy?: "Always" | "OnFailure" | "Never"; nodeName?: string },
    namespace = "default",
    ownerRef?: { kind: string; apiVersion: string; name: string; uid: string },
): CreatePodAction {
    return {
        type: CreatePodType,
        payload: {
            name,
            namespace,
            image: spec.image,
            containerName: spec.containerName,
            ports: spec.ports,
            env: spec.env,
            labels: spec.labels,
            restartPolicy: spec.restartPolicy,
            nodeName: spec.nodeName,
            creationTimestamp: new Date().toISOString(),
            ownerReferences: ownerRef
                ? [{ ...ownerRef, controller: true, blockOwnerDeletion: true }]
                : undefined,
        },
    };
}

export const reducer = (state: AppState, action: Action): AppState => {
    if (action.type === CreateReplicaSetType) {
        const { name, namespace, ownerRef, replicas, selector, containers } = action.payload;
        const creationTimestamp = new Date().toISOString();
        return {
            ...state,
            ReplicaSets: [
                ...state.ReplicaSets,
                {
                    metadata: {
                        uid: crypto.randomUUID(),
                        name,
                        namespace,
                        labels: selector.matchLabels,
                        annotations: {},
                        ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: ownerRef.name, uid: ownerRef.uid, controller: true, blockOwnerDeletion: true }],
                        creationTimestamp,
                        generation: 1,
                    },
                    spec: {
                        replicas,
                        selector,
                        template: {
                            metadata: { name, namespace },
                            spec: { containers },
                        },
                    },
                    status: {
                        observedGeneration: 1,
                        replicas,
                        readyReplicas: 0,
                        availableReplicas: 0,
                    },
                },
            ],
        };
    }
    if (action.type === ScaleReplicaSetType) {
        const { name, namespace, replicas } = action.payload;
        return {
            ...state,
            ReplicaSets: state.ReplicaSets.map(rs =>
                rs.metadata.name === name && rs.metadata.namespace === namespace
                    ? {
                        ...rs,
                        spec: { ...rs.spec, replicas },
                        status: { ...rs.status, replicas, readyReplicas: 0, availableReplicas: 0 },
                    }
                    : rs
            ),
        };
    }
    if (action.type === SetDeploymentImageType) {
        const { name, namespace, container, image } = action.payload;
        return {
            ...state,
            Deployments: state.Deployments.map(d => {
                if (d.metadata.name !== name || d.metadata.namespace !== namespace) return d;
                return {
                    ...d,
                    metadata: { ...d.metadata, generation: d.metadata.generation + 1 },
                    spec: {
                        ...d.spec,
                        template: {
                            ...d.spec.template,
                            spec: {
                                ...d.spec.template.spec,
                                containers: d.spec.template.spec.containers.map(c =>
                                    c.name === container ? { ...c, image } : c
                                ),
                            },
                        },
                    },
                };
            }),
        };
    }
    if (action.type === ScaleDeploymentType) {
        const { name, namespace, replicas } = action.payload;
        return {
            ...state,
            Deployments: state.Deployments.map(d =>
                d.metadata.name === name && d.metadata.namespace === namespace
                    ? {
                        ...d,
                        spec: { ...d.spec, replicas },
                        status: {
                            ...d.status,
                            replicas,
                            readyReplicas: 0,
                            availableReplicas: 0,
                        },
                    }
                    : d
            ),
        };
    }
    if (action.type === CreateDeploymentType) {
        const { name, namespace, image, replicas, containers } = action.payload;
        const creationTimestamp = new Date().toISOString();
        return {
            ...state,
            Deployments: [
                ...state.Deployments,
                {
                    metadata: {
                        uid: crypto.randomUUID(),
                        name,
                        namespace,
                        labels: {},
                        annotations: {},
                        creationTimestamp,
                        generation: 1,
                    },
                    spec: {
                        replicas,
                        selector: { matchLabels: { app: name } },
                        template: {
                            metadata: {
                                name,
                                namespace,
                            },
                            spec: { containers: containers ?? [{ name, image }] },
                        },
                        strategy: { type: "RollingUpdate" },
                    },
                    status: {
                        observedGeneration: 1,
                        replicas,
                        updatedReplicas: 0,
                        readyReplicas: 0,
                        availableReplicas: 0,
                    },
                },
            ],
        };
    }
    if (action.type === DeletePodType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            Pods: state.Pods.filter(
                p => !(p.metadata.name === name && p.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === CreatePodType) {
        const { name, namespace, image, containerName, ports, env, labels, restartPolicy, nodeName, creationTimestamp, ownerReferences } = action.payload;
        return {
            ...state,
            Pods: [
                ...state.Pods,
                {
                    metadata: {
                        name,
                        namespace,
                        uid: crypto.randomUUID(),
                        creationTimestamp,
                        ...(labels && { labels }),
                        ...(ownerReferences && { ownerReferences }),
                    },
                    status: {
                        phase: "Pending",
                    },
                    spec: {
                        containers: [{ name: containerName ?? name, image, ...(ports && { ports: ports.map(p => ({ name: p.name, containerPort: p.containerPort, protocol: p.protocol ?? "TCP" as const })) }), ...(env?.length && { env }) }],
                        ...(restartPolicy && { restartPolicy }),
                        ...(nodeName && { nodeName }),
                    },
                },
            ],
        };
    }
    if (action.type === CreateDaemonSetType) {
        const { name, namespace, image, containers } = action.payload;
        const creationTimestamp = new Date().toISOString();
        const ds: DaemonSet = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                namespace,
                labels: { app: name },
                annotations: {},
                creationTimestamp,
                generation: 1,
            },
            spec: {
                selector: { matchLabels: { app: name } },
                template: {
                    metadata: { name, namespace, labels: { app: name } },
                    spec: { containers: containers ?? [{ name, image }] },
                },
                updateStrategy: { type: "RollingUpdate" },
            },
            status: {
                desiredNumberScheduled: 0,
                currentNumberScheduled: 0,
                numberReady: 0,
                numberAvailable: 0,
                updatedNumberScheduled: 0,
                observedGeneration: 1,
            },
        };
        return { ...state, DaemonSets: [...state.DaemonSets, ds] };
    }
    if (action.type === UpdateDaemonSetStatusType) {
        const { name, namespace, patch } = action.payload;
        return {
            ...state,
            DaemonSets: state.DaemonSets.map(ds =>
                ds.metadata.name === name && ds.metadata.namespace === namespace
                    ? { ...ds, status: { ...ds.status, ...patch } }
                    : ds
            ),
        };
    }
    if (action.type === DeleteDaemonSetType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            DaemonSets: state.DaemonSets.filter(
                ds => !(ds.metadata.name === name && ds.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === UpdatePodStatusType) {
        const { name, namespace, patch } = action.payload;
        return {
            ...state,
            Pods: state.Pods.map(p =>
                p.metadata.name === name && p.metadata.namespace === namespace
                    ? { ...p, status: { ...p.status, ...patch } }
                    : p
            ),
        };
    }
    if (action.type === UpdateReplicaSetStatusType) {
        const { name, namespace, replicas, readyReplicas, availableReplicas } = action.payload;
        return {
            ...state,
            ReplicaSets: state.ReplicaSets.map(rs =>
                rs.metadata.name === name && rs.metadata.namespace === namespace
                    ? { ...rs, status: { ...rs.status, replicas, readyReplicas, availableReplicas } }
                    : rs
            ),
        };
    }
    if (action.type === UpdateDeploymentStatusType) {
        const { name, namespace, readyReplicas, availableReplicas, updatedReplicas } = action.payload;
        return {
            ...state,
            Deployments: state.Deployments.map(d =>
                d.metadata.name === name && d.metadata.namespace === namespace
                    ? { ...d, status: { ...d.status, readyReplicas, availableReplicas, updatedReplicas } }
                    : d
            ),
        };
    }
    if (action.type === CreateServiceType) {
        const { name, namespace, selector, ports, clusterIP, serviceType } = action.payload;
        const svc: Service = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                namespace,
                labels: {},
                annotations: {},
                creationTimestamp: new Date().toISOString(),
            },
            spec: {
                type: serviceType,
                selector,
                clusterIP,
                ports: ports.map(p => ({ name: p.name, port: p.port, targetPort: p.targetPort, protocol: p.protocol ?? "TCP" })),
            },
            status: {},
        };
        const initialEndpoints: Endpoints = {
            metadata: { name, namespace },
            subsets: [],
        };
        return {
            ...state,
            Services: [...state.Services, svc],
            Endpoints: [
                ...state.Endpoints.filter(e => !(e.metadata.name === name && e.metadata.namespace === namespace)),
                initialEndpoints,
            ],
        };
    }
    if (action.type === UpdateEndpointsType) {
        const ep = action.payload;
        return {
            ...state,
            Endpoints: [
                ...state.Endpoints.filter(
                    e => !(e.metadata.name === ep.metadata.name && e.metadata.namespace === ep.metadata.namespace)
                ),
                ep,
            ],
        };
    }
    if (action.type === CreateNodeType) {
        const { name, cpu, memory, internalIP } = action.payload;
        const now = new Date().toISOString();
        const node: KubeNode = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                labels: { "kubernetes.io/hostname": name },
                annotations: {},
                creationTimestamp: now,
            },
            spec: { unschedulable: false },
            status: {
                conditions: [
                    { type: "Ready", status: "True", lastTransitionTime: now, reason: "KubeletReady", message: "kubelet is posting ready status" },
                    { type: "MemoryPressure", status: "False", lastTransitionTime: now },
                    { type: "DiskPressure",   status: "False", lastTransitionTime: now },
                    { type: "PIDPressure",    status: "False", lastTransitionTime: now },
                ],
                capacity:    { cpu, memory, pods: "110" },
                allocatable: { cpu, memory, pods: "110" },
                addresses: [
                    { type: "InternalIP", address: internalIP },
                    { type: "Hostname",   address: name },
                ],
            },
        };
        return { ...state, Nodes: [...state.Nodes, node] };
    }
    if (action.type === UpdateNodeSpecType) {
        const { name, patch } = action.payload;
        return {
            ...state,
            Nodes: state.Nodes.map(n =>
                n.metadata.name === name ? { ...n, spec: { ...n.spec, ...patch } } : n
            ),
        };
    }
    if (action.type === BindPodToNodeType) {
        const { podName, namespace, nodeName } = action.payload;
        return {
            ...state,
            Pods: state.Pods.map(p =>
                p.metadata.name === podName && p.metadata.namespace === namespace
                    ? { ...p, spec: { ...p.spec, nodeName } }
                    : p
            ),
        };
    }
    if (action.type === CreateJobType) {
        const { name, namespace, image, completions, parallelism, backoffLimit, ownerReferences, creationTimestamp, containers } = action.payload;
        const job: Job = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                namespace,
                labels: { "job-name": name },
                annotations: {},
                ...(ownerReferences && { ownerReferences }),
                creationTimestamp,
            },
            spec: {
                completions,
                parallelism,
                backoffLimit,
                template: {
                    metadata: { namespace, name, labels: { "job-name": name } },
                    spec: {
                        restartPolicy: "Never",
                        containers: containers ?? [{ name, image }],
                    },
                },
            },
            status: {
                active: 0,
                succeeded: 0,
                failed: 0,
                startTime: creationTimestamp,
                conditions: [],
            },
        };
        return { ...state, Jobs: [...state.Jobs, job] };
    }
    if (action.type === UpdateJobStatusType) {
        const { name, namespace, patch } = action.payload;
        return {
            ...state,
            Jobs: state.Jobs.map(j =>
                j.metadata.name === name && j.metadata.namespace === namespace
                    ? { ...j, status: { ...j.status, ...patch } }
                    : j,
            ),
        };
    }
    if (action.type === CreateCronJobType) {
        const { name, namespace, image, schedule, completions, parallelism, backoffLimit, creationTimestamp, containers } = action.payload;
        const cj: CronJob = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                namespace,
                labels: {},
                annotations: {},
                creationTimestamp,
            },
            spec: {
                schedule,
                concurrencyPolicy: "Allow",
                jobTemplate: {
                    spec: {
                        completions,
                        parallelism,
                        backoffLimit,
                        template: {
                            metadata: { namespace, name, labels: { "job-name": name } },
                            spec: {
                                restartPolicy: "Never",
                                containers: containers ?? [{ name, image }],
                            },
                        },
                    },
                },
            },
            status: {
                active: [],
            },
        };
        return { ...state, CronJobs: [...state.CronJobs, cj] };
    }
    if (action.type === UpdateCronJobStatusType) {
        const { name, namespace, patch } = action.payload;
        return {
            ...state,
            CronJobs: state.CronJobs.map(c =>
                c.metadata.name === name && c.metadata.namespace === namespace
                    ? { ...c, status: { ...c.status, ...patch } }
                    : c,
            ),
        };
    }
    if (action.type === DeleteDeploymentType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            Deployments: state.Deployments.filter(
                d => !(d.metadata.name === name && d.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === DeleteReplicaSetType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            ReplicaSets: state.ReplicaSets.filter(
                r => !(r.metadata.name === name && r.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === DeleteServiceType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            Services: state.Services.filter(
                s => !(s.metadata.name === name && s.metadata.namespace === namespace),
            ),
            Endpoints: state.Endpoints.filter(
                e => !(e.metadata.name === name && e.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === DeleteJobType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            Jobs: state.Jobs.filter(
                j => !(j.metadata.name === name && j.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === DeleteCronJobType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            CronJobs: state.CronJobs.filter(
                c => !(c.metadata.name === name && c.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === CreateStatefulSetType) {
        const { name, namespace, image, replicas, serviceName, containers } = action.payload;
        const creationTimestamp = new Date().toISOString();
        const sts: StatefulSet = {
            metadata: {
                uid: crypto.randomUUID(),
                name,
                namespace,
                labels: { app: name },
                annotations: {},
                creationTimestamp,
                generation: 1,
            },
            spec: {
                replicas,
                selector: { matchLabels: { app: name } },
                template: {
                    metadata: { name, namespace, labels: { app: name } },
                    spec: { containers: containers ?? [{ name, image }] },
                },
                serviceName,
                podManagementPolicy: "OrderedReady",
                updateStrategy: { type: "RollingUpdate" },
            },
            status: {
                observedGeneration: 1,
                replicas: 0,
                readyReplicas: 0,
                availableReplicas: 0,
                updatedReplicas: 0,
            },
        };
        return { ...state, StatefulSets: [...state.StatefulSets, sts] };
    }
    if (action.type === ScaleStatefulSetType) {
        const { name, namespace, replicas } = action.payload;
        return {
            ...state,
            StatefulSets: state.StatefulSets.map(sts =>
                sts.metadata.name === name && sts.metadata.namespace === namespace
                    ? { ...sts, spec: { ...sts.spec, replicas } }
                    : sts
            ),
        };
    }
    if (action.type === UpdateStatefulSetStatusType) {
        const { name, namespace, patch } = action.payload;
        return {
            ...state,
            StatefulSets: state.StatefulSets.map(sts =>
                sts.metadata.name === name && sts.metadata.namespace === namespace
                    ? { ...sts, status: { ...sts.status, ...patch } }
                    : sts
            ),
        };
    }
    if (action.type === DeleteStatefulSetType) {
        const { name, namespace } = action.payload;
        return {
            ...state,
            StatefulSets: state.StatefulSets.filter(
                sts => !(sts.metadata.name === name && sts.metadata.namespace === namespace),
            ),
        };
    }
    if (action.type === PatchResourceType) {
        const { kind, name, namespace, patch } = action.payload;
        const apply = <T extends object>(item: T): T => mergePatch(item, patch);
        const match = <T extends { metadata: { name: string; namespace?: string } }>(r: T) =>
            r.metadata.name === name && (r.metadata.namespace === undefined || r.metadata.namespace === namespace);
        switch (kind) {
            case "deployment": return { ...state, Deployments: state.Deployments.map(r => match(r) ? apply(r) : r) };
            case "replicaset": return { ...state, ReplicaSets: state.ReplicaSets.map(r => match(r) ? apply(r) : r) };
            case "daemonset":  return { ...state, DaemonSets:  state.DaemonSets.map(r => match(r) ? apply(r) : r) };
            case "statefulset":return { ...state, StatefulSets: state.StatefulSets.map(r => match(r) ? apply(r) : r) };
            case "pod":        return { ...state, Pods:         state.Pods.map(r => match(r) ? apply(r) : r) };
            case "service":    return { ...state, Services:     state.Services.map(r => match(r) ? apply(r) : r) };
            case "node":       return { ...state, Nodes:        state.Nodes.map(r => match(r) ? apply(r) : r) };
            case "job":        return { ...state, Jobs:         state.Jobs.map(r => match(r) ? apply(r) : r) };
            case "cronjob":    return { ...state, CronJobs:     state.CronJobs.map(r => match(r) ? apply(r) : r) };
        }
    }
    return state;
};

/** RFC 7396 JSON Merge Patch — deep-merges `patch` into `target`; null values remove the key. */
function mergePatch<T extends object>(target: T, patch: Record<string, unknown>): T {
    const result: Record<string, unknown> = { ...target as Record<string, unknown> };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete result[key];
        } else if (
            typeof value === "object" && !Array.isArray(value) &&
            typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])
        ) {
            result[key] = mergePatch(result[key] as object, value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result as T;
}
