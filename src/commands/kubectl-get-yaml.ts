import type { AppState } from "../store/store";

/** apiVersion + kind for every resource type this simulator knows about */
const kindMeta: Record<string, { apiVersion: string; kind: string }> = {
    pod:         { apiVersion: "v1",       kind: "Pod"         },
    deployment:  { apiVersion: "apps/v1",  kind: "Deployment"  },
    replicaset:  { apiVersion: "apps/v1",  kind: "ReplicaSet"  },
    daemonset:   { apiVersion: "apps/v1",  kind: "DaemonSet"   },
    statefulset: { apiVersion: "apps/v1",  kind: "StatefulSet" },
    service:     { apiVersion: "v1",       kind: "Service"     },
    endpoints:   { apiVersion: "v1",       kind: "Endpoints"   },
    node:        { apiVersion: "v1",       kind: "Node"        },
    job:         { apiVersion: "batch/v1", kind: "Job"         },
    cronjob:     { apiVersion: "batch/v1", kind: "CronJob"     },
    configmap: { apiVersion: "v1", kind: "ConfigMap" },
    secret: { apiVersion: "v1", kind: "Secret" },
    persistentvolume: { apiVersion: "v1", kind: "PersistentVolume" },
    persistentvolumeclaim: { apiVersion: "v1", kind: "PersistentVolumeClaim" },
};

const typeAliasMap: Record<string, string> = {
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
};

/** Prepend apiVersion + kind to an object and enforce real-kubectl key order */
function annotate(kind: string, obj: object): object {
    const meta = kindMeta[kind];
    const r = obj as Record<string, unknown>;
    // Real kubectl ordering: apiVersion → kind → metadata → status → spec
    const ordered: Record<string, unknown> = { apiVersion: meta.apiVersion, kind: meta.kind };
    if ("metadata" in r) ordered.metadata = r.metadata;
    if ("status" in r)   ordered.status   = r.status;
    if ("spec" in r)     ordered.spec     = r.spec;
    // Any remaining keys (forward-compat)
    for (const [k, v] of Object.entries(r)) {
        if (!(k in ordered)) ordered[k] = v;
    }
    return ordered;
}

/** Return all matching objects from state for the given canonical kind */
function collect(
    kind: string,
    name: string | undefined,
    namespace: string,
    allNs: boolean,
    state: AppState,
): object[] {
    const inNs = (ns: string) => allNs || ns === namespace;
    switch (kind) {
        case "pod":         return state.Pods.filter(p => inNs(p.metadata.namespace) && (name === undefined || p.metadata.name === name));
        case "deployment":  return state.Deployments.filter(d => inNs(d.metadata.namespace) && (name === undefined || d.metadata.name === name));
        case "replicaset":  return state.ReplicaSets.filter(r => inNs(r.metadata.namespace) && (name === undefined || r.metadata.name === name));
        case "daemonset":   return state.DaemonSets.filter(d => inNs(d.metadata.namespace) && (name === undefined || d.metadata.name === name));
        case "statefulset": return state.StatefulSets.filter(s => inNs(s.metadata.namespace) && (name === undefined || s.metadata.name === name));
        case "service":     return state.Services.filter(s => inNs(s.metadata.namespace) && (name === undefined || s.metadata.name === name));
        case "endpoints":   return state.Endpoints.filter(e => inNs(e.metadata.namespace) && (name === undefined || e.metadata.name === name));
        case "node":        return state.Nodes.filter(n => name === undefined || n.metadata.name === name);
        case "job":         return state.Jobs.filter(j => inNs(j.metadata.namespace) && (name === undefined || j.metadata.name === name));
        case "cronjob":     return state.CronJobs.filter(c => inNs(c.metadata.namespace) && (name === undefined || c.metadata.name === name));
        case "configmap": return state.ConfigMaps.filter(cm => inNs(cm.metadata.namespace) && (name === undefined || cm.metadata.name === name));
        case "secret": return state.Secrets
            .filter(s => inNs(s.metadata.namespace) && (name === undefined || s.metadata.name === name))
            .map(s => ({
                ...s,
                data: Object.fromEntries(Object.entries(s.data).map(([k, v]) => [k, btoa(v)])),
            }));
        case "persistentvolume": return state.PersistentVolumes.filter(pv => name === undefined || pv.metadata.name === name);
        case "persistentvolumeclaim": return state.PersistentVolumeClaims.filter(pvc => inNs(pvc.metadata.namespace) && (name === undefined || pvc.metadata.name === name));
        default:            return [];
    }
}

