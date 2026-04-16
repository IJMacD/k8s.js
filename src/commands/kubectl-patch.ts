import type { ActionDispatch } from "react";
import {
    patchResource,
    type Action,
    type AppState,
} from "../store/store";

/**
 * Paths whose runtime values are free-key maps (Record<string, string>).
 * Children of these paths are not validated against the live resource.
 */
const FREE_KEY_PATHS: ReadonlySet<string> = new Set([
    "metadata.labels",
    "metadata.annotations",
    "spec.selector",                        // Service: Record<string, string>
    "spec.selector.matchLabels",            // Deployment / DaemonSet / StatefulSet
    "spec.template.metadata.labels",
    "spec.template.metadata.annotations",
    "spec.template.spec.nodeSelector",
    "spec.nodeSelector",                    // Pod
]);

/**
 * Recursively checks that every key in `patch` exists in `target`.
 * Returns an array of human-readable error strings (empty = valid).
 * Skips validation for children of known free-key map paths (labels, annotations, etc.).
 */
function validatePatchKeys(
    patch: Record<string, unknown>,
    target: object,
    path = "",
): string[] {
    const errors: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (!(key in target)) {
            const suggestion = Object.keys(target as Record<string, unknown>)
                .find(k => k.toLowerCase() === key.toLowerCase());
            const hint = suggestion
                ? ` (did you mean "${path ? `${path}.` : ""}${suggestion}"?)`
                : "";
            errors.push(`unknown field "${fullPath}"${hint}`);
            continue;
        }
        // Recurse into nested object patches unless this path is a free-key map or the value is null (a delete)
        if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !FREE_KEY_PATHS.has(fullPath)
        ) {
            const child = (target as Record<string, unknown>)[key];
            if (typeof child === "object" && child !== null && !Array.isArray(child)) {
                errors.push(...validatePatchKeys(value as Record<string, unknown>, child as object, fullPath));
            }
        }
    }
    return errors;
}

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

    // Look up the live resource (also serves as the existence check)
    const plurals: Record<string, string> = {
        deployment: "deployments", replicaset: "replicasets", daemonset: "daemonsets",
        statefulset: "statefulsets", pod: "pods", service: "services",
        node: "nodes", job: "jobs", cronjob: "cronjobs",
    };
    const byNameNs = <T extends { metadata: { name: string; namespace?: string } }>(arr: T[]) =>
        arr.find(r => r.metadata.name === resourceName && r.metadata.namespace === namespace);
    const byName = <T extends { metadata: { name: string } }>(arr: T[]) =>
        arr.find(r => r.metadata.name === resourceName);

    const liveResource: object | undefined = (() => {
        switch (resolvedKind) {
            case "deployment":  return byNameNs(state.Deployments);
            case "replicaset":  return byNameNs(state.ReplicaSets);
            case "daemonset":   return byNameNs(state.DaemonSets);
            case "statefulset": return byNameNs(state.StatefulSets);
            case "pod":         return byNameNs(state.Pods);
            case "service":     return byNameNs(state.Services);
            case "node":        return byName(state.Nodes);
            case "job":         return byNameNs(state.Jobs);
            case "cronjob":     return byNameNs(state.CronJobs);
        }
    })();

    if (!liveResource) {
        throw Error(`Error from server (NotFound): ${plurals[resolvedKind] ?? resolvedKind} "${resourceName}" not found`);
    }

    const fieldErrors = validatePatchKeys(patch, liveResource);
    if (fieldErrors.length > 0) {
        throw Error(fieldErrors.map(e => `error: ${e}`).join("\n"));
    }

    dispatch(patchResource(resolvedKind, resourceName, patch, namespace));

    const groupSuffix: Record<string, string> = {
        deployment: ".apps", replicaset: ".apps", daemonset: ".apps", statefulset: ".apps",
        job: ".batch", cronjob: ".batch",
    };
    yield `${resolvedKind}${groupSuffix[resolvedKind] ?? ""} "${resourceName}" patched`;
}
