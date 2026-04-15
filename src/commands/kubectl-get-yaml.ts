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
        default:            return [];
    }
}

/** Serialise a list of items into a YAML v1/List document */
function makeList(items: object[], dump: (obj: unknown, opts?: object) => string): string {
    return dump(
        { apiVersion: "v1", kind: "List", metadata: { resourceVersion: "" }, items },
        { lineWidth: -1, noRefs: true },
    ).trimEnd();
}

export async function* kubectlGetYaml(
    args: string[],
    namespace: string,
    allNamespaces: boolean,
    state: AppState,
): AsyncGenerator<string> {
    const { dump } = await import("js-yaml");
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

    // "kubectl get all -o yaml"
    if (entries.length === 1 && entries[0].type === "all") {
        const allKinds = ["pod", "service", "endpoints", "daemonset", "statefulset", "replicaset", "deployment", "job", "cronjob"];
        const items = allKinds.flatMap(
            kind => collect(kind, undefined, namespace, allNamespaces, state).map(obj => annotate(kind, obj)),
        );
        yield makeList(items, dump);
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
            };
            throw Error(`Error from server (NotFound): ${pluralMap[kind] ?? kind} "${name}" not found`);
        }
        allItems.push(...items.map(obj => annotate(kind, obj)));
    }

    // Single named resource → bare YAML object; anything else → List
    if (entries.length === 1 && entries[0].name !== undefined) {
        yield dump(allItems[0], { lineWidth: -1, noRefs: true }).trimEnd();
    } else {
        yield makeList(allItems, dump);
    }
}
