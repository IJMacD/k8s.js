import type { AppState } from "../store/store";

export async function ping(args: string[], state: AppState): Promise<string> {
    const target = args[0];
    if (!target) {
        return "ping: missing host/IP";
    }

    // Resolve DNS name → service clusterIP.
    // Accepted forms (default namespace assumed when omitted):
    //   <name>
    //   <name>.<namespace>
    //   <name>.<namespace>.svc
    //   <name>.<namespace>.svc.cluster.local
    const resolveToSvc = (host: string) => {
        const parts = host.split(".");
        // Reject anything with a suffix that isn't a valid k8s DNS form
        if (parts.length === 3 && parts[2] !== "svc") return undefined;
        if (parts.length === 5 && (parts[2] !== "svc" || parts[3] !== "cluster" || parts[4] !== "local")) return undefined;
        if (parts.length > 5 || (parts.length === 4)) return undefined;
        const svcName = parts[0];
        const ns = parts[1] ?? "default";
        return state.Services.find(
            s => s.metadata.name === svcName &&
                (parts.length === 1 ? true : s.metadata.namespace === ns),
        );
    };

    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(target);

    // Resolve the target to a clusterIP (or keep as-is for pod IPs)
    let resolvedIP = target;
    const lookedUpSvc = isIP
        ? state.Services.find(s => s.spec.clusterIP === target)
        : resolveToSvc(target);

    if (!isIP && lookedUpSvc) {
        resolvedIP = lookedUpSvc.spec.clusterIP;
    }

    const pod = state.Pods.find(p => p.status.podIP === resolvedIP);
    if (!pod) {
        if (lookedUpSvc) {
            // Service DNS / clusterIP path
            const ep = state.Endpoints.find(
                e => e.metadata.name === lookedUpSvc!.metadata.name &&
                        e.metadata.namespace === lookedUpSvc!.metadata.namespace,
            );
            const addresses = ep?.subsets.flatMap(s => s.addresses) ?? [];
            if (addresses.length === 0) {
                return `ping: connect to host ${target}: Connection refused`;
            }
            const ms = () => (0.03 + Math.random() * 0.04).toFixed(3);
            return (
                `PING ${target} (${resolvedIP}): 56 data bytes\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
                `64 bytes from ${resolvedIP}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
                `\n--- ${target} ping statistics ---\n` +
                `3 packets transmitted, 3 packets received, 0.0% packet loss`
            );
        }
        return `ping: cannot resolve ${target}: Name or service not known`;
    }
    if (pod.status.phase !== "Running") {
        return `ping: connect to host ${target}: Connection refused`;
    }
    const ms = () => (0.03 + Math.random() * 0.04).toFixed(3);
    return (
        `PING ${target} (${resolvedIP}): 56 data bytes\n` +
        `64 bytes from ${resolvedIP}: icmp_seq=0 ttl=64 time=${ms()} ms\n` +
        `64 bytes from ${resolvedIP}: icmp_seq=1 ttl=64 time=${ms()} ms\n` +
        `64 bytes from ${resolvedIP}: icmp_seq=2 ttl=64 time=${ms()} ms\n` +
        `\n--- ${target} ping statistics ---\n` +
        `3 packets transmitted, 3 packets received, 0.0% packet loss`
    );
}