import type { AppState } from "../../store/store";
import { resolveFieldRef } from "./pod-metadata";

/**
 * Resolve environment variables for a container in a pod.
 * Handles env, envFrom (ConfigMap, Secret), and DownwardAPI field references.
 * 
 * Order of precedence (lower priority first):
 * 1. envFrom (ConfigMaps/Secrets) - lowest priority
 * 2. env entries - override envFrom
 * 3. standard env vars set by kubelet - highest priority, override all
 */
export function resolveEnv(
    pod: AppState["Pods"][number],
    containerName: string,
    state: AppState,
): Array<[string, string]> {
    const container = pod.spec.containers.find(c => c.name === containerName);
    if (!container) {
        return [];
    }

    const ns = pod.metadata.namespace;
    const resolved: Record<string, string> = {};

    // 1) Handle envFrom array first (ConfigMaps/Secrets) - lower priority
    for (const ef of container.envFrom ?? []) {
        if (ef.configMapRef) {
            const cm = state.ConfigMaps.find(c => c.metadata.name === ef.configMapRef!.name && c.metadata.namespace === ns);
            if (cm) {
                for (const [k, v] of Object.entries(cm.data ?? {})) {
                    const envName = ef.prefix ? ef.prefix + k : k;
                    resolved[envName] = v;
                }
            }
        } else if (ef.secretRef) {
            const sec = state.Secrets.find(s => s.metadata.name === ef.secretRef!.name && s.metadata.namespace === ns);
            if (sec) {
                for (const [k, v] of Object.entries(sec.data ?? {})) {
                    const envName = ef.prefix ? ef.prefix + k : k;
                    resolved[envName] = v;
                }
            }
        }
    }

    // 2) Handle env array - higher priority, overrides envFrom
    for (const e of container.env ?? []) {
        if (e.value !== undefined) {
            resolved[e.name] = e.value;
        } else if (e.valueFrom?.configMapKeyRef) {
            const ref = e.valueFrom.configMapKeyRef;
            const cm = state.ConfigMaps.find(c => c.metadata.name === ref.name && c.metadata.namespace === ns);
            if (cm && cm.data?.[ref.key]) {
                resolved[e.name] = cm.data[ref.key];
            }
        } else if (e.valueFrom?.secretKeyRef) {
            const ref = e.valueFrom.secretKeyRef;
            const sec = state.Secrets.find(s => s.metadata.name === ref.name && s.metadata.namespace === ns);
            if (sec && sec.data?.[ref.key]) {
                resolved[e.name] = sec.data[ref.key];
            }
        } else if (e.valueFrom?.fieldRef) {
            resolved[e.name] = resolveFieldRef(e.valueFrom.fieldRef.fieldPath, pod);
        }
    }

    // 3) Add standard env vars set by kubelet (overrides all)
    resolved["HOSTNAME"] = pod.metadata.name;

    return Object.entries(resolved);
}
