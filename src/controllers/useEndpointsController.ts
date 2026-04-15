import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { updateEndpoints } from "../store/store";
import type { EndpointSubset } from "../types/v1/Service";
import type { Pod } from "../types/v1/Pod";

/**
 * Resolves a service targetPort (number or named port string) to a concrete
 * port number by looking up the matching named container port on a specific pod.
 */
function resolveTargetPort(targetPort: number | string, pod: Pod): number {
    if (typeof targetPort === "number") return targetPort;
    const cp = pod.spec.containers.flatMap(c => c.ports ?? []).find(p => p.name === targetPort);
    return cp?.containerPort ?? 0;
}

/**
 * Simulates the Kubernetes endpoints controller.
 * Watches Services and Pods; for each Service, builds an Endpoints object
 * whose addresses contain only Ready pods whose labels match the service selector.
 *
 * Named targetPorts are resolved per-pod, because different pods (from different
 * Deployments, StatefulSets, or created manually) may expose the same named port
 * on different port numbers. Pods whose resolved port-tuple differs are placed in
 * separate subsets, matching real Kubernetes Endpoints semantics.
 */
export function useEndpointsController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Services, Pods, Endpoints } = state;

    useEffect(() => {
        for (const svc of Services) {
            const { name, namespace } = svc.metadata;
            const { selector, ports } = svc.spec;

            // A pod matches if it is in the same namespace, is Running+Ready,
            // and has every selector label.
            const readyPods = Pods.filter(p => {
                if (p.metadata.namespace !== namespace) return false;
                if (p.status.phase !== "Running") return false;
                const isReady = p.status.conditions?.find(c => c.type === "Ready")?.status === "True";
                if (!isReady) return false;
                if (!p.status.podIP) return false;
                const podLabels = p.metadata.labels ?? {};
                return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
            });

            // Group pods by their resolved port-tuple key so that pods with different
            // port mappings (e.g. named ports resolving to different numbers) land in
            // separate subsets.
            const subsetMap = new Map<string, EndpointSubset>();
            for (const pod of readyPods) {
                const resolvedPorts = ports.map(p => ({
                    port: resolveTargetPort(p.targetPort, pod),
                    protocol: p.protocol,
                }));
                const key = resolvedPorts.map(p => `${p.port}/${p.protocol}`).join(",");
                if (!subsetMap.has(key)) {
                    subsetMap.set(key, { addresses: [], ports: resolvedPorts });
                }
                subsetMap.get(key)!.addresses.push({
                    ip: pod.status.podIP!,
                    targetRef: { kind: "Pod", name: pod.metadata.name, namespace: pod.metadata.namespace },
                });
            }
            const newSubsets = [...subsetMap.values()];

            const currentEp = Endpoints.find(
                e => e.metadata.name === name && e.metadata.namespace === namespace,
            );

            // Change-detect: compare the full set of endpoint IPs across all subsets
            const currentIPs = new Set(
                currentEp?.subsets.flatMap(s => s.addresses.map(a => a.ip)) ?? [],
            );
            const newIPs = new Set(readyPods.map(p => p.status.podIP!));
            const changed =
                currentIPs.size !== newIPs.size ||
                [...newIPs].some(ip => !currentIPs.has(ip));

            if (changed) {
                dispatch(updateEndpoints({
                    metadata: { name, namespace },
                    subsets: newSubsets,
                }));
            }
        }
    }, [Services, Pods, Endpoints, dispatch]);
}
