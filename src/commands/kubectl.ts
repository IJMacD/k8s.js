import type { ActionDispatch } from "react";
import { createCronJob, createDaemonSet, createDeployment, createJob, createPod, createService, deleteCronJob, deleteDaemonSet, deleteDeployment, deleteJob, deletePod, deleteReplicaSet, deleteService, scaleDeployment, setDeploymentImage, updateNodeSpec, type Action, type AppState } from "../store/store";

/**
 * Strips -n / --namespace flags from kubectl args and returns the clean
 * positional args alongside the resolved namespace.
 */
function parseKubectlArgs(rawArgs: string[]): { namespace: string; args: string[] } {
    let namespace = "default";
    const args: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const a = rawArgs[i];
        if ((a === "-n" || a === "--namespace") && rawArgs[i + 1]) {
            namespace = rawArgs[++i];
        } else if (a.startsWith("--namespace=")) {
            namespace = a.slice("--namespace=".length);
        } else {
            args.push(a);
        }
    }
    return { namespace, args };
}

export async function* kubectl(
    rawArgs: string[],
    dispatch: ActionDispatch<[action: Action]>,
    getState: () => AppState,
): AsyncGeneratornerator<string> {
    const state = getState();
    const { namespace, args } = parseKubectlArgs(rawArgs);
    if (args[0] === "run") {
        const name = args[1];

        if (args[2] === "--image") {
            const image = args[3];
            const restartFlag = args.find(a => a.startsWith("--restart="));
            const restartPolicy = restartFlag?.slice("--restart=".length) as "Always" | "OnFailure" | "Never" | undefined;
            if (state.Pods.some(p => p.metadata.name === name && p.metadata.namespace === namespace))
                throw Error(`Error from server (AlreadyExists): pods "${name}" already exists`);
            dispatch(createPod(name, { image, restartPolicy }, namespace));
            yield `pod/${name} created`; return;
        } else {
            throw Error("Expecting --image");
        }
    }
    if (args[0] === "create" && args[1] === "job") {
        const name = args[2];
        if (!name) throw Error("kubectl create job: missing NAME");

        // kubectl create job <name> --from=cronjob/<cron-name>
        const fromFlag = args.find(a => a.startsWith("--from="));
        if (fromFlag) {
            const ref = fromFlag.slice("--from=".length);
            if (!ref.startsWith("cronjob/")) throw Error("kubectl create job --from: only cronjob/<name> is supported");
            const cronName = ref.slice("cronjob/".length);
            const cj = state.CronJobs.find(
                c => c.metadata.name === cronName && c.metadata.namespace === namespace,
            );
            if (!cj) throw Error(`Error from server (NotFound): cronjobs "${cronName}" not found`);
            if (state.Jobs.some(j => j.metadata.name === name && j.metadata.namespace === namespace))
                throw Error(`Error from server (AlreadyExists): jobs "${name}" already exists`);
            const s = cj.spec.jobTemplate.spec;
            dispatch(createJob(name, {
                image: s.template.spec.containers[0]?.image ?? "",
                completions: s.completions,
                parallelism: s.parallelism,
                backoffLimit: s.backoffLimit,
            }, namespace, { kind: "CronJob", apiVersion: "batch/v1", name: cronName, uid: cj.metadata.uid }));
            yield `job.batch/${name} created`; return;
        }

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create job: --image=IMAGE is required (or use --from=cronjob/<name>)");
        const image = imageFlag.slice("--image=".length);

        const completions = parseInt(args.find(a => a.startsWith("--completions="))?.slice("--completions=".length) ?? "1", 10);
        const parallelism = parseInt(args.find(a => a.startsWith("--parallelism="))?.slice("--parallelism=".length) ?? "1", 10);
        const backoffLimit = parseInt(args.find(a => a.startsWith("--backoff-limit="))?.slice("--backoff-limit=".length) ?? "6", 10);

        if (state.Jobs.some(j => j.metadata.name === name && j.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): jobs "${name}" already exists`);
        dispatch(createJob(name, { image, completions, parallelism, backoffLimit }, namespace));
        yield `job.batch/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "cronjob") {
        const name = args[2];
        if (!name) throw Error("kubectl create cronjob: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create cronjob: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const scheduleFlag = args.find(a => a.startsWith("--schedule="));
        if (!scheduleFlag) throw Error("kubectl create cronjob: --schedule=CRON is required (e.g. --schedule='*/1 * * * *')");
        const schedule = scheduleFlag.slice("--schedule=".length);

        const completions = parseInt(args.find(a => a.startsWith("--completions="))?.slice("--completions=".length) ?? "1", 10);
        const parallelism = parseInt(args.find(a => a.startsWith("--parallelism="))?.slice("--parallelism=".length) ?? "1", 10);

        if (state.CronJobs.some(c => c.metadata.name === name && c.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): cronjobs "${name}" already exists`);
        dispatch(createCronJob(name, { image, schedule, completions, parallelism }, namespace));
        yield `cronjob.batch/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "daemonset") {
        const name = args[2];
        if (!name) throw Error("kubectl create daemonset: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create daemonset: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        if (state.DaemonSets.some(ds => ds.metadata.name === name && ds.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): daemonsets "${name}" already exists`);
        dispatch(createDaemonSet(name, { image }, namespace));
        yield `daemonset.apps/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "deployment") {
        const name = args[2];
        if (!name) throw Error("kubectl create deployment: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create deployment: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const replicasFlag = args.find(a => a.startsWith("--replicas="));
        const replicas = replicasFlag ? parseInt(replicasFlag.slice("--replicas=".length), 10) : 1;

        if (state.Deployments.some(d => d.metadata.name === name && d.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): deployments "${name}" already exists`);
        dispatch(createDeployment(name, { image, replicas }, namespace));
        yield `deployment.apps/${name} created`; return;
    }
    if (args[0] === "set" && args[1] === "image") {
        // kubectl set image deployment/<name> <container>=<image>
        const resourceArg = args[2];
        if (!resourceArg?.startsWith("deployment/"))
            throw Error("kubectl set image: specify deployment/<name>");
        const deploymentName = resourceArg.slice("deployment/".length);
        if (!deploymentName) throw Error("kubectl set image: missing deployment name");

        const assignArg = args[3];
        if (!assignArg?.includes("="))
            throw Error("kubectl set image: expected <container>=<image>");
        const eqIdx = assignArg.indexOf("=");
        const container = assignArg.slice(0, eqIdx);
        const image = assignArg.slice(eqIdx + 1);
        if (!container || !image)
            throw Error("kubectl set image: expected <container>=<image>");

        dispatch(setDeploymentImage(deploymentName, container, image, namespace));
        yield `deployment.apps/${deploymentName} image updated`; return;
    }
    if (args[0] === "scale") {
        const replicasFlag = args.find(a => a.startsWith("--replicas="));
        if (!replicasFlag) throw Error("kubectl scale: --replicas=N is required");
        const replicas = parseInt(replicasFlag.slice("--replicas=".length), 10);
        if (isNaN(replicas) || replicas < 0) throw Error("kubectl scale: --replicas must be a non-negative integer");

        // accept: deployment/NAME  or  deployment NAME
        let resourceName: string | undefined;
        const slashArg = args.find(a => a.startsWith("deployment/"));
        if (slashArg) {
            resourceName = slashArg.slice("deployment/".length);
        } else if (args[1] === "deployment") {
            resourceName = args[2];
        }
        if (!resourceName) throw Error("kubectl scale: specify deployment/NAME or deployment NAME");

        dispatch(scaleDeployment(resourceName, replicas, namespace));
        yield `deployment.apps/${resourceName} scaled`; return;
    }
    if (args[0] === "expose") {
        // kubectl expose deployment <name> --port=80 [--target-port=8080] [--type=ClusterIP]
        if (args[1] !== "deployment") throw Error("kubectl expose: only 'deployment' resources are supported");
        const name = args[2];
        if (!name) throw Error("kubectl expose: missing deployment name");

        const exists = state.Deployments.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
        if (!exists) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        const portFlag = args.find(a => a.startsWith("--port="));
        if (!portFlag) throw Error("kubectl expose: --port=PORT is required");
        const port = parseInt(portFlag.slice("--port=".length), 10);
        if (isNaN(port)) throw Error("kubectl expose: --port must be a number");

        const targetPortFlag = args.find(a => a.startsWith("--target-port="));
        const targetPort = targetPortFlag ? parseInt(targetPortFlag.slice("--target-port=".length), 10) : port;

        const typeFlag = args.find(a => a.startsWith("--type="));
        const serviceType = (typeFlag?.slice("--type=".length) ?? "ClusterIP") as import("../types/v1/Service").ServiceType;

        const svcNameFlag = args.find(a => a.startsWith("--name="));
        const svcName = svcNameFlag?.slice("--name=".length) ?? name;

        const alreadyExists = state.Services.some(s => s.metadata.name === svcName && s.metadata.namespace === namespace);
        if (alreadyExists) throw Error(`Error from server (AlreadyExists): services "${svcName}" already exists`);

        // Generate a stable fake clusterIP
        const clusterIP = `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

        dispatch(createService(svcName, {
            selector: { app: name },
            ports: [{ port, targetPort }],
            clusterIP,
            serviceType,
        }, namespace));
        yield `service/${svcName} exposed`; return;
    }
    if (args[0] === "cordon" || args[0] === "uncordon") {
        const name = args[1];
        if (!name) throw Error(`kubectl ${args[0]}: missing node name`);
        const node = state.Nodes.find(n => n.metadata.name === name);
        if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
        const unschedulable = args[0] === "cordon";
        dispatch(updateNodeSpec(name, { unschedulable }));
        yield `node/${name} ${unschedulable ? "cordoned" : "uncordoned"}`; return;
    }
    if (args[0] === "drain") {
        const name = args[1];
        if (!name) throw Error("kubectl drain: missing node name");
        const node = state.Nodes.find(n => n.metadata.name === name);
        if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
        // Cordon first
        dispatch(updateNodeSpec(name, { unschedulable: true }));
        // Evict all pods on the node
        const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
        for (const pod of nodePods) {
            dispatch(deletePod(pod.metadata.name, pod.metadata.namespace));
        }
        yield (
            `node/${name} cordoned\n` +
            nodePods.map(p => `pod/${p.metadata.name} evicted`).join("\n") +
            (nodePods.length ? "\n" : "") +
            `node/${name} drained`
        ); return;
    }
    if (args[0] === "get") {
        const allNs = rawArgs.includes("-A") || rawArgs.includes("--all-namespaces");

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
        if (entries.length === 1 && entries[0].name === undefined && args[2]) {
            entries[0].name = args[2];
        }

        const sections: string[] = [];

        const renderGet = (type: string, name: string | undefined): string => {
            if (type === "pods" || type === "pod" || type === "po") {
                const items = state.Pods.filter(
                    p => inNs(p.metadata.namespace) && (name === undefined || p.metadata.name === name),
                );
                if (name && items.length === 0)
                    throw Error(`Error from server (NotFound): pods "${name}" not found`);
                const headers = [...nsHdr, "NAME", "READY", "STATUS", "RESTARTS", "AGE"];
                const rows = items.map(p => {
                    const total = p.spec.containers.length;
                    const ready =
                        p.status.conditions?.find(c => c.type === "Ready")?.status === "True" ? total : 0;
                    return [
                        ...nsCol(p.metadata.namespace),
                        p.metadata.name,
                        `${ready}/${total}`,
                        p.status.phase,
                        "0",
                        ageStr(p.metadata.creationTimestamp),
                    ];
                });
                return fmtTable(headers, rows);
            }
            if (type === "deployments" || type === "deployment" || type === "deploy") {
                const items = state.Deployments.filter(
                    d => inNs(d.metadata.namespace) && (name === undefined || d.metadata.name === name),
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
                    rs => inNs(rs.metadata.namespace) && (name === undefined || rs.metadata.name === name),
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
                    ds => inNs(ds.metadata.namespace) && (name === undefined || ds.metadata.name === name),
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
            if (type === "services" || type === "service" || type === "svc") {
                const items = state.Services.filter(
                    s => inNs(s.metadata.namespace) && (name === undefined || s.metadata.name === name),
                );
                if (name && items.length === 0)
                    throw Error(`Error from server (NotFound): services "${name}" not found`);
                const headers = [...nsHdr, "NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"];
                const rows = items.map(s => [
                    ...nsCol(s.metadata.namespace),
                    s.metadata.name,
                    s.spec.type,
                    s.spec.clusterIP,
                    "<none>",
                    s.spec.ports.map(p => `${p.port}/TCP`).join(","),
                    ageStr(s.metadata.creationTimestamp),
                ]);
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
                const items = state.Nodes.filter(n => name === undefined || n.metadata.name === name);
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
        yield sections.join("\n\n"); return;
    }
    if (args[0] === "rollout") {
        const subCmd = args[1];
        if (!subCmd) throw Error("kubectl rollout: subcommand required (status, undo)");

        if (subCmd === "status") {
            const resourceArg = args[2];
            if (!resourceArg) throw Error("kubectl rollout status: specify a resource (e.g. deployment/<name>)");

            // Only deployments supported for now
            const kind = resourceArg.includes("/") ? resourceArg.split("/")[0].toLowerCase() : "deployment";
            const name = resourceArg.includes("/") ? resourceArg.split("/")[1] : (args[3] ?? resourceArg);
            if (kind !== "deployment" && kind !== "deploy")
                throw Error("kubectl rollout status: only deployments are supported");

            // Parse --timeout=<N>s (default 300s), --watch=false disables waiting
            const timeoutFlag = args.find(a => a.startsWith("--timeout="));
            const timeoutMs = timeoutFlag
                ? parseInt(timeoutFlag.slice("--timeout=".length), 10) * 1000
                : 300_000;
            const noWatch = args.includes("--watch=false") || args.includes("--no-wait");

            const d = state.Deployments.find(
                dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
            );
            if (!d) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

            const isComplete = (s: AppState) => {
                const dep = s.Deployments.find(
                    dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
                );
                if (!dep) return false;
                return dep.status.updatedReplicas >= dep.spec.replicas &&
                    dep.status.readyReplicas >= dep.spec.replicas &&
                    dep.status.availableReplicas >= dep.spec.replicas;
            };

            if (noWatch) {
                if (isComplete(state)) {
                    yield `deployment "${name}" successfully rolled out`; return;
                }
                yield `Waiting for deployment "${name}" rollout to finish: ${d.status.readyReplicas} of ${d.spec.replicas} updated replicas are available...`; return;
            }

            // Poll live state; only yield a line when the status message changes (matches real kubectl behaviour)
            const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
            const deadline = Date.now() + timeoutMs;
            let lastLine = '';
            while (true) {
                const current = getState();
                if (isComplete(current)) {
                    yield `deployment "${name}" successfully rolled out`;
                    return;
                }
                if (Date.now() >= deadline) {
                    const dep = current.Deployments.find(
                        dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
                    );
                    throw new Error(`error: timed out waiting for the condition on deployments/${name}\n(${dep?.status.readyReplicas ?? 0}/${dep?.spec.replicas ?? 0} replicas available)`);
                }
                const dep = current.Deployments.find(
                    dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
                );
                const line = `Waiting for deployment "${name}" rollout to finish: ${dep?.status.readyReplicas ?? 0}/${dep?.spec.replicas ?? 0} updated replicas are available...`;
                if (line !== lastLine) {
                    yield line;
                    lastLine = line;
                }
                await sleep(500);
            }
        }

        if (subCmd === "undo") {
            throw Error("kubectl rollout undo: not yet implemented");
        }

        throw Error(`kubectl rollout: unknown subcommand "${subCmd}"`);
    }
    if (args[0] === "describe") {
        const resourceArg = args[1];
        if (!resourceArg) throw Error("kubectl describe: specify a resource (e.g. pod/<name>)");

        // Resolve name from either "type/name" or "type name" forms
        const resolveName = () => resourceArg.includes("/")
            ? resourceArg.slice(resourceArg.indexOf("/") + 1)
            : args[2];

        if (resourceArg.startsWith("daemonset/") || resourceArg.startsWith("ds/") || args[1] === "daemonset" || args[1] === "ds") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe daemonset: missing name");
            const ds = state.DaemonSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
            if (!ds) throw Error(`Error from server (NotFound): daemonsets "${name}" not found`);

            const ownedPods = state.Pods.filter(
                p => p.metadata.ownerReferences?.some(r => r.kind === "DaemonSet" && r.name === name) && p.metadata.namespace === namespace,
            );
            const containers = ds.spec.template.spec.containers;
            const lines = [
                `Name:           ${ds.metadata.name}`,
                `Selector:       ${Object.entries(ds.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(",")}`,
                `Node-Selector:  <none>`,
                `Labels:         ${Object.entries(ds.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
                `Annotations:    ${Object.entries(ds.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
                `Desired Number of Nodes Scheduled: ${ds.status.desiredNumberScheduled}`,
                `Current Number of Nodes Scheduled: ${ds.status.currentNumberScheduled}`,
                `Number of Nodes Scheduled with Up-to-date Pods: ${ds.status.updatedNumberScheduled}`,
                `Number of Nodes Scheduled with Available Pods: ${ds.status.numberAvailable}`,
                `Number of Nodes Misscheduled: 0`,
                `Pods Status:    ${ds.status.numberReady} Running / ${ownedPods.filter(p => p.status.phase === "Pending").length} Waiting / 0 Succeeded / 0 Failed`,
                `Pod Template:`,
                `  Labels:  ${Object.entries(ds.spec.template.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `  Containers:`,
                ...containers.flatMap(c => [
                    `   ${c.name}:`,
                    `    Image:  ${c.image}`,
                    `    Port:   ${c.ports?.length ? c.ports.map(p => `${p.containerPort}/TCP`).join(", ") : "<none>"}`,
                ]),
                `Update Strategy: ${ds.spec.updateStrategy.type}`,
                `Events:  <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("deployment/") || resourceArg.startsWith("deploy/") || args[1] === "deployment" || args[1] === "deploy") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe deployment: missing name");
            const dep = state.Deployments.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
            if (!dep) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

            const ownedRSes = state.ReplicaSets.filter(
                rs => rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name) && rs.metadata.namespace === namespace,
            );
            const strategy = dep.spec.strategy;
            const ruSpec = strategy.rollingUpdate;
            const unavailable = Math.max(0, dep.spec.replicas - dep.status.availableReplicas);
            const isAvailable = dep.status.availableReplicas >= dep.spec.replicas;
            const isProgressing = dep.status.updatedReplicas >= dep.spec.replicas;
            const currentRS = [...ownedRSes]
                .sort((a, b) => new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime())
                .find(rs => rs.spec.replicas > 0) ?? ownedRSes[0];
            const oldRSes = ownedRSes.filter(rs => rs !== currentRS && rs.spec.replicas > 0);
            const containers = dep.spec.template.spec.containers;
            const lines = [
                `Name:                   ${dep.metadata.name}`,
                `Namespace:              ${dep.metadata.namespace}`,
                `CreationTimestamp:      ${dep.metadata.creationTimestamp}`,
                `Labels:                 ${Object.entries(dep.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                        ") || "<none>"}`,
                `Annotations:            ${Object.entries(dep.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                        ") || "<none>"}`,
                `Selector:               ${Object.entries(dep.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(",")}`,
                `Replicas:               ${dep.spec.replicas} desired | ${dep.status.updatedReplicas} updated | ${dep.status.replicas} total | ${dep.status.availableReplicas} available | ${unavailable} unavailable`,
                `StrategyType:           ${strategy.type}`,
                `MinReadySeconds:        0`,
                ...(strategy.type === "RollingUpdate" && ruSpec
                    ? [`RollingUpdateStrategy:  ${ruSpec.maxUnavailable} max unavailable, ${ruSpec.maxSurge} max surge`]
                    : []),
                `Pod Template:`,
                `  Labels:  ${Object.entries(dep.spec.template.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `  Containers:`,
                ...containers.flatMap(c => [
                    `   ${c.name}:`,
                    `    Image:       ${c.image}`,
                    `    Port:        ${c.ports?.length ? c.ports.map(p => `${p.containerPort}/TCP`).join(", ") : "<none>"}`,
                    `    Environment: <none>`,
                ]),
                `Conditions:`,
                `  Type           Status  Reason`,
                `  ----           ------  ------`,
                `  Available      ${isAvailable ? "True   " : "False  "} ${isAvailable ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable"}`,
                `  Progressing    ${isProgressing ? "True   " : "False  "} ${isProgressing ? "NewReplicaSetAvailable" : "ReplicaSetUpdating"}`,
                `OldReplicaSets:  ${oldRSes.length ? oldRSes.map(rs => `${rs.metadata.name} (${rs.status.replicas}/${rs.spec.replicas} replicas created)`).join(", ") : "<none>"}`,
                `NewReplicaSet:   ${currentRS ? `${currentRS.metadata.name} (${currentRS.status.replicas}/${currentRS.spec.replicas} replicas created)` : "<none>"}`,
                `Events:          <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("replicaset/") || resourceArg.startsWith("rs/") || args[1] === "replicaset" || args[1] === "rs") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe replicaset: missing name");
            const rs = state.ReplicaSets.find(r => r.metadata.name === name && r.metadata.namespace === namespace);
            if (!rs) throw Error(`Error from server (NotFound): replicasets "${name}" not found`);

            const ownerDep = rs.metadata.ownerReferences?.find(r => r.kind === "Deployment");
            const ownedPods = state.Pods.filter(
                p => p.metadata.ownerReferences?.some(r => r.kind === "ReplicaSet" && r.name === name) && p.metadata.namespace === namespace,
            );
            const runningCount = ownedPods.filter(p => p.status.phase === "Running").length;
            const waitingCount = ownedPods.filter(p => p.status.phase === "Pending").length;
            const succeededCount = ownedPods.filter(p => p.status.phase === "Succeeded").length;
            const failedCount = ownedPods.filter(p => p.status.phase === "Failed").length;
            const containers = rs.spec.template.spec.containers;
            const lines = [
                `Name:           ${rs.metadata.name}`,
                `Namespace:      ${rs.metadata.namespace}`,
                `Selector:       ${Object.entries(rs.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(",")}`,
                `Labels:         ${Object.entries(rs.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
                `Annotations:    ${Object.entries(rs.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
                ...(ownerDep ? [`Controlled By:  Deployment/${ownerDep.name}`] : []),
                `Replicas:       ${rs.status.replicas} current / ${rs.spec.replicas} desired`,
                `Pods Status:    ${runningCount} Running / ${waitingCount} Waiting / ${succeededCount} Succeeded / ${failedCount} Failed`,
                `Pod Template:`,
                `  Labels:  ${Object.entries(rs.spec.template.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `  Containers:`,
                ...containers.flatMap(c => [
                    `   ${c.name}:`,
                    `    Image:  ${c.image}`,
                    `    Port:   ${c.ports?.length ? c.ports.map(p => `${p.containerPort}/TCP`).join(", ") : "<none>"}`,
                ]),
                `Conditions:`,
                `  Type             Status`,
                `  ----             ------`,
                `  ReplicaFailure   False`,
                `Events:  <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("job/") || args[1] === "job") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe job: missing job name");
            const job = state.Jobs.find(j => j.metadata.name === name && j.metadata.namespace === namespace);
            if (!job) throw Error(`Error from server (NotFound): jobs "${name}" not found`);

            const isComplete = job.status.conditions.some(c => c.type === "Complete" && c.status === "True");
            const isFailed = job.status.conditions.some(c => c.type === "Failed" && c.status === "True");
            const ownerCronJob = job.metadata.ownerReferences?.find(r => r.kind === "CronJob");
            let duration = "<none>";
            if (job.status.startTime) {
                const end = job.status.completionTime ? new Date(job.status.completionTime) : (isComplete || isFailed ? new Date() : null);
                if (end) {
                    const secs = Math.round((end.getTime() - new Date(job.status.startTime).getTime()) / 1000);
                    duration = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${secs % 60}s`;
                }
            }
            const lines = [
                `Name:             ${job.metadata.name}`,
                `Namespace:        ${job.metadata.namespace}`,
                `Selector:         ${Object.entries(job.metadata.labels).map(([k, v]) => `${k}=${v}`).join(",") || "<none>"}`,
                `Labels:           ${Object.entries(job.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Annotations:      ${Object.entries(job.metadata.annotations).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                ...(ownerCronJob ? [`Controlled By:    CronJob/${ownerCronJob.name}`] : []),
                `Parallelism:      ${job.spec.parallelism}`,
                `Completions:      ${job.spec.completions}`,
                `Backoff Limit:    ${job.spec.backoffLimit}`,
                `Start Time:       ${job.status.startTime ?? "<none>"}`,
                ...(job.status.completionTime ? [`Completion Time:  ${job.status.completionTime}`] : []),
                ...(duration !== "<none>" ? [`Duration:         ${duration}`] : []),
                ``,
                `Pods Statuses:    ${job.status.active} Active / ${job.status.succeeded} Succeeded / ${job.status.failed} Failed`,
                ``,
                `Conditions:`,
                `  Type     Status`,
                `  ----     ------`,
                ...(job.status.conditions.length
                    ? job.status.conditions.map(c => `  ${c.type.padEnd(8)} ${c.status}`)
                    : [`  <none>`]),
                ``,
                `Events:  <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("cronjob/") || args[1] === "cronjob") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe cronjob: missing cronjob name");
            const cj = state.CronJobs.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
            if (!cj) throw Error(`Error from server (NotFound): cronjobs "${name}" not found`);

            const ownedJobs = state.Jobs.filter(j =>
                j.metadata.ownerReferences?.some(r => r.kind === "CronJob" && r.name === name) && j.metadata.namespace === namespace,
            );
            const activeJobs = ownedJobs.filter(j =>
                !j.status.conditions.some(c => c.type === "Complete" && c.status === "True") &&
                !j.status.conditions.some(c => c.type === "Failed" && c.status === "True"),
            );
            const lines = [
                `Name:                          ${cj.metadata.name}`,
                `Namespace:                     ${cj.metadata.namespace}`,
                `Labels:                        ${Object.entries(cj.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Annotations:                   ${Object.entries(cj.metadata.annotations).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Schedule:                      ${cj.spec.schedule}`,
                `Concurrency Policy:            ${cj.spec.concurrencyPolicy ?? "Allow"}`,
                `Suspend:                       ${cj.spec.suspend ?? false}`,
                `Successful Job History Limit:  ${cj.spec.successfulJobsHistoryLimit ?? 3}`,
                `Failed Job History Limit:      ${cj.spec.failedJobsHistoryLimit ?? 1}`,
                `Starting Deadline Seconds:     <unset>`,
                `Selector:                      <unset>`,
                `Last Schedule Time:            ${cj.status.lastScheduleTime ?? "<none>"}`,
                `Active Jobs:                   ${activeJobs.length > 0 ? activeJobs.map(j => j.metadata.name).join(", ") : "<none>"}`,
                ``,
                `Job Template:`,
                `  Labels:       <none>`,
                `  Completions:  ${cj.spec.jobTemplate.spec.completions}`,
                `  Parallelism:  ${cj.spec.jobTemplate.spec.parallelism}`,
                `  Backoff Limit: ${cj.spec.jobTemplate.spec.backoffLimit}`,
                `  Containers:`,
                ...cj.spec.jobTemplate.spec.template.spec.containers.flatMap(c => [
                    `   ${c.name}:`,
                    `    Image:  ${c.image}`,
                    `    Port:   <none>`,
                ]),
                ``,
                `Events:  <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("pod/") || args[1] === "pod") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe pod: missing pod name");

            const pod = state.Pods.find(p => p.metadata.name === name && p.metadata.namespace === namespace);
            if (!pod) throw Error(`Error from server (NotFound): pods "${name}" not found`);

            const ownerRef = pod.metadata.ownerReferences?.find(r => r.controller);
            const nodeObj = state.Nodes.find(n => n.metadata.name === pod.spec.nodeName);
            const nodeIP = nodeObj?.status.addresses.find(a => a.type === "InternalIP")?.address;
            const nodeField = pod.spec.nodeName
                ? nodeIP ? `${pod.spec.nodeName}/${nodeIP}` : pod.spec.nodeName
                : "<none>";

            const containerReady = pod.status.conditions?.find(c => c.type === "ContainersReady")?.status === "True";

            const containerStateLines = (c: { name: string; image: string; ports?: Array<{ containerPort: number }> }): string[] => {
                const base = [
                    `   ${c.name}:`,
                    `    Image:          ${c.image}`,
                    `    Port:           ${c.ports?.length ? c.ports.map(p => `${p.containerPort}/TCP`).join(", ") : "<none>"}`,
                    `    Host Port:      0/TCP`,
                ];
                switch (pod.status.phase) {
                    case "Running":
                        return [...base,
                            `    State:          Running`,
                        `      Started:      ${pod.status.startTime ?? "<unknown>"}`,
                            `    Ready:          True`,
                            `    Restart Count:  0`,
                        ];
                    case "Succeeded":
                        return [...base,
                            `    State:          Terminated`,
                            `      Reason:       Completed`,
                            `      Exit Code:    0`,
                            `    Ready:          False`,
                            `    Restart Count:  0`,
                        ];
                    case "Failed":
                        return [...base,
                            `    State:          Terminated`,
                            `      Exit Code:    1`,
                            `    Ready:          False`,
                            `    Restart Count:  0`,
                        ];
                    default:
                        return [...base,
                            `    State:          Waiting`,
                            `      Reason:       ContainerCreating`,
                        `    Ready:          ${containerReady ? "True" : "False"}`,
                            `    Restart Count:  0`,
                        ];
                }
            };

            // Synthetic events based on pod phase
            const podEvents = (): string[] => {
                const header = [
                    `Events:`,
                    `  Type    Reason      Age      From               Message`,
                    `  ----    ------      ----     ----               -------`,
                ];
                if (!pod.spec.nodeName) return [`Events:  <none>`];
                const nodeName = pod.spec.nodeName;
                const image = pod.spec.containers[0]?.image ?? "";
                const containerName = pod.spec.containers[0]?.name ?? "";
                const scheduled = `  Normal  Scheduled   <unk>    default-scheduler  Successfully assigned ${pod.metadata.namespace}/${pod.metadata.name} to ${nodeName}`;
                if (pod.status.phase === "Pending") return [...header, scheduled];
                return [
                    ...header,
                    scheduled,
                    `  Normal  Pulled      <unk>    kubelet            Container image "${image}" already present on machine`,
                    `  Normal  Created     <unk>    kubelet            Created container ${containerName}`,
                    `  Normal  Started     <unk>    kubelet            Started container ${containerName}`,
                ];
            };

            const lines: string[] = [
                `Name:             ${pod.metadata.name}`,
                `Namespace:        ${pod.metadata.namespace}`,
                `Node:             ${nodeField}`,
                `Start Time:       ${pod.status.startTime ?? "<none>"}`,
                `Labels:           ${Object.entries(pod.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join("\n                  ") || "<none>"}`,
                `Annotations:      ${Object.entries(pod.metadata.annotations ?? {}).map(([k, v]) => `${k}=${v}`).join("\n                  ") || "<none>"}`,
                ...(ownerRef ? [`Controlled By:    ${ownerRef.kind}/${ownerRef.name}`] : []),
                `Status:           ${pod.status.phase}`,
                `IP:               ${pod.status.podIP ?? "<none>"}`,
                ``,
                `Containers:`,
                ...pod.spec.containers.flatMap(containerStateLines),
                ``,
                `Conditions:`,
                `  Type              Status`,
                `  ----              ------`,
                ...(pod.status.conditions?.map(c => `  ${c.type.padEnd(17)} ${c.status}`) ?? [`  <none>`]),
                ``,
                `QoS Class:        BestEffort`,
                `Node-Selectors:   <none>`,
                `Tolerations:      node.kubernetes.io/not-ready:NoExecute op=Exists for 300s`,
                ``,
                ...podEvents(),
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("service/") || resourceArg.startsWith("svc/") || args[1] === "service" || args[1] === "svc") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe service: missing service name");

            const svc = state.Services.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
            if (!svc) throw Error(`Error from server (NotFound): services "${name}" not found`);

            const ep = state.Endpoints.find(e => e.metadata.name === name && e.metadata.namespace === namespace);
            const endpointStrs = ep?.subsets.flatMap(s =>
                s.addresses.map(a => `${a.ip}:${s.ports[0]?.port ?? ""}`)
            ) ?? [];

            const lines = [
                `Name:                     ${svc.metadata.name}`,
                `Namespace:                ${svc.metadata.namespace}`,
                `Labels:                   ${Object.entries(svc.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Annotations:              ${Object.entries(svc.metadata.annotations).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Selector:                 ${Object.entries(svc.spec.selector).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Type:                     ${svc.spec.type}`,
                `IP Family Policy:         SingleStack`,
                `IP Families:              IPv4`,
                `IP:                       ${svc.spec.clusterIP}`,
                `IPs:                      ${svc.spec.clusterIP}`,
                ...svc.spec.ports.map(p => `Port:                     <unset>  ${p.port}/TCP`),
                ...svc.spec.ports.map(p => `TargetPort:               ${p.targetPort}/TCP`),
                `Endpoints:                ${endpointStrs.length > 0 ? endpointStrs.join(",") : "<none>"}`,
                `Session Affinity:         None`,
                `Events:                   <none>`,
            ];
            yield lines.join("\n"); return;
        }

        if (resourceArg.startsWith("node/") || args[1] === "node") {
            const name = resolveName();
            if (!name) throw Error("kubectl describe node: missing node name");

            const node = state.Nodes.find(n => n.metadata.name === name);
            if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);

            const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
            const lines = [
                `Name:               ${node.metadata.name}`,
                `Labels:             ${Object.entries(node.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                    ") || "<none>"}`,
                `Annotations:        ${Object.entries(node.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                    ") || "<none>"}`,
                `CreationTimestamp:  ${node.metadata.creationTimestamp}`,
                `Taints:             ${node.spec.unschedulable ? "node.kubernetes.io/unschedulable:NoSchedule" : "<none>"}`,
                `Unschedulable:      ${node.spec.unschedulable}`,
                ...(node.spec.podCIDR ? [`PodCIDR:            ${node.spec.podCIDR}`] : []),
                ``,
                `Addresses:`,
                ...node.status.addresses.map(a => `  ${a.type}:  ${a.address}`),
                ``,
                `Capacity:`,
                `  cpu:     ${node.status.capacity.cpu}`,
                `  memory:  ${node.status.capacity.memory}`,
                `  pods:    ${node.status.capacity.pods}`,
                ``,
                `Allocatable:`,
                `  cpu:     ${node.status.allocatable.cpu}`,
                `  memory:  ${node.status.allocatable.memory}`,
                `  pods:    ${node.status.allocatable.pods}`,
                ``,
                `Conditions:`,
                `  Type             Status  LastTransitionTime  Reason                  Message`,
                `  ----             ------  ------------------  ------                  -------`,
                ...node.status.conditions.map(c =>
                    `  ${c.type.padEnd(16)} ${c.status.padEnd(7)} ${(c.lastTransitionTime ?? "<none>").padEnd(19)} ${(c.reason ?? "").padEnd(23)} ${c.message ?? ""}`,
                ),
                ``,
                `Non-terminated Pods:  (${nodePods.length} in total)`,
                `  Namespace    Name                              Status`,
                `  ---------    ----                              ------`,
                ...nodePods.map(p => `  ${p.metadata.namespace.padEnd(12)} ${p.metadata.name.padEnd(33)} ${p.status.phase}`),
                ``,
                `Events:  <none>`,
            ];
            yield lines.join("\n"); return;
        }

        throw Error(`kubectl describe: unsupported resource type "${resourceArg.split("/")[0]}"`);
    }
    if (args[0] === "delete") {
        if (args.length < 2) throw Error("kubectl delete: must specify a resource type or type/name");

        // Parse: might be "type/name" or "type name [name2...]"
        const firstArg = args[1];
        let resourceType: string;
        let names: string[];
        const deleteAll = args.includes("--all");

        if (firstArg.includes("/")) {
            // type/name form — collect all slash-form args
            const slashArgs = args.slice(1).filter(a => a.includes("/"));
            resourceType = slashArgs[0].split("/")[0];
            names = slashArgs.map(a => a.split("/")[1]);
        } else {
            resourceType = firstArg;
            if (deleteAll) {
                names = [];
            } else {
                names = args.slice(2).filter(a => !a.startsWith("-"));
                if (names.length === 0) throw Error(`kubectl delete: must specify a name or --all`);
            }
        }

        const resolveType = (t: string) => {
            switch (t) {
                case "pod": case "pods": case "po": return "pod";
                case "deployment": case "deployments": case "deploy": return "deployment";
                case "replicaset": case "replicasets": case "rs": return "replicaset";
                case "service": case "services": case "svc": return "service";
                case "job": case "jobs": return "job";
                case "cronjob": case "cronjobs": return "cronjob";
                case "node": case "nodes": return "node";
                case "daemonset": case "daemonsets": case "ds": return "daemonset";
                default: return null;
            }
        };

        const kind = resolveType(resourceType);
        if (!kind) throw Error(`error: the server doesn't have a resource type "${resourceType}"`);

        // Collect names if --all
        if (deleteAll) {
            switch (kind) {
                case "pod": names = state.Pods.filter(p => p.metadata.namespace === namespace).map(p => p.metadata.name); break;
                case "deployment": names = state.Deployments.filter(d => d.metadata.namespace === namespace).map(d => d.metadata.name); break;
                case "replicaset": names = state.ReplicaSets.filter(r => r.metadata.namespace === namespace).map(r => r.metadata.name); break;
                case "service": names = state.Services.filter(s => s.metadata.namespace === namespace).map(s => s.metadata.name); break;
                case "job": names = state.Jobs.filter(j => j.metadata.namespace === namespace).map(j => j.metadata.name); break;
                case "cronjob": names = state.CronJobs.filter(c => c.metadata.namespace === namespace).map(c => c.metadata.name); break;
                case "node": names = state.Nodes.map(n => n.metadata.name); break;
                case "daemonset": names = state.DaemonSets.filter(ds => ds.metadata.namespace === namespace).map(ds => ds.metadata.name); break;
            }
        }

        const lines: string[] = [];
        for (const name of names) {
            switch (kind) {
                case "pod": {
                    const pod = state.Pods.find(p => p.metadata.name === name && p.metadata.namespace === namespace);
                    if (!pod) throw Error(`Error from server (NotFound): pods "${name}" not found`);
                    dispatch(deletePod(name, namespace));
                    lines.push(`pod "${name}" deleted`);
                    break;
                }
                case "deployment": {
                    const dep = state.Deployments.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
                    if (!dep) throw Error(`Error from server (NotFound): deployments "${name}" not found`);
                    dispatch(deleteDeployment(name, namespace));
                    lines.push(`deployment.apps "${name}" deleted`);
                    break;
                }
                case "replicaset": {
                    const rs = state.ReplicaSets.find(r => r.metadata.name === name && r.metadata.namespace === namespace);
                    if (!rs) throw Error(`Error from server (NotFound): replicasets "${name}" not found`);
                    dispatch(deleteReplicaSet(name, namespace));
                    lines.push(`replicaset.apps "${name}" deleted`);
                    break;
                }
                case "service": {
                    const svc = state.Services.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
                    if (!svc) throw Error(`Error from server (NotFound): services "${name}" not found`);
                    dispatch(deleteService(name, namespace));
                    lines.push(`service "${name}" deleted`);
                    break;
                }
                case "job": {
                    const job = state.Jobs.find(j => j.metadata.name === name && j.metadata.namespace === namespace);
                    if (!job) throw Error(`Error from server (NotFound): jobs "${name}" not found`);
                    dispatch(deleteJob(name, namespace));
                    lines.push(`job.batch "${name}" deleted`);
                    break;
                }
                case "cronjob": {
                    const cj = state.CronJobs.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
                    if (!cj) throw Error(`Error from server (NotFound): cronjobs "${name}" not found`);
                    dispatch(deleteCronJob(name, namespace));
                    lines.push(`cronjob.batch "${name}" deleted`);
                    break;
                }
                case "daemonset": {
                    const ds = state.DaemonSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
                    if (!ds) throw Error(`Error from server (NotFound): daemonsets "${name}" not found`);
                    dispatch(deleteDaemonSet(name, namespace));
                    lines.push(`daemonset.apps "${name}" deleted`);
                    break;
                }
                case "node": {
                    const node = state.Nodes.find(n => n.metadata.name === name);
                    if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
                    // Evict all pods on this node before removing
                    const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
                    for (const pod of nodePods) dispatch(deletePod(pod.metadata.name, pod.metadata.namespace));
                    lines.push(`node "${name}" deleted`);
                    break;
                }
            }
        }
        yield lines.join("\n") || "No resources deleted."; return;
    }
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
