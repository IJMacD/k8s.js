import { describe, it, expect, vi } from 'vitest';
import type { Service } from '../types/v1/Service';
import { createTestState } from './helpers';

vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
        ...actual,
        useEffect: (effect: () => void) => effect(),
    };
});

import { useServiceController } from '../controllers/useServiceController';

function createLoadBalancerService(name: string, opts?: { loadBalancerClass?: string }): Service {
    return {
        metadata: {
            uid: crypto.randomUUID(),
            name,
            namespace: 'default',
            labels: {},
            annotations: {},
            creationTimestamp: new Date().toISOString(),
        },
        spec: {
            type: 'LoadBalancer',
            selector: { app: name },
            ports: [
                {
                    port: 80,
                    targetPort: 80,
                    protocol: 'TCP',
                },
            ],
            clusterIP: '10.96.0.10',
            ...(opts?.loadBalancerClass ? { loadBalancerClass: opts.loadBalancerClass } : {}),
        },
        status: {},
    };
}

describe('useServiceController', () => {
    it('assigns an ingress IP for default LoadBalancer services', () => {
        const state = createTestState();
        state.Services.push(createLoadBalancerService('web'));

        const dispatch = vi.fn();
        useServiceController(state, dispatch);

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'PATCH_RESOURCE',
            payload: {
                kind: 'service',
                name: 'web',
                namespace: 'default',
                patch: {
                    status: {
                        loadBalancer: {
                            ingress: [{ ip: '203.0.113.1' }],
                        },
                    },
                },
            },
        });
    });

    it('does not assign ingress IP when spec.loadBalancerClass is set', () => {
        const state = createTestState();
        state.Services.push(createLoadBalancerService('web', { loadBalancerClass: 'example.com/my-lb' }));

        const dispatch = vi.fn();
        useServiceController(state, dispatch);

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('assigns distinct ingress IPs to multiple LoadBalancer services', () => {
        const state = createTestState();
        state.Services.push(createLoadBalancerService('web-a'));
        state.Services.push(createLoadBalancerService('web-b'));

        const dispatch = vi.fn();
        useServiceController(state, dispatch);

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch).toHaveBeenNthCalledWith(1, {
            type: 'PATCH_RESOURCE',
            payload: {
                kind: 'service',
                name: 'web-a',
                namespace: 'default',
                patch: {
                    status: {
                        loadBalancer: {
                            ingress: [{ ip: '203.0.113.1' }],
                        },
                    },
                },
            },
        });
        expect(dispatch).toHaveBeenNthCalledWith(2, {
            type: 'PATCH_RESOURCE',
            payload: {
                kind: 'service',
                name: 'web-b',
                namespace: 'default',
                patch: {
                    status: {
                        loadBalancer: {
                            ingress: [{ ip: '203.0.113.2' }],
                        },
                    },
                },
            },
        });
    });
});
