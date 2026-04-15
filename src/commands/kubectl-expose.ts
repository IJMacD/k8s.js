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
    const rawTargetPort = targetPortFlag?.slice("--target-port=".length);
    // Named port (e.g. --target-port=http) or numeric (e.g. --target-port=8080)
    const targetPort: number | string = rawTargetPort
        ? (/^\d+$/.test(rawTargetPort) ? parseInt(rawTargetPort, 10) : rawTargetPort)
        : port;

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
    yield `service/${svcName} exposed`;
}
