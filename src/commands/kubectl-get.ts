import type { AppState } from "../store/store";
import { kubectlGetYaml } from "./kubectl-get-yaml";

export async function* kubectlGet(
    args: string[],
    namespace: string,
    allNamespaces: boolean,
    state: AppState,
): AsyncGenerator<string> {
    // Detect -o / --output flag and delegate for non-table formats
    const oFlagIdx = args.findIndex(a => a === "-o" || a === "--output");
    const outputFmt = oFlagIdx >= 0
        ? args[oFlagIdx + 1]
        : args.find(a => a.startsWith("-o=") || a.startsWith("--output="))?.split("=")[1];
    if (outputFmt === "yaml") {
        yield* kubectlGetYaml(args, namespace, allNamespaces, state);
        return;
    }
    if (outputFmt === "json") {
        yield* kubectlGetYaml(args, namespace, allNamespaces, state, "json");
        return;
    }
    if (outputFmt !== undefined && outputFmt !== "wide") {
        throw Error(`kubectl get: output format "${outputFmt}" is not supported (use yaml, json, or wide)`);
    }

    const allNs = allNamespaces;

    // Parse -l / --selector label selector
    const selectorFlagIdx = args.findIndex(a => a === "-l" || a === "--selector");
    const selectorStr = selectorFlagIdx >= 0
        ? args[selectorFlagIdx + 1]
        : args.find(a => a.startsWith("-l=") || a.startsWith("--selector="))?.split("=").slice(1).join("=");

    const labelSelector: Record<string, string> = {};
    if (selectorStr) {
        for (const part of selectorStr.split(",")) {
            const m = part.match(/^([^!=]+)==?(.+)$/);
            if (m) labelSelector[m[1].trim()] = m[2].trim();
        }
    }
    const matchSelector = (labels: Record<string, string> | undefined): boolean =>
        Object.entries(labelSelector).every(([k, v]) => labels?.[k] === v);

    // Elapsed-time formatter: from ISO timestamp (to optional end timestamp)
    const elapsed = (from: string, to?: string): string => {
        const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
        const secs = Math.max(0, Math.floor(ms / 1000));
        if (secs < 60) return `${secs}s`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    };
    const ageStr = (ts?: string) => (ts ? elapsed(ts) : "<unknown>");

    // Columnar table: pads all columns to max width except the last
    const fmtTable = (headers: string[], rows: string[][]): string => {
        const all = [headers, ...rows];
        const widths = headers.map((_, i) => Math.max(...all.map(r => (r[i] ?? "").length)));
        const fmt = (cells: string[]) =>
            cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join("   ");
        return all.map(fmt).join("\n");
    };

    const inNs = (ns: string) => allNs || ns === namespace;
    const nsHdr = allNs ? ["NAMESPACE"] : [];
    const nsCol = (ns: string) => (allNs ? [ns] : []);

    const resourceToken = args[1];
    if (!resourceToken) throw Error("kubectl get: you must specify the type of resource to get");

    // Parse comma-separated list; each entry may use resource/name notation
    const entries = resourceToken.split(",").filter(Boolean).map(entry => {
        const slash = entry.indexOf("/");
        return slash >= 0
            ? { type: entry.slice(0, slash).toLowerCase(), name: entry.slice(slash + 1) }
            : { type: entry.toLowerCase(), name: undefined as string | undefined };
    });
    // For a single resource without slash, "kubectl get pods <name>" uses args[2] as the name
    // but only when it isn't a flag (e.g. -l)
    if (entries.length === 1 && entries[0].name === undefined && args[2] && !args[2].startsWith("-")) {
        entries[0].name = args[2];
    }

    const sections: string[] = [];

    const renderGet = (type: string, name: string | undefined): string => {
        if (type === "pods" || type === "pod" || type === "po") {
            const items = state.Pods.filter(
                p => inNs(p.metadata.namespace) && (name === undefined || p.metadata.name === name) && matchSelector(p.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): pods "${name}" not found`);
            const headers = [...nsHdr, "NAME", "READY", "STATUS", "RESTARTS", "AGE"];
            const rows = items.map(p => {
                const total = p.spec.containers.length;
                // READY: use per-container statuses when available; fall back to condition flag
                const readyCount = p.status.containerStatuses !== undefined
                    ? p.status.containerStatuses.filter(s => s.ready).length
                    : (p.status.conditions?.find(c => c.type === "ContainersReady")?.status === "True" ? total : 0);
                // STATUS: show Init:K/N while init containers are still running
                let statusStr = p.status.phase as string;
                const totalInit = p.spec.initContainers?.length ?? 0;
                if (p.status.phase === "Pending" && totalInit > 0) {
                    const doneInit = (p.status.initContainerStatuses ?? [])
                        .filter(s => s.state?.terminated !== undefined).length;
                    if (doneInit < totalInit) {
                        statusStr = `Init:${doneInit}/${totalInit}`;
                    } else {
                        // All init containers done but app containers not ready yet
                        const anyCreating = (p.status.containerStatuses ?? [])
                            .some(s => s.state?.waiting?.reason === "ContainerCreating");
                        if (anyCreating) statusStr = "PodInitializing";
                    }
                } else if (p.status.phase === "Pending" && p.spec.nodeName) {
                    const anyCreating = (p.status.containerStatuses ?? [])
                        .some(s => s.state?.waiting?.reason === "ContainerCreating");
                    if (anyCreating) statusStr = "ContainerCreating";
                }
                return [
                    ...nsCol(p.metadata.namespace),
                    p.metadata.name,
                    `${readyCount}/${total}`,
                    statusStr,
                    "0",
                    ageStr(p.metadata.creationTimestamp),
                ];
            });
            return fmtTable(headers, rows);
        }
        if (type === "deployments" || type === "deployment" || type === "deploy") {
            const items = state.Deployments.filter(
                d => inNs(d.metadata.namespace) && (name === undefined || d.metadata.name === name) && matchSelector(d.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): deployments "${name}" not found`);
            const headers = [...nsHdr, "NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"];
            const rows = items.map(d => [
                ...nsCol(d.metadata.namespace),
                d.metadata.name,
                `${d.status.readyReplicas}/${d.spec.replicas}`,
                String(d.status.updatedReplicas),
                String(d.status.availableReplicas),
                ageStr(d.metadata.creationTimestamp),
            ]);
            return fmtTable(headers, rows);
        }
        if (type === "replicasets" || type === "replicaset" || type === "rs") {
            const items = state.ReplicaSets.filter(
                rs => inNs(rs.metadata.namespace) && (name === undefined || rs.metadata.name === name) && matchSelector(rs.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): replicasets "${name}" not found`);
            const headers = [...nsHdr, "NAME", "DESIRED", "CURRENT", "READY", "AGE"];
            const rows = items.map(rs => [
                ...nsCol(rs.metadata.namespace),
                rs.metadata.name,
                String(rs.spec.replicas),
                String(rs.status.replicas),
                String(rs.status.readyReplicas),
                ageStr(rs.metadata.creationTimestamp),
            ]);
            return fmtTable(headers, rows);
        }
        if (type === "daemonsets" || type === "daemonset" || type === "ds") {
            const items = state.DaemonSets.filter(
                ds => inNs(ds.metadata.namespace) && (name === undefined || ds.metadata.name === name) && matchSelector(ds.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): daemonsets "${name}" not found`);
            const headers = [
                ...nsHdr,
                "NAME", "DESIRED", "CURRENT", "READY", "UP-TO-DATE", "AVAILABLE", "NODE SELECTOR", "AGE",
            ];
            const rows = items.map(ds => [
                ...nsCol(ds.metadata.namespace),
                ds.metadata.name,
                String(ds.status.desiredNumberScheduled),
                String(ds.status.currentNumberScheduled),
                String(ds.status.numberReady),
                String(ds.status.updatedNumberScheduled),
                String(ds.status.numberAvailable),
                "<none>",
                ageStr(ds.metadata.creationTimestamp),
            ]);
            return fmtTable(headers, rows);
        }
        if (type === "statefulsets" || type === "statefulset" || type === "sts") {
            const items = state.StatefulSets.filter(
                sts => inNs(sts.metadata.namespace) && (name === undefined || sts.metadata.name === name) && matchSelector(sts.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): statefulsets "${name}" not found`);
            const headers = [...nsHdr, "NAME", "READY", "AGE"];
            const rows = items.map(sts => [
                ...nsCol(sts.metadata.namespace),
                sts.metadata.name,
                `${sts.status.readyReplicas}/${sts.spec.replicas}`,
                ageStr(sts.metadata.creationTimestamp),
            ]);
            return fmtTable(headers, rows);
        }
        if (type === "services" || type === "service" || type === "svc") {
            const items = state.Services.filter(
                s => inNs(s.metadata.namespace) && (name === undefined || s.metadata.name === name) && matchSelector(s.metadata.labels),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): services "${name}" not found`);
            const headers = [...nsHdr, "NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"];
            const rows = items.map(s => {
                const externalIP = s.spec.type === "LoadBalancer"
                    ? (s.status?.loadBalancer?.ingress?.[0]?.ip ?? "<pending>")
                    : "<none>";
                return [
                    ...nsCol(s.metadata.namespace),
                    s.metadata.name,
                    s.spec.type,
                    s.spec.clusterIP,
                    externalIP,
                    s.spec.ports.map(p => p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol ?? "TCP"}` : `${p.port}/${p.protocol ?? "TCP"}`).join(","),
                    ageStr(s.metadata.creationTimestamp),
                ];
            });
            return fmtTable(headers, rows);
        }
        if (type === "endpoints" || type === "endpoint" || type === "ep") {
            const items = state.Endpoints.filter(
                e => inNs(e.metadata.namespace) && (name === undefined || e.metadata.name === name),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): endpoints "${name}" not found`);
            const headers = [...nsHdr, "NAME", "ENDPOINTS", "AGE"];
            const rows = items.map(e => {
                const addrs = e.subsets.flatMap(sub =>
                    sub.addresses.flatMap(a => sub.ports.map(p => `${a.ip}:${p.port}`)),
                );
                return [
                    ...nsCol(e.metadata.namespace),
                    e.metadata.name,
                    addrs.length > 0 ? addrs.join(",") : "<none>",
                    "<unknown>",
                ];
            });
            return fmtTable(headers, rows);
        }
        if (type === "nodes" || type === "node") {
            const items = state.Nodes.filter(n => (name === undefined || n.metadata.name === name) && matchSelector(n.metadata.labels));
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): nodes "${name}" not found`);
            const headers = ["NAME", "STATUS", "ROLES", "AGE", "VERSION"];
            const rows = items.map(n => {
                const ready = n.status.conditions.find(c => c.type === "Ready")?.status === "True";
                const status = n.spec.unschedulable
                    ? "Ready,SchedulingDisabled"
                    : ready ? "Ready" : "NotReady";
                return [n.metadata.name, status, "<none>", ageStr(n.metadata.creationTimestamp), "<none>"];
            });
            return fmtTable(headers, rows);
        }
        if (type === "jobs" || type === "job") {
            const items = state.Jobs.filter(
                j => inNs(j.metadata.namespace) && (name === undefined || j.metadata.name === name),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): jobs "${name}" not found`);
            const headers = [...nsHdr, "NAME", "STATUS", "COMPLETIONS", "DURATION", "AGE"];
            const rows = items.map(j => {
                const isComplete = j.status.conditions.some(c => c.type === "Complete" && c.status === "True");
                const isFailed = j.status.conditions.some(c => c.type === "Failed" && c.status === "True");
                const status = isComplete ? "Complete" : isFailed ? "Failed" : "Running";
                const duration = j.status.startTime
                    ? elapsed(j.status.startTime, j.status.completionTime)
                    : "<none>";
                return [
                    ...nsCol(j.metadata.namespace),
                    j.metadata.name,
                    status,
                    `${j.status.succeeded}/${j.spec.completions}`,
                    duration,
                    ageStr(j.metadata.creationTimestamp),
                ];
            });
            return fmtTable(headers, rows);
        }
        if (type === "cronjobs" || type === "cronjob" || type === "cj") {
            const items = state.CronJobs.filter(
                c => inNs(c.metadata.namespace) && (name === undefined || c.metadata.name === name),
            );
            if (name && items.length === 0)
                throw Error(`Error from server (NotFound): cronjobs "${name}" not found`);
            const headers = [...nsHdr, "NAME", "SCHEDULE", "SUSPEND", "ACTIVE", "LAST SCHEDULE", "AGE"];
            const rows = items.map(c => [
                ...nsCol(c.metadata.namespace),
                c.metadata.name,
                c.spec.schedule,
                String(c.spec.suspend ?? false),
                String(c.status.active.length),
                c.status.lastScheduleTime ? ageStr(c.status.lastScheduleTime) : "<none>",
                ageStr(c.metadata.creationTimestamp),
            ]);
            return fmtTable(headers, rows);
        }
        if (type === "all") {
            const kinds: Array<[string, string]> = [
                ["pods", "pod.v1"],
                ["services", "service.v1"],
                ["daemonsets", "daemonset.apps"],
                ["statefulsets", "statefulset.apps"],
                ["replicasets", "replicaset.apps"],
                ["deployments", "deployment.apps"],
                ["jobs", "job.batch"],
                ["cronjobs", "cronjob.batch"],
            ];
            const parts: string[] = [];
            for (const [kind, label] of kinds) {
                const block = renderGet(kind, undefined);
                // skip header-only blocks (no resources)
                if (block.split("\n").length > 1) {
                    parts.push(`# ${label}\n${block}`);
                }
            }
            return parts.join("\n\n");
        }
        throw Error(`error: the server doesn't have a resource type "${type}"`);
    };

    for (const { type, name } of entries) {
        sections.push(renderGet(type, name));
    }
    yield sections.join("\n\n");
}
