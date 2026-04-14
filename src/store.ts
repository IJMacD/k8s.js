import type { Deployment } from "./types/apps/deployment";
import type { Pod } from "./types/apps/pod";

export interface AppState {
    Deployments: Deployment[];
    ReplicaSets: any[];
    Pods: Pod[];
}

const CreateDeploymentType = "CREATE_DEPLOYMENT";
const CreatePodType = "CREATE_POD";

export type ActionType = typeof CreateDeploymentType | typeof CreatePodType;

export interface CreateDeploymentAction {
    type: typeof CreateDeploymentType;
    payload: { name: string; namespace: string };
}

export interface CreatePodAction {
    type: typeof CreatePodType;
    payload: {
        name: string;
        namespace: string;
        image: string;
        creationTimestamp: string;
    };
}

export type Action = CreateDeploymentAction | CreatePodAction;

export function createPod(
    name: string,
    spec: { image: string },
    namespace = "default",
): CreatePodAction {
    return {
        type: CreatePodType,
        payload: {
            name,
            namespace,
            image: spec.image,
            creationTimestamp: new Date().toISOString(),
        },
    };
}

export const reducer = (state: AppState, action: Action): AppState => {
    if (action.type === CreatePodType) {
        return {
            ...state,
            Pods: [
                ...state.Pods,
                {
                    metadata: {
                        name: action.payload.name,
                        namespace: action.payload.namespace,
                        uid: "0",
                        creationTimestamp: action.payload.creationTimestamp,
                    },
                    spec: {
                        containers: [
                            {
                                name: action.payload.name,
                                image: action.payload.image,
                            },
                        ],
                    },
                },
            ],
        };
    }
    return state;
};
