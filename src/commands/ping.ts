import type { AppState } from "../store/store";
import { lookupClusterDNS } from "./dns";

const COUNT = 4;
const INTERVAL_MS = 1000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function* ping(args: string[], state: AppState): AsyncGenerator<string> {
    const target = args[0];
    if (!target) {
        yield "ping: missing host/IP"; return;
    }

    const records = lookupClusterDNS(target, state);
    if (records.length === 0) {
        yield `ping: cannot resolve ${target}: Name or service not known`; return;
    }

    const allAddresses = records.flatMap(r => r.addresses);
    if (allAddresses.length === 0) {
        yield `ping: connect to host ${target}: Connection refused`; return;
    }

    // For headless services multiple A records are returned; pick one (simulates OS resolver).
    const resolvedIP = allAddresses[Math.floor(Math.random() * allAddresses.length)];

    // Check the pod behind this IP is Running.
    const pod = state.Pods.find(p => p.status.podIP === resolvedIP);
    if (pod) {
        if (pod.status.phase !== "Running") {
            yield `ping: connect to host ${target}: Connection refused`; return;
        }
    } else {
        // resolvedIP is a service VIP — verify at least one ready endpoint exists.
        const svc = state.Services.find(s => s.spec.clusterIP === resolvedIP);
        if (svc) {
            const ep = state.Endpoints.find(
                e => e.metadata.name === svc.metadata.name && e.metadata.namespace === svc.metadata.namespace,
            );
            if ((ep?.subsets.flatMap(s => s.addresses) ?? []).length === 0) {
                yield `ping: connect to host ${target}: Connection refused`; return;
            }
        }
    }

    const rtt = () => (0.03 + Math.random() * 0.04).toFixed(3);
    yield `PING ${target} (${resolvedIP}): 56 data bytes`;
    for (let seq = 0; seq < COUNT; seq++) {
        await sleep(INTERVAL_MS);
        yield `64 bytes from ${resolvedIP}: icmp_seq=${seq} ttl=64 time=${rtt()} ms`;
    }
    yield `\n--- ${target} ping statistics ---`;
    yield `${COUNT} packets transmitted, ${COUNT} packets received, 0.0% packet loss`;
}