/** Serialise a list of items into a v1/List document (YAML or JSON) */
function makeList(items: object[], serialize: (obj: unknown) => string): string {
    return serialize({ apiVersion: "v1", kind: "List", metadata: { resourceVersion: "" }, items }).trimEnd();
}

export async function* kubectlGetYaml(
    args: string[],
    namespace: string,
    allNamespaces: boolean,
    state: AppState,
    format: "yaml" | "json" = "yaml",
): AsyncGenerator<string> {
    let serialize: (obj: unknown) => string;
    if (format === "json") {
        serialize = (obj) => JSON.stringify(obj, null, 2);
    } else {
        const { dump } = await import("js-yaml");
        serialize = (obj) => dump(obj as Record<string, unknown>, { lineWidth: -1, noRefs: true }).trimEnd();
    }
    // Strip -o / --output flags so they don't interfere with positional arg parsing.
    // args[0]="get"  args[1]=resource-type  args[2]=optional-name
    const cleanArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "-o" || args[i] === "--output") && i + 1 < args.length) { i++; continue; }
        if (args[i].startsWith("-o=") || args[i].startsWith("--output=")) continue;
        cleanArgs.push(args[i]);
    }

    const resourceToken = cleanArgs[1];
    if (!resourceToken) throw Error("kubectl get: you must specify the type of resource to get");

    // Identical comma-separated / slash-notation parsing used by kubectlGet
    const entries = resourceToken.split(",").filter(Boolean).map(entry => {
        const slash = entry.indexOf("/");
        return slash >= 0
            ? { type: entry.slice(0, slash).toLowerCase(), name: entry.slice(slash + 1) }
            : { type: entry.toLowerCase(), name: undefined as string | undefined };
    });
    if (entries.length === 1 && entries[0].name === undefined && cleanArgs[2]) {
        entries[0].name = cleanArgs[2];
    }

    // "kubectl get all -o yaml/json"
    if (entries.length === 1 && entries[0].type === "all") {
        const allKinds = ["pod", "service", "endpoints", "daemonset", "statefulset", "replicaset", "deployment", "job", "cronjob"];
        const items = allKinds.flatMap(
            kind => collect(kind, undefined, namespace, allNamespaces, state).map(obj => annotate(kind, obj)),
        );
        yield makeList(items, serialize);
        return;
    }

    const allItems: object[] = [];
    for (const { type, name } of entries) {
        const kind = typeAliasMap[type];
        if (!kind) throw Error(`error: the server doesn't have a resource type "${type}"`);

        const items = collect(kind, name, namespace, allNamespaces, state);
        if (name !== undefined && items.length === 0) {
            // plural forms used in real kubectl error messages
            const pluralMap: Record<string, string> = {
                pod: "pods", deployment: "deployments", replicaset: "replicasets",
                daemonset: "daemonsets", statefulset: "statefulsets", service: "services",
                endpoints: "endpoints", node: "nodes", job: "jobs", cronjob: "cronjobs",
                configmap: "configmaps", secret: "secrets",
                persistentvolume: "persistentvolumes", persistentvolumeclaim: "persistentvolumeclaims",
            };
            throw Error(`Error from server (NotFound): ${pluralMap[kind] ?? kind} "${name}" not found`);
        }
        allItems.push(...items.map(obj => annotate(kind, obj)));
    }

    // Single named resource → bare object; anything else → List
    if (entries.length === 1 && entries[0].name !== undefined) {
        yield serialize(allItems[0]);
    } else {
        yield makeList(allItems, serialize);
    }
}
