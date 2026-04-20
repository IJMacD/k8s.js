import type { ActionDispatch } from "react";
import type { Container, Probe, PodTemplateSpec, Volume } from "../types/v1/Pod";
import {
    createConfigMap,
    createCronJob,
    createDaemonSet,
    createDeployment,
    createJob,
    createPersistentVolume,
    createPersistentVolumeClaim,
    createSecret,
    createService,
    createStatefulSet,
    createStorageClass,
    patchResource,
    type Action,
    type AppState,
} from "../store/store";
import type { AccessMode } from "../types/v1/PersistentVolume";
import { readFile } from "./helpers/filesystem";

/** Parse a raw containers/initContainers array, normalising types */
function parseProbe(raw: unknown): Probe | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    const probe: Probe = {};
    if (typeof r.initialDelaySeconds === "number") probe.initialDelaySeconds = r.initialDelaySeconds;
    if (typeof r.periodSeconds       === "number") probe.periodSeconds       = r.periodSeconds;
    if (typeof r.timeoutSeconds      === "number") probe.timeoutSeconds      = r.timeoutSeconds;
    if (typeof r.successThreshold    === "number") probe.successThreshold    = r.successThreshold;
    if (typeof r.failureThreshold    === "number") probe.failureThreshold    = r.failureThreshold;
    if (r.httpGet && typeof r.httpGet === "object") {
        const hg = r.httpGet as Record<string, unknown>;
        probe.httpGet = {
            path: typeof hg.path === "string" ? hg.path : "/",
            port: typeof hg.port === "number" ? hg.port : String(hg.port ?? 80),
            ...(typeof hg.scheme === "string" ? { scheme: hg.scheme as "HTTP" | "HTTPS" } : {}),
        };
    }
    if (r.tcpSocket && typeof r.tcpSocket === "object") {
        const ts = r.tcpSocket as Record<string, unknown>;
        probe.tcpSocket = { port: typeof ts.port === "number" ? ts.port : String(ts.port ?? 80) };
    }
    if (r.exec && typeof r.exec === "object") {
        const ex = r.exec as Record<string, unknown>;
        probe.exec = { command: Array.isArray(ex.command) ? (ex.command as string[]) : [] };
    }
    return probe;
}

function parseContainerArray(raw: unknown): Container[] | undefined {
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
        ...(Array.isArray(c.envFrom) && c.envFrom.length > 0 ? { envFrom: c.envFrom as Container["envFrom"] } : {}),
        ...(Array.isArray(c.env) && c.env.length > 0 ? { env: c.env as Container["env"] } : {}),
        ...(Array.isArray(c.volumeMounts) && c.volumeMounts.length > 0 ? { volumeMounts: c.volumeMounts as Container["volumeMounts"] } : {}),
        ...(parseProbe(c.readinessProbe) ? { readinessProbe: parseProbe(c.readinessProbe) } : {}),
        ...(parseProbe(c.livenessProbe)  ? { livenessProbe:  parseProbe(c.livenessProbe)  } : {}),
        ...(parseProbe(c.startupProbe)   ? { startupProbe:   parseProbe(c.startupProbe)   } : {}),
    }));
}

/** Parse the containers array out of a raw pod spec object, normalising types */
function parseContainers(podSpec: unknown): Container[] | undefined {
    return parseContainerArray((podSpec as Record<string, unknown> | undefined)?.containers);
}

