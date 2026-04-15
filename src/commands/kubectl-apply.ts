import { loadAll } from "js-yaml";
import type { ActionDispatch } from "react";
import type { Container, PodTemplateSpec } from "../types/v1/Pod";
import {
    createCronJob,
    createDaemonSet,
    createDeployment,
    createJob,
    createService,
    createStatefulSet,
    patchResource,
    type Action,
    type AppState,
} from "../store/store";

/** Temporary buffer for file contents staged by the browser file-upload UI */
const uploadBuffer = new Map<string, string>();

export function stageUpload(filename: string, content: string): void {
    uploadBuffer.set(filename, content);
}

export function consumeUpload(filename: string): string | undefined {
    const content = uploadBuffer.get(filename);
    uploadBuffer.delete(filename);
    return content;
}

/** Parse the containers array out of a raw pod spec object, normalising types */
function parseContainers(podSpec: unknown): Container[] | undefined {
    const raw = (podSpec as Record<string, unknown> | undefined)?.containers;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return (raw as Array<Record<string, unknown>>).map(c => ({
        name: typeof c.name === "string" ? c.name : "",
        image: typeof c.image === "string" ? c.image : "",
        ...(Array.isArray(c.ports) && c.ports.length > 0
            ? {
                ports: (c.ports as Array<Record<string, unknown>>).map(p => ({
                    ...(typeof p.name === "string" ? { name: p.name } : {}),
                    containerPort: typeof p.containerPort === "number" ? p.containerPort : 0,
                    ...(typeof p.protocol === "string" ? { protocol: p.protocol as "TCP" | "UDP" } : {}),
                })),
            }
            : {}),
        ...(Array.isArray(c.env) && c.env.length > 0 ? { env: c.env as Container["env"] } : {}),
    }));
}

/** Build a PodTemplateSpec from a raw YAML template object */
function parseTemplate(rawTemplate: unknown, defaultName: string, defaultNamespace: string): PodTemplateSpec {
    const tmpl = rawTemplate as Record<string, unknown> | undefined;
    const rawMeta = tmpl?.metadata as Record<string, unknown> | undefined;
    const labels = (rawMeta?.labels ?? {}) as Record<string, string>;
    const rawSpec = tmpl?.spec as Record<string, unknown> | undefined;
    const containers = parseContainers(rawSpec) ?? [];
    const restartPolicy = typeof rawSpec?.restartPolicy === "string"
        ? rawSpec.restartPolicy as "Always" | "OnFailure" | "Never"
        : undefined;
    const nodeName = typeof rawSpec?.nodeName === "string" ? rawSpec.nodeName : undefined;
    return {
        metadata: {
            name: defaultName,
            namespace: defaultNamespace,
            ...(Object.keys(labels).length > 0 ? { labels } : {}),
        },
        spec: {
            containers,
            ...(restartPolicy ? { restartPolicy } : {}),
            ...(nodeName ? { nodeName } : {}),
        },
    };
}

