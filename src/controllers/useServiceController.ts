import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { patchResource } from "../store/store";

/**
 * Simulates the Kubernetes cloud-controller-manager's LoadBalancer reconciler.
 * Watches Services; for each LoadBalancer-type service without a populated
 * loadBalancer.ingress, assigns a unique 203.0.113.x IP (RFC 5737 TEST-NET-3).
 */
export function useServiceController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Services } = state;

    useEffect(() => {
        // Build the set of IPs already assigned across all services so that
        // multiple services missing ingress in the same render cycle each get
        // a distinct address.
        const usedIPs = new Set(
            Services.flatMap(s =>
                s.status.loadBalancer?.ingress?.map(i => i.ip).filter(Boolean) as string[] ?? []
            )
        );

        let octet = 1;
        const pickIP = (): string => {
            while (octet <= 254) {
                const ip = `203.0.113.${octet++}`;
                if (!usedIPs.has(ip)) {
                    usedIPs.add(ip);
                    return ip;
                }
            }
            return "203.0.113.255";
        };

        for (const svc of Services) {
            if (svc.spec.type !== "LoadBalancer") continue;
            if (svc.spec.clusterIP === "None") continue;
            const hasIngress = (svc.status.loadBalancer?.ingress ?? []).some(i => i.ip || i.hostname);
            if (hasIngress) continue;

            const ip = pickIP();
            dispatch(patchResource(
                "service",
                svc.metadata.name,
                { status: { loadBalancer: { ingress: [{ ip }] } } },
                svc.metadata.namespace,
            ));
        }
    }, [Services, dispatch]);
}
