import type { ActionDispatch } from "react";
import {
    patchResource,
    type Action,
    type AppState,
} from "../store/store";
import { kindAliases } from "./helpers/resource-types";

export async function* kubectlLabel(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // kubectl label <type> <name> key=value [key2=value2...] [key3-]
    if (args.length < 3) {
        throw Error("kubectl label: must specify a resource type, name, and at least one label operation");
    }

    const resourceType = args[1].toLowerCase();
    const kind = kindAliases[resourceType];
    if (!kind) {
        throw Error(`error: the server doesn't have a resource type "${args[1]}"`);
    }

    const resourceName = args[2];
    const labelOps = args.slice(3);
    if (labelOps.length === 0) {
        throw Error("kubectl label: must specify at least one label operation (key=value or key-)");
    }

    // Resolve the resource exists
    const notFound = () => {
        throw Error(`Error from server (NotFound): ${resourceType} "${resourceName}" not found`);
    };
    switch (kind) {
        case "node":        if (!state.Nodes.find(n => n.metadata.name === resourceName)) notFound(); break;
        case "pod":         if (!state.Pods.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "deployment":  if (!state.Deployments.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "service":     if (!state.Services.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "replicaset":  if (!state.ReplicaSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "daemonset":   if (!state.DaemonSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "statefulset": if (!state.StatefulSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "job":         if (!state.Jobs.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "cronjob":     if (!state.CronJobs.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
    }

    // Parse label operations: key=value (add/update) or key- (remove)
    const labelsToSet: Record<string, string | null> = {};
    for (const op of labelOps) {
        if (op.endsWith("-")) {
            // Remove label
            const key = op.slice(0, -1);
            if (!key) throw Error(`kubectl label: invalid label operation: "${op}"`);
            labelsToSet[key] = null;
        } else if (op.includes("=")) {
            const eqIdx = op.indexOf("=");
            const key = op.slice(0, eqIdx);
            const value = op.slice(eqIdx + 1);
            if (!key) throw Error(`kubectl label: invalid label operation: "${op}"`);
            labelsToSet[key] = value;
        } else {
            throw Error(`kubectl label: invalid label operation "${op}": expected key=value or key-`);
        }
    }

    dispatch(patchResource(kind, resourceName, { metadata: { labels: labelsToSet } }, namespace));
    yield `${kind}/${resourceName} labeled`;
}
