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

    if (!host) {
        return [
            "Usage: nslookup <hostname>",
            "  Resolves a hostname using in-cluster DNS (CoreDNS).",
            "  Supports service names, FQDN service names, and pod-specific headless DNS.",
        ].join("\n");
    }

    const lines: string[] = [
        `Server:\t\t${DNS_SERVER}`,
        `Address:\t${DNS_SERVER}#53`,
        "",
    ];

    const records = lookupClusterDNS(host, state);

    if (records.length === 0) {
        lines.push(`** server can't find ${host}: NXDOMAIN`);
        return lines.join("\n");
    }

    for (const rec of records) {
        lines.push(`Name:\t${rec.name}`);
        if (rec.addresses.length === 0) {
            lines.push("Address:\t(no endpoints)");
        } else {
            for (const addr of rec.addresses) {
                lines.push(`Address:\t${addr}`);
            }
        }
    }

    return lines.join("\n");
}
