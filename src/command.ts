import type { ActionDispatch } from "react";
import { createDeployment, createPod, scaleDeployment, setDeploymentImage, createService, updateNodeSpec, deletePod, createJob, createCronJob, type Action, type AppState } from "./store";

// Splits a command line into tokens, honouring single and double quotes so
// that values containing spaces (e.g. --schedule='*/1 * * * *') are kept
// together as one token. Surrounding quotes are stripped from each token.
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
        } else if (ch === "'" || ch === '"') {
            quote = ch;
        } else if (ch === " ") {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
        } else {
            current += ch;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
}

export function command(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
    state: AppState,
): Promise<string> {
    return new Promise((resolve) => {
        const tokens = tokenize(inputLine.trim());
        // Lowercase only the command verb, not flag values (preserves cron schedules, images, etc.)
        const command = (tokens[0] ?? "").toLowerCase();
        const args = tokens.slice(1);

        if (command === "") {
            resolve("");
            return;
        } else if (command === "help") {
            resolve("Available commands: help, echo [message], date");
            return;
        } else if (command === "echo") {
            const message = args.join(" ");
            resolve(message);
            return;
        } else if (command === "date") {
            if (args[0] === "--iso") {
                resolve(new Date().toISOString());
                return;
            }
            resolve(new Date().toString());
            return;
        } else if (command === "ping") {
            const target = args[0];
            if (!target) {
                resolve("ping: missing host/IP");
                return;
            }

            // Resolve DNS name → service clusterIP.
            // Accepted forms (default namespace assumed when omitted):
            //   <name>
            //   <name>.<namespace>
            //   <name>.<namespace>.svc
            //   <name>.<namespace>.svc.cluster.local
            const resolveToSvc = (host: string) => {
                const parts = host.split(".");
                // Reject anything with a suffix that isn't a valid k8s DNS form
                if (parts.length === 3 && parts[2] !== "svc") return undefined;
                if (parts.length === 5 && (parts[2] !== "svc" || parts[3] !== "cluster" || parts[4] !== "local")) return undefined;
                if (parts.length > 5 || (parts.length === 4)) return undefined;
                const svcName = parts[0];
                const ns = parts[1] ?? "default";
                return state.Services.find(
                    s => s.metadata.name === svcName &&
                        (parts.length === 1 ? true : s.metadata.namespace === ns),
                );
            };

            const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(target);

            // Resolve the target to a clusterIP (or keep as-is for pod IPs)
            let resolvedIP = target;
            const lookedUpSvc = isIP
                ? state.Services.find(s => s.spec.clusterIP === target)
                : resolveToSvc(target);

            if (!isIP && lookedUpSvc) {
                resolvedIP = lookedUpSvc.spec.clusterIP;
            }

            const pod = state.Pods.find(p => p.status.podIP === resolvedIP);
            if (!pod) {
                if (lookedUpSvc) {
                    // Service DNS / clusterIP path
                    const ep = state.Endpoints.find(
                        e => e.metadata.name === lookedUpSvc!.metadata.name &&
                             e.metadata.namespace === lookedUpSvc!.metadata.namespace,
                    );
                    const addresses = ep?.subsets.flatMap(s => s.addresses) ?? [];
                    if (addresses.length === 0) {
                        resolve(`ping: connect to host ${target}: Connection refused`);
                        return;
                    }
                    const ms = () => (0.03 + Math.random() * 0.04).toFixed(3);
                    resolve(
                        `PING ${target} (${resolvedIP}): 56 data bytes\n` +
                        `64 bytes from ${resolvedIP}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
                        `64 bytes from ${resolvedIP}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
                        `64 bytes from ${resolvedIP}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
                        `\n--- ${target} ping statistics ---\n` +
                        `3 packets transmitted, 3 packets received, 0.0% packet loss`
                    );
                    return;
                }
                resolve(`ping: cannot resolve ${target}: Name or service not known`);
                return;
            }
            if (pod.status.phase !== "Running") {
                resolve(`ping: connect to host ${target}: Connection refused`);
                return;
            }
            const ms = () => (0.03 + Math.random() * 0.04).toFixed(3);
            resolve(
                `PING ${target} (${resolvedIP}): 56 data bytes\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
                `\n--- ${target} ping statistics ---\n` +
                `3 packets transmitted, 3 packets received, 0.0% packet loss`
            );
            return;
        } else if (command === "kubectl") {
            resolve(kubectl(args, dispatch, state));
        } else {
            resolve(`Unknown command: ${command}`);
            return;
        }
    });
}

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

function kubectl(
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
                ownerCronJob: cronName,
            }, namespace));
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
        const serviceType = (typeFlag?.slice("--type=".length) ?? "ClusterIP") as import("./types/v1/Service").ServiceType;

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
                ...(job.metadata.ownerCronJob ? [`Controlled By:      CronJob/${job.metadata.ownerCronJob}`] : []),
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
                j => j.metadata.ownerCronJob === name &&
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
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
