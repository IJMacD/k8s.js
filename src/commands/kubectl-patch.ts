import type { ActionDispatch } from "react";
import {
    patchResource,
    type Action,
    type AppState,
} from "../store/store";

export async function* kubectlPatch(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // kubectl patch TYPE NAME --type merge -p 'JSON'
    // kubectl patch TYPE/NAME --type merge --patch='JSON'
    if (args.length < 2) throw Error("kubectl patch: must specify a resource type");

    // Resolve type and name from "type/name" or "type name" forms
    let kind: string;
    let resourceName: string;
    if (args[1].includes("/")) {
        [kind, resourceName] = args[1].split("/", 2);
    } else {
        kind = args[1];
        resourceName = args[2] ?? "";
        if (!resourceName) throw Error("kubectl patch: must specify a name");
    }

    // Normalise kind aliases
    const kindMap: Record<string, string> = {
        deployment: "deployment", deployments: "deployment", deploy: "deployment",
        replicaset: "replicaset", replicasets: "replicaset", rs: "replicaset",
        daemonset: "daemonset", daemonsets: "daemonset", ds: "daemonset",
        statefulset: "statefulset", statefulsets: "statefulset", sts: "statefulset",
        pod: "pod", pods: "pod", po: "pod",
        service: "service", services: "service", svc: "service",
        node: "node", nodes: "node",
        job: "job", jobs: "job",
        cronjob: "cronjob", cronjobs: "cronjob",
    };
    const resolvedKind = kindMap[kind.toLowerCase()];
    if (!resolvedKind) throw Error(`error: the server doesn't have a resource type "${kind}"`);

    // Only --type merge is supported
    let patchType = "strategic";
    let patchJSON = "";
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--type" || args[i] === "-t") && args[i + 1]) { patchType = args[++i]; continue; }
        if (args[i].startsWith("--type=")) { patchType = args[i].slice("--type=".length); continue; }
        if ((args[i] === "-p" || args[i] === "--patch") && args[i + 1]) { patchJSON = args[++i]; continue; }
        if (args[i].startsWith("--patch=")) { patchJSON = args[i].slice("--patch=".length); continue; }
    }

    if (patchType !== "merge") throw Error(`error: --type must be "merge" (got "${patchType}")`);
    if (!patchJSON) throw Error("kubectl patch: must specify --patch or -p");

    let patch: Record<string, unknown>;
    try {
        patch = JSON.parse(patchJSON);
    } catch {
        throw Error(`kubectl patch: invalid JSON: ${patchJSON}`);
    }
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
        throw Error("kubectl patch: patch must be a JSON object");
    }

    // Verify resource exists
    const notFound = () => {
        const plurals: Record<string, string> = {
            deployment: "deployments", replicaset: "replicasets", daemonset: "daemonsets",
            statefulset: "statefulsets", pod: "pods", service: "services",
            node: "nodes", job: "jobs", cronjob: "cronjobs",
        };
        throw Error(`Error from server (NotFound): ${plurals[resolvedKind] ?? resolvedKind} "${resourceName}" not found`);
    };
    switch (resolvedKind) {
        case "deployment": if (!state.Deployments.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "replicaset": if (!state.ReplicaSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "daemonset": if (!state.DaemonSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "statefulset": if (!state.StatefulSets.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "pod": if (!state.Pods.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "service": if (!state.Services.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "node": if (!state.Nodes.find(r => r.metadata.name === resourceName)) notFound(); break;
        case "job": if (!state.Jobs.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
        case "cronjob": if (!state.CronJobs.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace)) notFound(); break;
    }

    dispatch(patchResource(resolvedKind, resourceName, patch, namespace));

    const groupSuffix: Record<string, string> = {
        deployment: ".apps", replicaset: ".apps", daemonset: ".apps", statefulset: ".apps",
        job: ".batch", cronjob: ".batch",
    };
    yield `${resolvedKind}${groupSuffix[resolvedKind] ?? ""} "${resourceName}" patched`;
}
