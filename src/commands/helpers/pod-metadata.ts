import type { AppState } from "../../store/store";

/**
 * Resolves a field reference from the Downward API.
 * Used by DownwardAPI volumes and environment variables.
 */
export function resolveFieldRef(fieldPath: string, pod: AppState["Pods"][number]): string {
    switch (fieldPath) {
        case "metadata.name":      return pod.metadata.name;
        case "metadata.namespace": return pod.metadata.namespace;
        case "metadata.uid":       return pod.metadata.uid;
        case "status.podIP":       return pod.status.podIP ?? "";
        case "status.hostIP":      return pod.status.hostIP ?? "";
        case "spec.nodeName":      return pod.spec.nodeName ?? "";
        case "spec.serviceAccountName": return pod.spec.serviceAccountName ?? "default";
        default: {
            const lm = fieldPath.match(/^metadata\.labels\['(.+)'\]$/);
            if (lm) return pod.metadata.labels?.[lm[1]] ?? "";
            const am = fieldPath.match(/^metadata\.annotations\['(.+)'\]$/);
            if (am) return pod.metadata.annotations?.[am[1]] ?? "";
            return `(${fieldPath})`;
        }
    }
}
