import type { AppState } from "../store/store";

const COUNT = 4;
const INTERVAL_MS = 1000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function* ping(args: string[], state: AppState): AsyncGenerator<string> {
    const target = args[0];
    if (!target) {
        yield "ping: missing host/IP"; return;
    }

    // Resolve DNS name → service clusterIP.
    // Accepted forms (default namespace assumed when omitted):
    //   <name>
    //   <name>.<namespace>
    //   <name>.<namespace>.svc
    //   <name>.<namespace>.svc.cluster.local
    const resolveToSvc = (host: string) => {
        const parts = host.split(".");
        if (parts.length === 3 && parts[2] !== "svc") return undefined;
        if (parts.length === 5 && (parts[2] !== "svc" || parts[3] !== "cluster" || parts[4] !== "local")) return undefined;
        if (parts.length > 5 || parts.length === 4) return undefined;
        const svcName = parts[0];
        const ns = parts[1] ?? "default";
        return state.Services.find(
            s => s.metadata.name === svcName &&
                (parts.length === 1 ? true : s.metadata.namespace === ns),
        );
    };

    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(target);

    let resolvedIP = target;
    const lookedUpSvc = isIP
        ? state.Services.find(s => s.spec.clusterIP === target)
        : resolveToSvc(target);

    if (!isIP && lookedUpSvc) {
        resolvedIP = lookedUpSvc.spec.clusterIP;
    }

    const pod = state.Pods.find(p => p.status.podIP === resolvedIP);

    // Unreachable cases: no pod behind the IP, or service has no endpoints
    if (!pod) {
        if (lookedUpSvc) {
            const ep = state.Endpoints.find(
                e => e.metadata.name === lookedUpSvc!.metadata.name &&
                        e.metadata.namespace === lookedUpSvc!.metadata.namespace,
            );
            const addresses = ep?.subsets.flatMap(s => s.addresses) ?? [];
            if (addresses.length === 0) {
                yield `ping: connect to host ${target}: Connection refused`; return;
            }
        } else {
            yield `ping: cannot resolve ${target}: Name or service not known`; return;
        }
    } else if (pod.status.phase !== "Running") {
        yield `ping: connect to host ${target}: Connection refused`; return;
    }

    // Emit header line immediately, then one reply per second
    const rtt = () => (0.03 + Math.random() * 0.04).toFixed(3);
    yield `PING ${target} (${resolvedIP}): 56 data bytes`;
    for (let seq = 0; seq < COUNT; seq++) {
        await sleep(INTERVAL_MS);
        yield `64 bytes from ${resolvedIP}: icmp_seq=${seq} ttl=64 time=${rtt()} ms`;
    }
    yield `\n--- ${target} ping statistics ---`;
    yield `${COUNT} packets transmitted, ${COUNT} packets received, 0.0% packet loss`;
}