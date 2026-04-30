import type { AppState } from "../store/store";
import { lookupClusterDNS } from "./helpers/dns";

// Simulated in-cluster DNS resolver (CoreDNS at 10.96.0.10).
const DNS_SERVER = "10.96.0.10";

// ---------------------------------------------------------------------------
// Format output like real nslookup
// ---------------------------------------------------------------------------
export function nslookup(args: string[], state: AppState): string {
    const positional = args.filter(a => !a.startsWith("-"));
    const host = positional[0];

    // Parse query type
    let queryType: "A" | "SRV" = "A";
    const typeArg = args.find(a => a.startsWith("-type=") || a.startsWith("-querytype="));
    if (typeArg) {
        const type = typeArg.split("=")[1]?.toUpperCase();
        if (type === "SRV") {
            queryType = "SRV";
        }
    }

    if (!host) {
        return [
            "Usage: nslookup [-type=<type>] <hostname>",
            "  Resolves a hostname using in-cluster DNS (CoreDNS).",
            "  Supports service names, FQDN service names, and pod-specific headless DNS.",
            "",
            "Options:",
            "  -type=A     Query for A records (default)",
            "  -type=SRV   Query for SRV records",
            "",
            "Examples:",
            "  nslookup web.default.svc.cluster.local",
            "  nslookup -type=srv _http._tcp.web.default.svc.cluster.local",
        ].join("\n");
    }

    const lines: string[] = [
        `Server:\t\t${DNS_SERVER}`,
        `Address:\t${DNS_SERVER}#53`,
        "",
    ];

    const records = lookupClusterDNS(host, state, queryType);

    if (records.length === 0) {
        lines.push(`** server can't find ${host}: NXDOMAIN`);
        return lines.join("\n");
    }

    for (const rec of records) {
        if (rec.type === "A") {
            lines.push(`Name:\t${rec.name}`);
            if (rec.addresses.length === 0) {
                lines.push("Address:\t(no endpoints)");
            } else {
                for (const addr of rec.addresses) {
                    lines.push(`Address:\t${addr}`);
                }
            }
        } else if (rec.type === "SRV") {
            lines.push(`${rec.name}\tservice =`);
            if (rec.records.length === 0) {
                lines.push("\t(no SRV records)");
            } else {
                for (const srv of rec.records) {
                    lines.push(`\t${srv.priority} ${srv.weight} ${srv.port} ${srv.target}`);
                }
            }
        }
    }

    return lines.join("\n");
}
