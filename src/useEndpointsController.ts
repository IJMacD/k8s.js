import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "./store";
import { updateEndpoints } from "./store";
import type { EndpointSubset } from "./types/v1/Service";

/**
 * Simulates the Kubernetes endpoints controller.
 * Watches Services and Pods; for each Service, builds an Endpoints object
 * whose addresses contain only Ready pods whose labels match the service selector.
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

            const subset: EndpointSubset = {
                addresses: readyPods.map(p => ({
                    ip: p.status.podIP!,
                    targetRef: { kind: "Pod", name: p.metadata.name, namespace: p.metadata.namespace },
                })),
                ports: ports.map(p => ({ port: p.targetPort, protocol: p.protocol })),
            };

            const currentEp = Endpoints.find(
                e => e.metadata.name === name && e.metadata.namespace === namespace,
            );

            // Only dispatch if something actually changed
            const currentAddresses = currentEp?.subsets[0]?.addresses ?? [];
            const currentIPs = new Set(currentAddresses.map(a => a.ip));
            const newIPs = new Set(readyPods.map(p => p.status.podIP!));
            const changed =
                currentIPs.size !== newIPs.size ||
                [...newIPs].some(ip => !currentIPs.has(ip));

            if (changed) {
                dispatch(updateEndpoints({
                    metadata: { name, namespace },
                    subsets: readyPods.length > 0 ? [subset] : [],
                }));
            }
        }
    }, [Services, Pods, Endpoints, dispatch]);
}
