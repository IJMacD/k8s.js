import type { ActionDispatch } from "react";
import {
    scaleDeployment,
    scaleReplicaSet,
    scaleStatefulSet,
    type Action,
    type AppState,
} from "../store/store";
import { kindAliases } from "./helpers/resource-types";

export async function* kubectlScale(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const replicasFlag = args.find(a => a.startsWith("--replicas="));
    if (!replicasFlag) throw Error("kubectl scale: --replicas=N is required");
    const replicas = parseInt(replicasFlag.slice("--replicas=".length), 10);
    if (isNaN(replicas) || replicas < 0) throw Error("kubectl scale: --replicas must be a non-negative integer");

    // Parse TYPE/NAME or TYPE NAME (skip flags)
    let rawType: string | undefined;
    let resourceName: string | undefined;

    const slashArg = args.slice(1).find(a => !a.startsWith("-") && a.includes("/"));
    if (slashArg) {
        const slash = slashArg.indexOf("/");
        rawType = slashArg.slice(0, slash).toLowerCase();
        resourceName = slashArg.slice(slash + 1);
    } else {
        const typeArg = args.slice(1).find(a => !a.startsWith("-"));
        if (typeArg) {
            rawType = typeArg.toLowerCase();
            const typeIdx = args.indexOf(typeArg);
            const nextArg = args[typeIdx + 1];
            if (nextArg && !nextArg.startsWith("-")) resourceName = nextArg;
        }
    }

    if (!rawType || !resourceName)
        throw Error("kubectl scale: specify deployment/NAME, replicaset/NAME, or statefulset/NAME");

    const kind = kindAliases[rawType];
    if (kind !== "deployment" && kind !== "replicaset" && kind !== "statefulset")
        throw Error(`kubectl scale: unsupported resource type "${rawType}". Supported: deployment, replicaset, statefulset`);

    if (kind === "replicaset") {
        if (!state.ReplicaSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace))
            throw Error(`Error from server (NotFound): replicasets "${resourceName}" not found`);
        dispatch(scaleReplicaSet(resourceName, replicas, namespace));
        yield `replicaset.apps/${resourceName} scaled`;
    } else if (kind === "statefulset") {
        if (!state.StatefulSets.find(s => s.metadata.name === resourceName && s.metadata.namespace === namespace))
            throw Error(`Error from server (NotFound): statefulsets "${resourceName}" not found`);
        dispatch(scaleStatefulSet(resourceName, replicas, namespace));
        yield `statefulset.apps/${resourceName} scaled`;
    } else {
        if (!state.Deployments.find(d => d.metadata.name === resourceName && d.metadata.namespace === namespace))
            throw Error(`Error from server (NotFound): deployments "${resourceName}" not found`);
        dispatch(scaleDeployment(resourceName, replicas, namespace));
        yield `deployment.apps/${resourceName} scaled`;
    }
}
