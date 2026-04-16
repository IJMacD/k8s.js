import type { AppState } from "../store/store";

type PodTemplate = {
    metadata: { labels?: Record<string, string> };
    spec: { containers: import("../types/v1/Pod").Container[] };
};

function fmtEnvLines(env: import("../types/v1/Pod").EnvRecord[] | undefined): string[] {
    if (!env?.length) return [`    Environment:  <none>`];
    return [
        `    Environment:`,
        ...env.map(e => {
            if (e.value != null) return `      ${e.name}:  ${e.value}`;
            if (e.valueFrom?.fieldRef) return `      ${e.name}:   (${e.valueFrom.fieldRef.apiVersion}:${e.valueFrom.fieldRef.fieldPath})`;
            if (e.valueFrom?.configMapKeyRef) return `      ${e.name}:  <set to the key '${e.valueFrom.configMapKeyRef.key}' in configmap '${e.valueFrom.configMapKeyRef.name}'>`;
            if (e.valueFrom?.secretKeyRef) return `      ${e.name}:  <set to the key '${e.valueFrom.secretKeyRef.key}' in secret '${e.valueFrom.secretKeyRef.name}'>`;
            return `      ${e.name}:  <set>`;
        }),
    ];
}

function podTemplateLines(template: PodTemplate): string[] {
    const fmtPort = (p: import("../types/v1/Pod").ContainerPort) =>
        p.name ? `${p.containerPort}/${p.protocol ?? "TCP"} (${p.name})` : `${p.containerPort}/${p.protocol ?? "TCP"}`;
    return [
        `Pod Template:`,
        `  Labels:  ${Object.entries(template.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "<none>"}`,
        `  Containers:`,
        ...template.spec.containers.flatMap(c => [
            `   ${c.name}:`,
            `    Image:       ${c.image}`,
            `    Port:        ${c.ports?.length ? c.ports.map(fmtPort).join(", ") : "<none>"}`,
            ...fmtEnvLines(c.env),
        ]),
    ];
}

export async function* kubectlDescribe(
    args: string[],
    namespace: string,
    state: AppState,
): AsyncGenerator<string> {
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
            ...podTemplateLines(ds.spec.template),
            `Update Strategy: ${ds.spec.updateStrategy.type}`,
            `Events:  <none>`,
        ];
        yield lines.join("\n"); return;
    }

    if (resourceArg.startsWith("statefulset/") || resourceArg.startsWith("sts/") || args[1] === "statefulset" || args[1] === "sts") {
        const name = resolveName();
        if (!name) throw Error("kubectl describe statefulset: missing name");
        const sts = state.StatefulSets.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
        if (!sts) throw Error(`Error from server (NotFound): statefulsets "${name}" not found`);

        const ownedPods = state.Pods.filter(
            p => p.metadata.ownerReferences?.some(r => r.kind === "StatefulSet" && r.name === name) && p.metadata.namespace === namespace,
        );
        const runningCount = ownedPods.filter(p => p.status.phase === "Running").length;
        const pendingCount = ownedPods.filter(p => p.status.phase === "Pending").length;
        const lines = [
            `Name:               ${sts.metadata.name}`,
            `Namespace:          ${sts.metadata.namespace}`,
            `CreationTimestamp:  ${sts.metadata.creationTimestamp}`,
            `Selector:           ${Object.entries(sts.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(",")}`,
            `Labels:             ${Object.entries(sts.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                    ") || "<none>"}`,
            `Annotations:        ${Object.entries(sts.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                    ") || "<none>"}`,
            `Replicas:           ${sts.spec.replicas} desired | ${sts.status.updatedReplicas} total`,
            `Update Strategy:    ${sts.spec.updateStrategy?.type ?? "RollingUpdate"}`,
            `  Partition:        0`,
            `Pod Management Policy:  ${sts.spec.podManagementPolicy ?? "OrderedReady"}`,
            `Pods Status:        ${runningCount} Running / ${pendingCount} Waiting / 0 Succeeded / 0 Failed`,
            ...podTemplateLines(sts.spec.template),
            `Volume Claim Templates:  <none>`,
            `Service Name:  ${sts.spec.serviceName}`,
            `Events:        <none>`,
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
            ...podTemplateLines(dep.spec.template),
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
        const lines = [
            `Name:           ${rs.metadata.name}`,
            `Namespace:      ${rs.metadata.namespace}`,
            `Selector:       ${Object.entries(rs.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(",")}`,
            `Labels:         ${Object.entries(rs.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
            `Annotations:    ${Object.entries(rs.metadata.annotations).map(([k, v]) => `${k}=${v}`).join("\n                ") || "<none>"}`,
            ...(ownerDep ? [`Controlled By:  Deployment/${ownerDep.name}`] : []),
            `Replicas:       ${rs.status.replicas} current / ${rs.spec.replicas} desired`,
            `Pods Status:    ${runningCount} Running / ${waitingCount} Waiting / ${succeededCount} Succeeded / ${failedCount} Failed`,
            ...podTemplateLines(rs.spec.template),
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

        const containerStateLines = (c: { name: string; image: string; ports?: import("../types/v1/Pod").ContainerPort[]; env?: import("../types/v1/Pod").EnvRecord[] }): string[] => {
            const fmtPort = (p: import("../types/v1/Pod").ContainerPort) =>
                p.name ? `${p.containerPort}/${p.protocol ?? "TCP"} (${p.name})` : `${p.containerPort}/${p.protocol ?? "TCP"}`;
            const base = [
                `   ${c.name}:`,
                `    Image:          ${c.image}`,
                `    Port:           ${c.ports?.length ? c.ports.map(fmtPort).join(", ") : "<none>"}`,
                `    Host Port:      0/TCP`,
                ...fmtEnvLines(c.env),
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
                    // Unscheduled (no nodeName yet): container has not started creating
                    if (!pod.spec.nodeName) {
                        return [...base,
                            `    State:          Waiting`,
                            `    Ready:          False`,
                            `    Restart Count:  0`,
                        ];
                    }
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
            if (!pod.spec.nodeName) {
                const readyNodeCount = state.Nodes.filter(
                    n => !n.spec.unschedulable &&
                        n.status.conditions.find(c => c.type === "Ready")?.status === "True",
                ).length;
                const total = state.Nodes.length;
                const msg = total === 0
                    ? `no nodes available to schedule pods`
                    : `0/${readyNodeCount} nodes are available: insufficient cpu or memory.`;
                return [
                    ...header,
                    `  Warning  FailedScheduling  <unk>    default-scheduler  ${msg}`,
                ];
            }
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
            ...((): string[] => {
                const stored = pod.status.conditions ?? [];
                const hasPodScheduled = stored.some(c => c.type === "PodScheduled");
                // Synthesize PodScheduled: False for pods the scheduler hasn't placed yet
                const conditions = (!pod.spec.nodeName && !hasPodScheduled)
                    ? [{ type: "PodScheduled", status: "False" as const }, ...stored]
                    : stored;
                return conditions.length > 0
                    ? conditions.map(c => `  ${c.type.padEnd(17)} ${c.status}`)
                    : [`  <none>`];
            })(),
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
            ...svc.spec.ports.map(p => `Port:                     ${p.name ? `${p.name}  ` : "<unset>  "}${p.port}/TCP`),
            ...svc.spec.ports.map(p => `TargetPort:               ${typeof p.targetPort === "string" ? p.targetPort : `${p.targetPort}/TCP`}`),
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
