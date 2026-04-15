import type { ActionDispatch } from "react";
import { createDeployment, createPod, scaleDeployment, setDeploymentImage, createService, type Action, type AppState } from "./store";

export function command(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
    state: AppState,
): Promise<string> {
    return new Promise((resolve) => {
        const [command, ...args] = inputLine.trim().toLowerCase().split(" ");

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
            const pod = state.Pods.find(p => p.status.podIP === target);
            if (!pod) {
                // Also accept a service clusterIP — round-robin to any ready endpoint
                const svc = state.Services.find(s => s.spec.clusterIP === target);
                if (svc) {
                    const ep = state.Endpoints.find(
                        e => e.metadata.name === svc.metadata.name && e.metadata.namespace === svc.metadata.namespace,
                    );
                    const addresses = ep?.subsets.flatMap(s => s.addresses) ?? [];
                    if (addresses.length === 0) {
                        resolve(`ping: connect to host ${target}: Connection refused`);
                        return;
                    }
                    const ms = () => (0.03 + Math.random() * 0.04).toFixed(3);
                    resolve(
                        `PING ${target} (${target}): 56 data bytes\n` +
                        `64 bytes from ${target}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
                        `64 bytes from ${target}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
                        `64 bytes from ${target}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
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
                `PING ${target} (${target}): 56 data bytes\n` +
                `64 bytes from ${target}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${target}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${target}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
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

function kubectl(
    args: string[],
    dispatch: ActionDispatch<[action: Action]>,
    state: AppState,
): Promise<string> {
    if (args[0] === "run") {
        const name = args[1];

        if (args[2] === "--image") {
            dispatch(createPod(name, { image: args[3] }));
            return Promise.resolve(`pod/${name} created`);
        } else {
            throw Error("Expecting --image");
        }
    }
    if (args[0] === "create" && args[1] === "deployment") {
        const name = args[2];
        if (!name) throw Error("kubectl create deployment: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create deployment: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const replicasFlag = args.find(a => a.startsWith("--replicas="));
        const replicas = replicasFlag ? parseInt(replicasFlag.slice("--replicas=".length), 10) : 1;

        dispatch(createDeployment(name, { image, replicas }));
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

        dispatch(setDeploymentImage(deploymentName, container, image));
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

        dispatch(scaleDeployment(resourceName, replicas));
        return Promise.resolve(`deployment.apps/${resourceName} scaled`);
    }
    if (args[0] === "expose") {
        // kubectl expose deployment <name> --port=80 [--target-port=8080] [--type=ClusterIP]
        if (args[1] !== "deployment") throw Error("kubectl expose: only 'deployment' resources are supported");
        const name = args[2];
        if (!name) throw Error("kubectl expose: missing deployment name");

        const exists = state.Deployments.find(d => d.metadata.name === name);
        if (!exists) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        const portFlag = args.find(a => a.startsWith("--port="));
        if (!portFlag) throw Error("kubectl expose: --port=PORT is required");
        const port = parseInt(portFlag.slice("--port=".length), 10);
        if (isNaN(port)) throw Error("kubectl expose: --port must be a number");

        const targetPortFlag = args.find(a => a.startsWith("--target-port="));
        const targetPort = targetPortFlag ? parseInt(targetPortFlag.slice("--target-port=".length), 10) : port;

        const typeFlag = args.find(a => a.startsWith("--type="));
        const serviceType = (typeFlag?.slice("--type=".length) ?? "ClusterIP") as import("./types/apps/Service").ServiceType;

        const svcNameFlag = args.find(a => a.startsWith("--name="));
        const svcName = svcNameFlag?.slice("--name=".length) ?? name;

        // Generate a stable fake clusterIP
        const clusterIP = `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

        dispatch(createService(svcName, {
            selector: { app: name },
            ports: [{ port, targetPort }],
            clusterIP,
            serviceType,
        }));
        return Promise.resolve(`service/${svcName} exposed`);
    }
    if (args[0] === "describe") {
        const resourceArg = args[1];
        if (!resourceArg) throw Error("kubectl describe: specify a resource (e.g. pod/<name>)");

        const namespace = (() => {
            const idx = args.indexOf("-n");
            if (idx !== -1) return args[idx + 1] ?? "default";
            const flag = args.find(a => a.startsWith("--namespace="));
            return flag ? flag.slice("--namespace=".length) : "default";
        })();

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
                `Node:         <none>`,
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

        throw Error(`kubectl describe: unsupported resource type "${resourceArg.split("/")[0]}"`);
    }
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
