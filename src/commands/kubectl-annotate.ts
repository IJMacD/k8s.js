import type { ActionDispatch } from "react";
import {
    patchResource,
    type Action,
    type AppState,
} from "../store/store";

const kindAliases: Record<string, string> = {
    node: "node", nodes: "node",
    pod: "pod", pods: "pod", po: "pod",
    deployment: "deployment", deployments: "deployment", deploy: "deployment",
    service: "service", services: "service", svc: "service",
    replicaset: "replicaset", replicasets: "replicaset", rs: "replicaset",
    daemonset: "daemonset", daemonsets: "daemonset", ds: "daemonset",
    statefulset: "statefulset", statefulsets: "statefulset", sts: "statefulset",
    job: "job", jobs: "job",
    cronjob: "cronjob", cronjobs: "cronjob",
};

export async function* kubectlAnnotate(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // kubectl annotate <type> <name> key=value [key2=value2...] [key3-]
    if (args.length < 3) {
        throw Error("kubectl annotate: must specify a resource type, name, and at least one annotation operation");
    }

    const resourceType = args[1].toLowerCase();
    const kind = kindAliases[resourceType];
    if (!kind) {
        throw Error(`error: the server doesn't have a resource type "${args[1]}"`);
    }

    const resourceName = args[2];
    const annotateOps = args.slice(3).filter(a => !a.startsWith("--"));
    if (annotateOps.length === 0) {
        throw Error("kubectl annotate: must specify at least one annotation operation (key=value or key-)");
    }

    // Resolve resource exists
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

    // Parse annotation operations: key=value (add/update) or key- (remove)
    const annotationsToSet: Record<string, string | null> = {};
    for (const op of annotateOps) {
        if (op.endsWith("-")) {
            const key = op.slice(0, -1);
            if (!key) throw Error(`kubectl annotate: invalid annotation operation: "${op}"`);
            annotationsToSet[key] = null;
        } else if (op.includes("=")) {
            const eqIdx = op.indexOf("=");
            const key = op.slice(0, eqIdx);
            const value = op.slice(eqIdx + 1);
            if (!key) throw Error(`kubectl annotate: invalid annotation operation: "${op}"`);
            annotationsToSet[key] = value;
        } else {
            throw Error(`kubectl annotate: invalid annotation operation "${op}": expected key=value or key-`);
        }
    }

    dispatch(patchResource(kind, resourceName, { metadata: { annotations: annotationsToSet } }, namespace));
    yield `${kind}/${resourceName} annotated`;
}