export async function* kubectlApply(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // Parse -f / --filename
    let filename: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "-f" || args[i] === "--filename") && args[i + 1]) {
            filename = args[++i];
        } else if (args[i].startsWith("-f=") || args[i].startsWith("--filename=")) {
            filename = args[i].slice(args[i].indexOf("=") + 1);
        }
    }
    if (!filename) throw Error("kubectl apply: -f <file> is required");

    const content = consumeUpload(filename);
    if (content === undefined) throw Error(`kubectl apply: cannot read file: ${filename}`);

    const docs: unknown[] = [];
    loadAll(content, doc => { if (doc !== null) docs.push(doc); });
    if (docs.length === 0) throw Error("kubectl apply: no documents found in file");

    for (const doc of docs) {
        if (!doc || typeof doc !== "object") continue;
        const r = doc as Record<string, unknown>;

        const kind = (typeof r.kind === "string" ? r.kind : "").toLowerCase();
        const meta = r.metadata as Record<string, unknown> | undefined;
        const name = typeof meta?.name === "string" ? meta.name : "";
        if (!name) { yield "kubectl apply: skipping document with no metadata.name"; continue; }

        const docNs = (typeof meta?.namespace === "string" ? meta.namespace : "") || namespace;
        const spec = r.spec as Record<string, unknown> | undefined;

        switch (kind) {
            case "deployment": {
                const template = parseTemplate(spec?.template, name, docNs);
                const image = template.spec.containers[0]?.image ?? "";
                const replicas = typeof spec?.replicas === "number" ? spec.replicas : 1;
                if (!state.Deployments.some(d => d.metadata.name === name && d.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: Deployment "${name}": containers[0].image is required`);
                    dispatch(createDeployment(name, { replicas, template }, docNs));
                    yield `deployment.apps/${name} created`;
                } else {
                    dispatch(patchResource("deployment", name, { spec }, docNs));
                    yield `deployment.apps/${name} configured`;
                }
                break;
            }
            case "service": {
                const rawPorts = Array.isArray(spec?.ports) ? spec.ports as Array<Record<string, unknown>> : [];
                const ports = rawPorts.map(p => ({
                    ...(typeof p.name === "string" ? { name: p.name } : {}),
                    port: typeof p.port === "number" ? p.port : 80,
                    targetPort: typeof p.targetPort === "number"
                        ? p.targetPort
                        : typeof p.targetPort === "string" ? p.targetPort
                        : typeof p.port === "number" ? p.port : 80,
                    ...(typeof p.protocol === "string" ? { protocol: p.protocol as "TCP" | "UDP" } : {}),
                }));
                const selector = (spec?.selector ?? {}) as Record<string, string>;
                const serviceType = (typeof spec?.type === "string" ? spec.type : "ClusterIP") as import("../types/v1/Service").ServiceType;
                if (!state.Services.some(s => s.metadata.name === name && s.metadata.namespace === docNs)) {
                    const clusterIP = `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
                    dispatch(createService(name, { selector, ports, clusterIP, serviceType }, docNs));
                    yield `service/${name} created`;
                } else {
                    dispatch(patchResource("service", name, { spec }, docNs));
                    yield `service/${name} configured`;
                }
                break;
            }
            case "daemonset": {
                const template = parseTemplate(spec?.template, name, docNs);
                const image = template.spec.containers[0]?.image ?? "";
                if (!state.DaemonSets.some(d => d.metadata.name === name && d.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: DaemonSet "${name}": containers[0].image is required`);
                    dispatch(createDaemonSet(name, { template }, docNs));
                    yield `daemonset.apps/${name} created`;
                } else {
                    dispatch(patchResource("daemonset", name, { spec }, docNs));
                    yield `daemonset.apps/${name} configured`;
                }
                break;
            }
            case "statefulset": {
                const template = parseTemplate(spec?.template, name, docNs);
                const image = template.spec.containers[0]?.image ?? "";
                const replicas = typeof spec?.replicas === "number" ? spec.replicas : 1;
                const serviceName = typeof spec?.serviceName === "string" ? spec.serviceName : name;
                if (!state.StatefulSets.some(s => s.metadata.name === name && s.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: StatefulSet "${name}": containers[0].image is required`);
                    dispatch(createStatefulSet(name, { replicas, serviceName, template }, docNs));
                    yield `statefulset.apps/${name} created`;
                } else {
                    dispatch(patchResource("statefulset", name, { spec }, docNs));
                    yield `statefulset.apps/${name} configured`;
                }
                break;
            }
            case "job": {
                const template = parseTemplate(spec?.template, name, docNs);
                const image = template.spec.containers[0]?.image ?? "";
                const completions = typeof spec?.completions === "number" ? spec.completions : 1;
                const parallelism = typeof spec?.parallelism === "number" ? spec.parallelism : 1;
                const backoffLimit = typeof spec?.backoffLimit === "number" ? spec.backoffLimit : 6;
                if (!state.Jobs.some(j => j.metadata.name === name && j.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: Job "${name}": containers[0].image is required`);
                    dispatch(createJob(name, { completions, parallelism, backoffLimit, template }, docNs));
                    yield `job.batch/${name} created`;
                } else {
                    dispatch(patchResource("job", name, { spec }, docNs));
                    yield `job.batch/${name} configured`;
                }
                break;
            }
            case "cronjob": {
                const jobSpec = (spec?.jobTemplate as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined;
                const template = parseTemplate(jobSpec?.template, name, docNs);
                const image = template.spec.containers[0]?.image ?? "";
                const schedule = typeof spec?.schedule === "string" ? spec.schedule : "";
                const completions = typeof jobSpec?.completions === "number" ? jobSpec.completions : 1;
                const parallelism = typeof jobSpec?.parallelism === "number" ? jobSpec.parallelism : 1;
                const backoffLimit = typeof jobSpec?.backoffLimit === "number" ? jobSpec.backoffLimit : 6;
                if (!state.CronJobs.some(c => c.metadata.name === name && c.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: CronJob "${name}": jobTemplate containers[0].image is required`);
                    if (!schedule) throw Error(`kubectl apply: CronJob "${name}": spec.schedule is required`);
                    dispatch(createCronJob(name, { schedule, completions, parallelism, backoffLimit, template }, docNs));
                    yield `cronjob.batch/${name} created`;
                } else {
                    dispatch(patchResource("cronjob", name, { spec }, docNs));
                    yield `cronjob.batch/${name} configured`;
                }
                break;
            }
            default:
                yield `kubectl apply: warning: unsupported kind "${r.kind}" — skipped`;
        }
    }
}
