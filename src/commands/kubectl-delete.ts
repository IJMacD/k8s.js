import type { ActionDispatch } from "react";
import {
    deleteConfigMap,
    deleteCronJob,
    deleteDaemonSet,
    deleteDeployment,
    deleteJob,
    deleteNode,
    deletePersistentVolume,
    deletePersistentVolumeClaim,
    deleteStorageClass,
    deletePod,
    deleteReplicaSet,
    deleteSecret,
    deleteService,
    deleteStatefulSet,
    type Action,
    type AppState,
} from "../store/store";
import { kindAliases } from "./helpers/resource-types";

export async function* kubectlDelete(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
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

    const kind = kindAliases[resourceType] ?? null;
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
            case "statefulset": names = state.StatefulSets.filter(sts => sts.metadata.namespace === namespace).map(sts => sts.metadata.name); break;
            case "configmap": names = state.ConfigMaps.filter(cm => cm.metadata.namespace === namespace).map(cm => cm.metadata.name); break;
            case "secret": names = state.Secrets.filter(s => s.metadata.namespace === namespace).map(s => s.metadata.name); break;
            case "persistentvolume": names = state.PersistentVolumes.map(pv => pv.metadata.name); break;
            case "persistentvolumeclaim": names = state.PersistentVolumeClaims.filter(pvc => pvc.metadata.namespace === namespace).map(pvc => pvc.metadata.name); break;
            case "storageclass": names = state.StorageClasses.map(sc => sc.metadata.name); break;
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
            case "statefulset": {
                const sts = state.StatefulSets.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
                if (!sts) throw Error(`Error from server (NotFound): statefulsets "${name}" not found`);
                dispatch(deleteStatefulSet(name, namespace));
                lines.push(`statefulset.apps "${name}" deleted`);
                break;
            }
            case "node": {
                const node = state.Nodes.find(n => n.metadata.name === name);
                if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
                // Evict all pods on this node before removing
                const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
                for (const pod of nodePods) dispatch(deletePod(pod.metadata.name, pod.metadata.namespace));
                dispatch(deleteNode(name));
                lines.push(`node "${name}" deleted`);
                break;
            }
            case "configmap": {
                const cm = state.ConfigMaps.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
                if (!cm) throw Error(`Error from server (NotFound): configmaps "${name}" not found`);
                dispatch(deleteConfigMap(name, namespace));
                lines.push(`configmap "${name}" deleted`);
                break;
            }
            case "secret": {
                const sec = state.Secrets.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
                if (!sec) throw Error(`Error from server (NotFound): secrets "${name}" not found`);
                dispatch(deleteSecret(name, namespace));
                lines.push(`secret "${name}" deleted`);
                break;
            }
            case "persistentvolume": {
                const pv = state.PersistentVolumes.find(p => p.metadata.name === name);
                if (!pv) throw Error(`Error from server (NotFound): persistentvolumes "${name}" not found`);
                dispatch(deletePersistentVolume(name));
                lines.push(`persistentvolume "${name}" deleted`);
                break;
            }
            case "persistentvolumeclaim": {
                const pvc = state.PersistentVolumeClaims.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
                if (!pvc) throw Error(`Error from server (NotFound): persistentvolumeclaims "${name}" not found`);
                dispatch(deletePersistentVolumeClaim(name, namespace));
                lines.push(`persistentvolumeclaim "${name}" deleted`);
                break;
            }
            case "storageclass": {
                const sc = state.StorageClasses.find(s => s.metadata.name === name);
                if (!sc) throw Error(`Error from server (NotFound): storageclasses "${name}" not found`);
                dispatch(deleteStorageClass(name));
                lines.push(`storageclass.storage.k8s.io "${name}" deleted`);
                break;
            }
        }
    }
    yield lines.join("\n") || "No resources deleted.";
}
