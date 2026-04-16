import type { ActionDispatch } from "react";
import {
    createService,
    type Action,
    type AppState,
} from "../store/store";

export async function* kubectlExpose(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // kubectl expose (deployment|replicaset|statefulset|daemonset|pod|service) <name> --port=80 ...
    const resourceType = args[1]?.toLowerCase();
    const name = args[2];

    const supported = ["deployment", "replicaset", "rs", "statefulset", "sts", "daemonset", "ds", "pod", "po", "service", "svc"];
    if (!supported.includes(resourceType)) {
        throw Error(`kubectl expose: unsupported resource type "${resourceType}". Supported: deployment, replicaset, statefulset, daemonset, pod, service`);
    }
    if (!name) throw Error(`kubectl expose: missing resource name`);

    // Resolve the selector and short name from the target resource.
    // For pods there is no selector — we generate one and patch the pod's labels.
    let selector: Record<string, string>;

    if (resourceType === "deployment") {
        const r = state.Deployments.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): deployments "${name}" not found`);
        selector = r.spec.selector.matchLabels;
    } else if (resourceType === "replicaset" || resourceType === "rs") {
        const r = state.ReplicaSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): replicasets "${name}" not found`);
        selector = r.spec.selector.matchLabels;
    } else if (resourceType === "statefulset" || resourceType === "sts") {
        const r = state.StatefulSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): statefulsets "${name}" not found`);
        selector = r.spec.selector.matchLabels;
    } else if (resourceType === "daemonset" || resourceType === "ds") {
        const r = state.DaemonSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): daemonsets "${name}" not found`);
        selector = r.spec.selector.matchLabels;
    } else if (resourceType === "pod" || resourceType === "po") {
        const r = state.Pods.find(p => p.metadata.name === name && p.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): pods "${name}" not found`);
        // Expose a pod by using its existing labels as the selector (same behaviour as kubectl)
        selector = r.metadata.labels ?? {};
    } else {
        // service — re-expose an existing service's selector
        const r = state.Services.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
        if (!r) throw Error(`Error from server (NotFound): services "${name}" not found`);
        selector = r.spec.selector;
    }

    const portFlag = args.find(a => a.startsWith("--port="));
    if (!portFlag) throw Error("kubectl expose: --port=PORT is required");
    const port = parseInt(portFlag.slice("--port=".length), 10);
    if (isNaN(port)) throw Error("kubectl expose: --port must be a number");

    const targetPortFlag = args.find(a => a.startsWith("--target-port="));
    const rawTargetPort = targetPortFlag?.slice("--target-port=".length);
    const targetPort: number | string = rawTargetPort
        ? (/^\d+$/.test(rawTargetPort) ? parseInt(rawTargetPort, 10) : rawTargetPort)
        : port;

    const typeFlag = args.find(a => a.startsWith("--type="));
    const serviceType = (typeFlag?.slice("--type=".length) ?? "ClusterIP") as import("../types/v1/Service").ServiceType;

    const svcNameFlag = args.find(a => a.startsWith("--name="));
    const svcName = svcNameFlag?.slice("--name=".length) ?? name;

    const alreadyExists = state.Services.some(s => s.metadata.name === svcName && s.metadata.namespace === namespace);
    if (alreadyExists) throw Error(`Error from server (AlreadyExists): services "${svcName}" already exists`);

    const clusterIP = `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

    dispatch(createService(svcName, {
        selector,
        ports: [{ port, targetPort }],
        clusterIP,
        serviceType,
    }, namespace));
    yield `service/${svcName} exposed`;
}
