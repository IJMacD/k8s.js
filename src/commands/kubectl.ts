import type { ActionDispatch } from "react";
import { createCronJob, createDeployment, createJob, createPod, createService, deleteCronJob, deleteDeployment, deleteJob, deletePod, deleteReplicaSet, deleteService, scaleDeployment, setDeploymentImage, updateNodeSpec, type Action, type AppState } from "../store/store";

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

export function kubectl(
    rawArgs: string[],
    dispatch: ActionDispatch<[action: Action]>,
    state: AppState,
): Promise<string> {
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
            return Promise.resolve(`pod/${name} created`);
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
            return Promise.resolve(`job.batch/${name} created`);
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
        return Promise.resolve(`job.batch/${name} created`);
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
        return Promise.resolve(`cronjob.batch/${name} created`);
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
        return Promise.resolve(`deployment.apps/${name} created`);
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
        return Promise.resolve(`deployment.apps/${deploymentName} image updated`);
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
        return Promise.resolve(`deployment.apps/${resourceName} scaled`);
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

        // Generate a stable fake clusterIP
        const clusterIP = `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

        dispatch(createService(svcName, {
            selector: { app: name },
            ports: [{ port, targetPort }],
            clusterIP,
            serviceType,
        }, namespace));
        return Promise.resolve(`service/${svcName} exposed`);
    }
    if (args[0] === "cordon" || args[0] === "uncordon") {
        const name = args[1];
        if (!name) throw Error(`kubectl ${args[0]}: missing node name`);
        const node = state.Nodes.find(n => n.metadata.name === name);
        if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
        const unschedulable = args[0] === "cordon";
        dispatch(updateNodeSpec(name, { unschedulable }));
        return Promise.resolve(`node/${name} ${unschedulable ? "cordoned" : "uncordoned"}`);
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
        return Promise.resolve(
            `node/${name} cordoned\n` +
            nodePods.map(p => `pod/${p.metadata.name} evicted`).join("\n") +
            (nodePods.length ? "\n" : "") +
            `node/${name} drained`
        );
    }
    if (args[0] === "describe") {
        const resourceArg = args[1];
        if (!resourceArg) throw Error("kubectl describe: specify a resource (e.g. pod/<name>)");

        if (resourceArg.startsWith("job/") || args[1] === "job") {
            const name = resourceArg.includes("/") ? resourceArg.slice(resourceArg.indexOf("/") + 1) : args[2];
            if (!name) throw Error("kubectl describe job: missing job name");
            const job = state.Jobs.find(j => j.metadata.name === name && j.metadata.namespace === namespace);
            if (!job) throw Error(`Error from server (NotFound): jobs "${name}" not found`);
            const isComplete = job.status.conditions.some(c => c.type === "Complete" && c.status === "True");
            const isFailed = job.status.conditions.some(c => c.type === "Failed" && c.status === "True");
            const lines = [
                `Name:               ${job.metadata.name}`,
                `Namespace:          ${job.metadata.namespace}`,
                `Labels:             ${Object.entries(job.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                ...(job.metadata.ownerReferences?.find(r => r.kind === "CronJob")
                    ? [`Controlled By:      CronJob/${job.metadata.ownerReferences.find(r => r.kind === "CronJob")!.name}`]
                    : []),
                `Completions:        ${job.status.succeeded}/${job.spec.completions}`,
                `Parallelism:        ${job.spec.parallelism}`,
                `Backoff Limit:      ${job.spec.backoffLimit}`,
                `Start Time:         ${job.status.startTime ?? "<none>"}`,
                ...(job.status.completionTime ? [`Completion Time:    ${job.status.completionTime}`] : []),
                ``,
                `Pods Statuses:    ${job.status.active} Active / ${job.status.succeeded} Succeeded / ${job.status.failed} Failed`,
                ``,
                `Conditions:`,
                `  Type     Status`,
                ...(job.status.conditions.length
                    ? job.status.conditions.map(c => `  ${c.type.padEnd(8)} ${c.status}`)
                    : [`  <none>`]),
                ``,
                `Status:           ${isComplete ? "Complete" : isFailed ? "Failed" : "Running"}`,
            ];
            return Promise.resolve(lines.join("\n"));
        }

        if (resourceArg.startsWith("cronjob/") || args[1] === "cronjob") {
            const name = resourceArg.includes("/") ? resourceArg.slice(resourceArg.indexOf("/") + 1) : args[2];
            if (!name) throw Error("kubectl describe cronjob: missing cronjob name");
            const cj = state.CronJobs.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
            if (!cj) throw Error(`Error from server (NotFound): cronjobs "${name}" not found`);
            const activeJobs = state.Jobs.filter(
                j => j.metadata.ownerReferences?.some(r => r.kind === "CronJob" && r.name === name) &&
                    !j.status.conditions.some(c => c.type === "Complete" && c.status === "True") &&
                    !j.status.conditions.some(c => c.type === "Failed" && c.status === "True"),
            );
            const lines = [
                `Name:                          ${cj.metadata.name}`,
                `Namespace:                     ${cj.metadata.namespace}`,
                `Schedule:                      ${cj.spec.schedule}`,
                `Concurrency Policy:            ${cj.spec.concurrencyPolicy ?? "Allow"}`,
                `Suspend:                       ${cj.spec.suspend ?? false}`,
                `Last Schedule Time:            ${cj.status.lastScheduleTime ?? "<none>"}`,
                `Active Jobs:                   ${activeJobs.length > 0 ? activeJobs.map(j => j.metadata.name).join(", ") : "<none>"}`,
                ``,
                `Job Template:`,
                `  Completions:  ${cj.spec.jobTemplate.spec.completions}`,
                `  Parallelism:  ${cj.spec.jobTemplate.spec.parallelism}`,
                `  Image:        ${cj.spec.jobTemplate.spec.template.spec.containers[0]?.image ?? "<none>"}`,
            ];
            return Promise.resolve(lines.join("\n"));
        }

        if (resourceArg.startsWith("pod/") || args[1] === "pod") {
            const name = resourceArg.startsWith("pod/")
                ? resourceArg.slice("pod/".length)
                : args[2];
            if (!name) throw Error("kubectl describe pod: missing pod name");

            const pod = state.Pods.find(
                p => p.metadata.name === name && p.metadata.namespace === namespace,
            );
            if (!pod) throw Error(`Error from server (NotFound): pods "${name}" not found`);

            const lines: string[] = [
                `Name:         ${pod.metadata.name}`,
                `Namespace:    ${pod.metadata.namespace}`,
                `Node:         ${pod.spec.nodeName ?? "<none>"}`,
                `Start Time:   ${pod.status.startTime ?? "<none>"}`,
                `Labels:       ${Object.entries(pod.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Annotations:  ${Object.entries(pod.metadata.annotations ?? {}).map(([k, v]) => `${k}=${v}`).join("\n              ") || "<none>"}`,
                ...(pod.metadata.ownerReferences?.length
                    ? [`Controlled By:  ${pod.metadata.ownerReferences.find(r => r.controller)?.kind}/${pod.metadata.ownerReferences.find(r => r.controller)?.name}`]
                    : []),
                `Status:       ${pod.status.phase}`,
                `IP:           ${pod.status.podIP ?? "<none>"}`,
                ``,
                `Containers:`,
                ...pod.spec.containers.flatMap(c => [
                    `  ${c.name}:`,
                    `    Image:    ${c.image}`,
                    ...(c.ports?.length
                        ? [`    Ports:    ${c.ports.map(p => p.containerPort).join(", ")}`]
                        : []),
                ]),
                ``,
                `Conditions:`,
                `  Type         Status`,
                ...(pod.status.conditions?.map(
                    c => `  ${c.type.padEnd(12)} ${c.status}`,
                ) ?? [`  <none>`]),
            ];
            return Promise.resolve(lines.join("\n"));
        }

        if (resourceArg.startsWith("service/") || resourceArg.startsWith("svc/") || args[1] === "service" || args[1] === "svc") {
            const name = resourceArg.includes("/")
                ? resourceArg.slice(resourceArg.indexOf("/") + 1)
                : args[2];
            if (!name) throw Error("kubectl describe service: missing service name");

            const svc = state.Services.find(
                s => s.metadata.name === name && s.metadata.namespace === namespace,
            );
            if (!svc) throw Error(`Error from server (NotFound): services "${name}" not found`);

            const ep = state.Endpoints.find(
                e => e.metadata.name === name && e.metadata.namespace === namespace,
            );
            const endpointIPs = ep?.subsets.flatMap(s => s.addresses.map(a => a.ip)) ?? [];

            const lines = [
                `Name:              ${svc.metadata.name}`,
                `Namespace:         ${svc.metadata.namespace}`,
                `Labels:            ${Object.entries(svc.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Selector:          ${Object.entries(svc.spec.selector).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Type:              ${svc.spec.type}`,
                `IP:                ${svc.spec.clusterIP}`,
                `Port:              ${svc.spec.ports.map(p => `${p.port}/TCP`).join(", ")}`,
                `TargetPort:        ${svc.spec.ports.map(p => `${p.targetPort}/TCP`).join(", ")}`,
                `Endpoints:         ${endpointIPs.length > 0 ? endpointIPs.join(",") : "<none>"}`,
                `Age:               <unknown>`,
            ];
            return Promise.resolve(lines.join("\n"));
        }

        if (resourceArg.startsWith("node/") || args[1] === "node") {
            const name = resourceArg.includes("/") ? resourceArg.slice(resourceArg.indexOf("/") + 1) : args[2];
            if (!name) throw Error("kubectl describe node: missing node name");

            const node = state.Nodes.find(n => n.metadata.name === name);
            if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);

            const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
            const internalIP = node.status.addresses.find(a => a.type === "InternalIP")?.address ?? "<none>";
            const lines = [
                `Name:               ${node.metadata.name}`,
                `Labels:             ${Object.entries(node.metadata.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
                `Unschedulable:      ${node.spec.unschedulable}`,
                `InternalIP:         ${internalIP}`,
                ``,
                `Capacity:`,
                `  cpu:     ${node.status.capacity.cpu}`,
                `  memory:  ${node.status.capacity.memory}`,
                `  pods:    ${node.status.capacity.pods}`,
                ``,
                `Conditions:`,
                `  Type             Status`,
                ...node.status.conditions.map(c => `  ${c.type.padEnd(16)} ${c.status}`),
                ``,
                `Non-terminated Pods: (${nodePods.length})`,
                `  Namespace    Name`,
                ...nodePods.map(p => `  ${p.metadata.namespace.padEnd(12)} ${p.metadata.name}`),
            ];
            return Promise.resolve(lines.join("\n"));
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
        return Promise.resolve(lines.join("\n") || "No resources deleted.");
    }
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
