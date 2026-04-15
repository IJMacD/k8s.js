import type { Deployment } from "./types/apps/deployment";
import type { Pod } from "./types/apps/Pod";
import type { ReplicaSet } from "./types/apps/ReplicaSet";
import type { Service, Endpoints } from "./types/apps/Service";

export interface AppState {
    Deployments: Deployment[];
    ReplicaSets: ReplicaSet[];
    Pods: Pod[];
    Services: Service[];
    Endpoints: Endpoints[];
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
    | typeof UpdateEndpointsType;

export interface CreateDeploymentAction {
    type: typeof CreateDeploymentType;
    payload: { name: string; namespace: string; image: string; replicas: number };
}

export interface CreatePodAction {
    type: typeof CreatePodType;
    payload: {
        name: string;
        namespace: string;
        image: string;
        containerName?: string;
        labels?: Record<string, string>;
        creationTimestamp: string;
        ownerReplicaSet?: string;
    };
}

export interface CreateServiceAction {
    type: typeof CreateServiceType;
    payload: {
        name: string;
        namespace: string;
        selector: Record<string, string>;
        ports: Array<{ port: number; targetPort: number; protocol?: "TCP" | "UDP" }>;
        clusterIP: string;
        serviceType: import("./types/apps/Service").ServiceType;
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
    payload: import("./types/apps/Service").Endpoints;
}

export function updateEndpoints(endpoints: import("./types/apps/Service").Endpoints): UpdateEndpointsAction {
    return { type: UpdateEndpointsType, payload: endpoints };
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
    | UpdateEndpointsAction;

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
    status: UpdateReplicaSetStatusAction["payload"] extends { name: string; namespace: string } ? Omit<UpdateReplicaSetStatusAction["payload"], "name" | "namespace"> : never,
): UpdateReplicaSetStatusAction {
    return { type: UpdateReplicaSetStatusType, payload: { name, namespace, ...status } };
}

export function updateDeploymentStatus(
    name: string,
    namespace: string,
    status: UpdateDeploymentStatusAction["payload"] extends { name: string; namespace: string } ? Omit<UpdateDeploymentStatusAction["payload"], "name" | "namespace"> : never,
): UpdateDeploymentStatusAction {
    return { type: UpdateDeploymentStatusType, payload: { name, namespace, ...status } };
}

export interface UpdatePodStatusAction {
    type: typeof UpdatePodStatusType;
    payload: {
        name: string;
        namespace: string;
        patch: Partial<import("./types/apps/Pod").PodStatus>;
    };
}

export function updatePodStatus(
    name: string,
    namespace: string,
    patch: Partial<import("./types/apps/Pod").PodStatus>,
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
        ownerDeployment: string;
        replicas: number;
        selector: { matchLabels: Record<string, string> };
        containers: Array<{ name: string; image: string }>;
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
    spec: { image: string; replicas?: number },
    namespace = "default",
): CreateDeploymentAction {
    return {
        type: CreateDeploymentType,
        payload: {
            name,
            namespace,
            image: spec.image,
            replicas: spec.replicas ?? 1,
        },
    };
}

export function createPod(
    name: string,
    spec: { image: string; containerName?: string; labels?: Record<string, string> },
    namespace = "default",
    ownerReplicaSet?: string,
): CreatePodAction {
    return {
        type: CreatePodType,
        payload: {
            name,
            namespace,
            image: spec.image,
            containerName: spec.containerName,
            labels: spec.labels,
            creationTimestamp: new Date().toISOString(),
            ownerReplicaSet,
        },
    };
}

export const reducer = (state: AppState, action: Action): AppState => {
    if (action.type === CreateReplicaSetType) {
        const { name, namespace, ownerDeployment, replicas, selector, containers } = action.payload;
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
                        annotations: { ownerDeployment },
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
        const { name, namespace, image, replicas } = action.payload;
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
                            spec: { containers: [{ name, image }] },
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
        const { name, namespace, image, containerName, labels, creationTimestamp, ownerReplicaSet } = action.payload;
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
                        ...(ownerReplicaSet && {
                            annotations: { ownerReplicaSet },
                        }),
                    },
                    status: {
                        phase: "Pending",
                    },
                    spec: {
                        containers: [{ name: containerName ?? name, image }],
                    },
                },
            ],
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
                ports: ports.map(p => ({ port: p.port, targetPort: p.targetPort, protocol: p.protocol ?? "TCP" })),
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
    return state;
};
