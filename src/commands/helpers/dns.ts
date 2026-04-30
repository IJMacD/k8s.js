/**
 * Shared in-cluster DNS resolution logic (simulates CoreDNS).
 * Used by nslookup, ping, and curl.
 */
import type { AppState } from "../../store/store";

export interface DnsARecord {
    name: string;        // FQDN that was resolved
    addresses: string[]; // A record values
    type: "A";
}

export interface DnsSRVRecord {
    name: string;        // FQDN that was resolved
    type: "SRV";
    records: Array<{
        priority: number;
        weight: number;
        port: number;
        target: string;
    }>;
}

export type DnsRecord = DnsARecord | DnsSRVRecord;

export function lookupClusterDNS(host: string, state: AppState, recordType: "A" | "SRV" = "A"): DnsRecord[] {
    if (recordType === "SRV") {
        return lookupSRV(host, state);
    }
    return lookupA(host, state);
}

function lookupA(host: string, state: AppState): DnsARecord[] {
    const { Services, Pods, Endpoints, Nodes } = state;

    const normalise = (h: string) => h.replace(/\.$/, ""); // strip trailing dot
    const fqdn = (svc: string, ns: string) => `${svc}.${ns}.svc.cluster.local`;
    host = normalise(host);

    // --- 1. Direct pod IP ---
    const podByIP = Pods.find(p => p.status.podIP === host);
    if (podByIP) {
        return [{ name: host, addresses: [host], type: "A" }];
    }

    // --- 2. Pod-specific headless DNS: <pod>.<svc>[.<ns>[.svc[.cluster[.local]]]] ---
    const podDnsPatterns = [
        /^(?<pod>[^.]+)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster\.local$/,
        /^(?<pod>[^.]+)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster$/,
        /^(?<pod>[^.]+)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc$/,
        /^(?<pod>[^.]+)\.(?<svc>[^.]+)\.(?<ns>[^.]+)$/,
        /^(?<pod>[^.]+)\.(?<svc>[^.]+)$/,
    ];
    for (const pattern of podDnsPatterns) {
        const m = host.match(pattern);
        if (m?.groups) {
            const { pod, svc, ns = "default" } = m.groups;
            const headlessSvc = Services.find(
                s => s.metadata.name === svc && s.metadata.namespace === ns && s.spec.clusterIP === "None",
            );
            if (!headlessSvc) continue;
            const targetPod = Pods.find(p => p.metadata.name === pod && p.metadata.namespace === ns);
            if (targetPod?.status.podIP) {
                return [{ name: `${pod}.${fqdn(svc, ns)}`, addresses: [targetPod.status.podIP], type: "A" }];
            }
        }
    }

    // --- 3. Service DNS patterns ---
    const svcDnsPatterns = [
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster\.local$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)$/,
    ];

    const resolveSvc = (svcName: string, ns: string): DnsARecord[] | null => {
        const svc = Services.find(s => s.metadata.name === svcName && s.metadata.namespace === ns);
        if (!svc) return null;
        const qualifiedName = fqdn(svcName, ns);
        if (svc.spec.clusterIP === "None") {
            // Headless: return A records for each ready endpoint pod IP
            const ep = Endpoints.find(e => e.metadata.name === svcName && e.metadata.namespace === ns);
            const ips = ep?.subsets.flatMap(s => s.addresses.map(a => a.ip)).filter(Boolean) ?? [];
            return [{ name: qualifiedName, addresses: ips, type: "A" }];
        }
        return [{ name: qualifiedName, addresses: [svc.spec.clusterIP], type: "A" }];
    };

    for (const pattern of svcDnsPatterns) {
        const m = host.match(pattern);
        if (m?.groups) {
            const r = resolveSvc(m.groups.svc, m.groups.ns);
            if (r) return r;
        }
    }

    // Short name — try default namespace
    const shortSvc = Services.find(s => s.metadata.name === host && s.metadata.namespace === "default");
    if (shortSvc) {
        const r = resolveSvc(shortSvc.metadata.name, "default");
        if (r) return r;
    }

    // --- 4. Node hostname or InternalIP ---
    const node = Nodes.find(
        n => n.metadata.name === host || n.status.addresses.some(a => a.address === host),
    );
    if (node) {
        const ip = node.status.addresses.find(a => a.type === "InternalIP")?.address ?? host;
        return [{ name: host, addresses: [ip], type: "A" }];
    }

    return [];
}

function lookupSRV(host: string, state: AppState): DnsSRVRecord[] {
    const { Services } = state;
    
    const normalise = (h: string) => h.replace(/\.$/, ""); // strip trailing dot
    host = normalise(host);

    // SRV records follow the pattern: _service._proto.name
    // In Kubernetes, these are typically: _<port-name>._<protocol>.<service>.<namespace>.svc.cluster.local
    const srvPatterns = [
        /^_(?<portName>[^.]+)\._(?<proto>tcp|udp)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster\.local$/,
        /^_(?<portName>[^.]+)\._(?<proto>tcp|udp)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster$/,
        /^_(?<portName>[^.]+)\._(?<proto>tcp|udp)\.(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc$/,
        /^_(?<portName>[^.]+)\._(?<proto>tcp|udp)\.(?<svc>[^.]+)\.(?<ns>[^.]+)$/,
        /^_(?<portName>[^.]+)\._(?<proto>tcp|udp)\.(?<svc>[^.]+)$/,
    ];

    for (const pattern of srvPatterns) {
        const m = host.match(pattern);
        if (m?.groups) {
            const { portName, proto, svc: svcName, ns = "default" } = m.groups;
            const svc = Services.find(s => s.metadata.name === svcName && s.metadata.namespace === ns);
            
            if (!svc) continue;

            // Find the matching port
            const port = svc.spec.ports.find(p => 
                (p.name === portName || p.port.toString() === portName) && 
                p.protocol.toLowerCase() === proto.toLowerCase()
            );

            if (!port) continue;

            const fqdn = `${svcName}.${ns}.svc.cluster.local`;
            const srvFqdn = `_${portName}._${proto}.${fqdn}`;

            // For headless services, create SRV records for each endpoint
            if (svc.spec.clusterIP === "None") {
                const ep = state.Endpoints.find(e => e.metadata.name === svcName && e.metadata.namespace === ns);
                const records: DnsSRVRecord["records"] = [];
                
                if (ep) {
                    ep.subsets.forEach((subset, idx) => {
                        subset.addresses.forEach((addr) => {
                            // For headless services, SRV points to pod-specific DNS names
                            const podName = addr.targetRef?.name || `pod-${idx}`;
                            const target = `${podName}.${fqdn}`;
                            records.push({
                                priority: 0,
                                weight: 100,
                                port: port.port,
                                target: target,
                            });
                        });
                    });
                }

                return [{ name: srvFqdn, type: "SRV", records }];
            } else {
                // For regular services, point to the service FQDN
                return [{
                    name: srvFqdn,
                    type: "SRV",
                    records: [{
                        priority: 0,
                        weight: 100,
                        port: port.port,
                        target: fqdn,
                    }],
                }];
            }
        }
    }

    return [];
}
