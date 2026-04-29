import { useEffect } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { createService, updateEndpoints } from "../store/store";

/**
 * Simulates the kube-apiserver's built-in reconciliation of the kubernetes service.
 * In real Kubernetes, the API server ensures the "kubernetes" service and its endpoints
 * always exist in the default namespace, pointing to the API server itself.
 * 
 * This controller recreates them if they are deleted or missing.
 */
export function useKubernetesServiceController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { Services, Endpoints } = state;

    useEffect(() => {
        const now = new Date().toISOString();

        // Check if kubernetes service exists
        const kubernetesSvc = Services.find(
            s => s.metadata.name === 'kubernetes' && s.metadata.namespace === 'default'
        );

        if (!kubernetesSvc) {
            // Recreate the kubernetes service
            dispatch(createService('kubernetes', {
                selector: {},
                ports: [
                    { name: 'https', protocol: 'TCP', port: 443, targetPort: 6443 },
                ],
                clusterIP: '10.96.0.1',
                serviceType: 'ClusterIP',
            }, 'default'));
        }

        // Check if kubernetes endpoints exist
        const kubernetesEp = Endpoints.find(
            e => e.metadata.name === 'kubernetes' && e.metadata.namespace === 'default'
        );

        if (!kubernetesEp) {
            // Recreate the kubernetes endpoints
            dispatch(updateEndpoints({
                metadata: {
                    uid: crypto.randomUUID(),
                    name: 'kubernetes',
                    namespace: 'default',
                    creationTimestamp: now,
                },
                subsets: [
                    {
                        addresses: [
                            {
                                ip: '192.168.0.254',
                            },
                        ],
                        ports: [
                            { name: 'https', port: 6443, protocol: 'TCP' },
                        ],
                    },
                ],
            }));
        }
    }, [Services, Endpoints, dispatch]);
}