/** Build a PodTemplateSpec from a raw YAML template object */
function parseTemplate(rawTemplate: unknown, defaultName: string, defaultNamespace: string): PodTemplateSpec {
    const tmpl = rawTemplate as Record<string, unknown> | undefined;
    const rawMeta = tmpl?.metadata as Record<string, unknown> | undefined;
    const labels = (rawMeta?.labels ?? {}) as Record<string, string>;
    const rawSpec = tmpl?.spec as Record<string, unknown> | undefined;
    const containers = parseContainers(rawSpec) ?? [];
    const initContainers = parseContainerArray(rawSpec?.initContainers);
    const restartPolicy = typeof rawSpec?.restartPolicy === "string"
        ? rawSpec.restartPolicy as "Always" | "OnFailure" | "Never"
        : undefined;
    const nodeName = typeof rawSpec?.nodeName === "string" ? rawSpec.nodeName : undefined;
    // Parse volumes (e.g. PVC references)
    const rawVolumes = Array.isArray(rawSpec?.volumes) ? rawSpec.volumes as Array<Record<string, unknown>> : [];
    const volumes: Volume[] = rawVolumes.map(v => ({
        name: typeof v.name === "string" ? v.name : "",
        ...(v.persistentVolumeClaim && typeof v.persistentVolumeClaim === "object"
            ? { persistentVolumeClaim: v.persistentVolumeClaim as Volume["persistentVolumeClaim"] }
            : {}),
        ...(v.configMap && typeof v.configMap === "object"
            ? { configMap: v.configMap as Volume["configMap"] }
            : {}),
        ...(v.secret && typeof v.secret === "object"
            ? { secret: v.secret as Volume["secret"] }
            : {}),
        ...(v.emptyDir !== undefined
            ? { emptyDir: (typeof v.emptyDir === "object" && v.emptyDir !== null ? v.emptyDir : {}) as Volume["emptyDir"] }
            : {}),
        ...(v.hostPath && typeof v.hostPath === "object"
            ? { hostPath: v.hostPath as Volume["hostPath"] }
            : {}),
    }));
    return {
        metadata: {
            name: defaultName,
            namespace: defaultNamespace,
            ...(Object.keys(labels).length > 0 ? { labels } : {}),
        },
        spec: {
            containers,
            ...(initContainers?.length ? { initContainers } : {}),
            ...(restartPolicy ? { restartPolicy } : {}),
            ...(nodeName ? { nodeName } : {}),
            ...(volumes.length > 0 ? { volumes } : {}),
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

    const content = readFile(filename);
    if (content === undefined) throw Error(`kubectl apply: cannot read file: ${filename}`);

    const { loadAll } = await import("js-yaml");
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
                const revisionHistoryLimit = typeof spec?.revisionHistoryLimit === "number" ? spec.revisionHistoryLimit : undefined;
                const minReadySeconds = typeof spec?.minReadySeconds === "number" ? spec.minReadySeconds : undefined;
                const rawStrategy = spec?.strategy as Record<string, unknown> | undefined;
                const strategy = rawStrategy?.type === "Recreate"
                    ? { type: "Recreate" as const }
                    : rawStrategy?.type === "RollingUpdate"
                        ? {
                            type: "RollingUpdate" as const,
                            rollingUpdate: {
                                maxUnavailable: String((rawStrategy.rollingUpdate as Record<string, unknown> | undefined)?.maxUnavailable ?? "25%"),
                                maxSurge: String((rawStrategy.rollingUpdate as Record<string, unknown> | undefined)?.maxSurge ?? "25%"),
                            },
                        }
                        : undefined;
                if (!state.Deployments.some(d => d.metadata.name === name && d.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: Deployment "${name}": containers[0].image is required`);
                    dispatch(createDeployment(name, { replicas, template, strategy, revisionHistoryLimit, minReadySeconds }, docNs));
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
                    const clusterIP = spec?.clusterIP === "None"
                        ? "None"
                        : `10.96.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
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
                const rawVCTs = Array.isArray(spec?.volumeClaimTemplates) ? spec.volumeClaimTemplates as Array<Record<string, unknown>> : [];
                const volumeClaimTemplates: import("../types/apps/v1/StatefulSet").VolumeClaimTemplate[] = rawVCTs.map(vct => {
                    const vctMeta = vct.metadata as Record<string, unknown> | undefined;
                    const vctSpec = vct.spec as Record<string, unknown> | undefined;
                    const resources = vctSpec?.resources as Record<string, unknown> | undefined;
                    const requests = resources?.requests as Record<string, string> | undefined;
                    return {
                        metadata: {
                            name: typeof vctMeta?.name === "string" ? vctMeta.name : "",
                            ...(vctMeta?.labels && typeof vctMeta.labels === "object" ? { labels: vctMeta.labels as Record<string, string> } : {}),
                            ...(vctMeta?.annotations && typeof vctMeta.annotations === "object" ? { annotations: vctMeta.annotations as Record<string, string> } : {}),
                        },
                        spec: {
                            accessModes: (Array.isArray(vctSpec?.accessModes) ? vctSpec.accessModes : ["ReadWriteOnce"]) as import("../types/v1/PersistentVolume").AccessMode[],
                            resources: { requests: { storage: requests?.storage ?? "1Gi" } },
                            ...(typeof vctSpec?.storageClassName === "string" ? { storageClassName: vctSpec.storageClassName } : {}),
                            ...(typeof vctSpec?.volumeMode === "string" ? { volumeMode: vctSpec.volumeMode as "Filesystem" | "Block" } : {}),
                        },
                    };
                });
                if (!state.StatefulSets.some(s => s.metadata.name === name && s.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: StatefulSet "${name}": containers[0].image is required`);
                    dispatch(createStatefulSet(name, { replicas, serviceName, template, ...(volumeClaimTemplates.length > 0 ? { volumeClaimTemplates } : {}) }, docNs));
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
                const successfulJobsHistoryLimit = typeof spec?.successfulJobsHistoryLimit === "number" ? spec.successfulJobsHistoryLimit : 3;
                const failedJobsHistoryLimit = typeof spec?.failedJobsHistoryLimit === "number" ? spec.failedJobsHistoryLimit : 1;
                if (!state.CronJobs.some(c => c.metadata.name === name && c.metadata.namespace === docNs)) {
                    if (!image) throw Error(`kubectl apply: CronJob "${name}": jobTemplate containers[0].image is required`);
                    if (!schedule) throw Error(`kubectl apply: CronJob "${name}": spec.schedule is required`);
                    dispatch(createCronJob(name, { schedule, completions, parallelism, backoffLimit, successfulJobsHistoryLimit, failedJobsHistoryLimit, template }, docNs));
                    yield `cronjob.batch/${name} created`;
                } else {
                    dispatch(patchResource("cronjob", name, { spec }, docNs));
                    yield `cronjob.batch/${name} configured`;
                }
                break;
            }
            case "configmap": {
                const data = (typeof r.data === "object" && r.data !== null ? r.data : {}) as Record<string, string>;
                const binaryData = (typeof r.binaryData === "object" && r.binaryData !== null ? r.binaryData : undefined) as Record<string, string> | undefined;
                const labels = (meta?.labels ?? {}) as Record<string, string>;
                const annotations = (meta?.annotations ?? {}) as Record<string, string>;
                if (!state.ConfigMaps.some(cm => cm.metadata.name === name && cm.metadata.namespace === docNs)) {
                    dispatch(createConfigMap(name, { data, binaryData, labels, annotations, creationTimestamp: new Date().toISOString() }, docNs));
                    yield `configmap/${name} created`;
                } else {
                    dispatch(patchResource("configmap", name, { data }, docNs));
                    yield `configmap/${name} configured`;
                }
                break;
            }
            case "secret": {
                const secretType = typeof r.type === "string" ? r.type : "Opaque";
                const data = (typeof r.data === "object" && r.data !== null ? r.data : {}) as Record<string, string>;
                const stringData = (typeof r.stringData === "object" && r.stringData !== null ? r.stringData : undefined) as Record<string, string> | undefined;
                const labels = (meta?.labels ?? {}) as Record<string, string>;
                const annotations = (meta?.annotations ?? {}) as Record<string, string>;
                if (!state.Secrets.some(s => s.metadata.name === name && s.metadata.namespace === docNs)) {
                    dispatch(createSecret(name, { secretType, data, stringData, labels, annotations, creationTimestamp: new Date().toISOString() }, docNs));
                    yield `secret/${name} created`;
                } else {
                    dispatch(patchResource("secret", name, { data }, docNs));
                    yield `secret/${name} configured`;
                }
                break;
            }
            case "persistentvolume": {
                const capacity = { storage: (spec?.capacity as Record<string, string> | undefined)?.storage ?? "1Gi" };
                const accessModes = (Array.isArray(spec?.accessModes) ? spec.accessModes : ["ReadWriteOnce"]) as AccessMode[];
                const persistentVolumeReclaimPolicy = (typeof spec?.persistentVolumeReclaimPolicy === "string"
                    ? spec.persistentVolumeReclaimPolicy
                    : "Retain") as "Retain" | "Delete";
                const storageClassName = typeof spec?.storageClassName === "string" ? spec.storageClassName : undefined;
                const volumeMode = (typeof spec?.volumeMode === "string" ? spec.volumeMode : undefined) as "Filesystem" | "Block" | undefined;
                const nodeAffinity = spec?.nodeAffinity as import("../types/v1/PersistentVolume").PVSpec["nodeAffinity"] | undefined;
                const hostPath = spec?.hostPath as { path: string; type?: string } | undefined;
                const nfs = spec?.nfs as { server: string; path: string; readOnly?: boolean } | undefined;
                const local = spec?.local as { path: string; fsType?: string } | undefined;
                if (!state.PersistentVolumes.some(pv => pv.metadata.name === name)) {
                    dispatch(createPersistentVolume(name, {
                        capacity, accessModes, persistentVolumeReclaimPolicy,
                        ...(storageClassName !== undefined ? { storageClassName } : {}),
                        ...(volumeMode !== undefined ? { volumeMode } : {}),
                        ...(nodeAffinity !== undefined ? { nodeAffinity } : {}),
                        ...(hostPath !== undefined ? { hostPath } : {}),
                        ...(nfs !== undefined ? { nfs } : {}),
                        ...(local !== undefined ? { local } : {}),
                        creationTimestamp: new Date().toISOString(),
                    }));
                    yield `persistentvolume/${name} created`;
                } else {
                    dispatch(patchResource("persistentvolume", name, { spec }, docNs));
                    yield `persistentvolume/${name} configured`;
                }
                break;
            }
            case "persistentvolumeclaim": {
                const resources = ((spec?.resources ?? {}) as Record<string, unknown>);
                const storage = ((resources?.requests ?? {}) as Record<string, string>).storage ?? "1Gi";
                const accessModes = (Array.isArray(spec?.accessModes) ? spec.accessModes : ["ReadWriteOnce"]) as AccessMode[];
                const storageClassName = typeof spec?.storageClassName === "string" ? spec.storageClassName : undefined;
                const volumeName = typeof spec?.volumeName === "string" ? spec.volumeName : undefined;
                const volumeMode = (typeof spec?.volumeMode === "string" ? spec.volumeMode : undefined) as "Filesystem" | "Block" | undefined;
                if (!state.PersistentVolumeClaims.some(pvc => pvc.metadata.name === name && pvc.metadata.namespace === docNs)) {
                    dispatch(createPersistentVolumeClaim(name, {
                        accessModes, storage,
                        ...(storageClassName !== undefined ? { storageClassName } : {}),
                        ...(volumeName !== undefined ? { volumeName } : {}),
                        ...(volumeMode !== undefined ? { volumeMode } : {}),
                        creationTimestamp: new Date().toISOString(),
                    }, docNs));
                    yield `persistentvolumeclaim/${name} created`;
                } else {
                    dispatch(patchResource("persistentvolumeclaim", name, { spec }, docNs));
                    yield `persistentvolumeclaim/${name} configured`;
                }
                break;
            }
            case "storageclass": {
                const provisioner = typeof r.provisioner === "string" ? r.provisioner : "";
                if (!provisioner) throw Error(`kubectl apply: StorageClass "${name}": provisioner is required`);
                const reclaimPolicy = (typeof spec?.reclaimPolicy === "string" ? spec.reclaimPolicy
                    : typeof r.reclaimPolicy === "string" ? r.reclaimPolicy
                    : "Delete") as "Retain" | "Delete";
                const volumeBindingMode = (typeof spec?.volumeBindingMode === "string" ? spec.volumeBindingMode
                    : typeof r.volumeBindingMode === "string" ? r.volumeBindingMode
                    : "Immediate") as "Immediate" | "WaitForFirstConsumer";
                const allowVolumeExpansion = typeof r.allowVolumeExpansion === "boolean" ? r.allowVolumeExpansion : undefined;
                const parameters = (typeof r.parameters === "object" && r.parameters !== null
                    ? r.parameters : undefined) as Record<string, string> | undefined;
                const labels = (meta?.labels ?? {}) as Record<string, string>;
                const annotations = (meta?.annotations ?? {}) as Record<string, string>;
                if (!state.StorageClasses.some(sc => sc.metadata.name === name)) {
                    dispatch(createStorageClass(name, {
                        provisioner, reclaimPolicy, volumeBindingMode,
                        ...(allowVolumeExpansion !== undefined ? { allowVolumeExpansion } : {}),
                        ...(parameters !== undefined ? { parameters } : {}),
                        labels,
                        annotations,
                    }));
                    yield `storageclass.storage.k8s.io/${name} created`;
                } else {
                    dispatch(patchResource("storageclass", name, { provisioner, reclaimPolicy, volumeBindingMode, allowVolumeExpansion, parameters }, docNs));
                    yield `storageclass.storage.k8s.io/${name} configured`;
                }
                break;
            }
            default:
                yield `kubectl apply: warning: unsupported kind "${r.kind}" — skipped`;
        }
    }
}
