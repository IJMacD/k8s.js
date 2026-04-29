import type { AppState } from "../store/store";
import { clusterFetch } from "./helpers/clusterFetch";

// ---------------------------------------------------------------------------
// Parse --include/-I/-v flags from the arg list
// ---------------------------------------------------------------------------
interface CurlFlags {
    include: boolean; // -i / --include: show response headers
    head: boolean;    // -I / --head: HEAD request only
    verbose: boolean; // -v
    rawUrl: string;
}

function parseArgs(rawArgs: string[]): CurlFlags {
    let include = false;
    let head = false;
    let verbose = false;
    let rawUrl = "";

    for (let i = 0; i < rawArgs.length; i++) {
        const a = rawArgs[i];
        if (a === "-i" || a === "--include") { include = true; continue; }
        if (a === "-I" || a === "--head") { head = true; include = true; continue; }
        if (a === "-v" || a === "--verbose") { verbose = true; include = true; continue; }
        // skip curl flags that take a value we don't use
        if (a === "-H" || a === "--header" || a === "-d" || a === "--data" ||
            a === "-X" || a === "--request" || a === "-o" || a === "--output" ||
            a === "-u" || a === "--user") {
            i++;
            continue;
        }
        if (a.startsWith("-")) continue; // unknown flag
        if (!rawUrl) rawUrl = a;
    }

    return { include, head, verbose, rawUrl };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function curl(rawArgs: string[], state: AppState): string {
    const flags = parseArgs(rawArgs);

    if (!flags.rawUrl) {
        return [
            `curl: try 'curl --help' for more information`,
            `Usage: curl [options] <url>`,
            `  Supports pod IPs, service ClusterIPs, and in-cluster DNS names.`,
            `  Only pods running an HTTP server image receive requests.`,
        ].join("\n");
    }

    const fetched = clusterFetch(flags.rawUrl, state);

    if (!fetched.ok) {
        const { kind, host, port, podName, podPhase, podImage } = fetched;
        if (kind === "not_found") return `curl: (6) Could not resolve host: ${host}`;
        const connRefused = `curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Connection refused`;
        if (kind === "port_refused") return connRefused;
        if (kind === "pod_not_ready") return `${connRefused}\n(Pod ${podName} is ${podPhase})`;
        return `${connRefused}\n(Pod ${podName} image "${podImage}" is not an HTTP server)`;
    }

    const { host, dialPort, path } = fetched;
    const statusLine = `HTTP/1.1 ${fetched.status} ${fetched.statusText}`;
    const hdrs = Object.entries(fetched.headers).map(([k, v]) => `${k}: ${v}`);
    const lines: string[] = [];

    if (flags.verbose) {
        lines.push(`* Trying ${fetched.dialIP}:${dialPort}...`);
        lines.push(`* Connected to ${host} (${fetched.dialIP}) port ${dialPort}`);
        lines.push(`> ${flags.head ? "HEAD" : "GET"} ${path} HTTP/1.1`);
        lines.push(`> Host: ${host}`);
        lines.push(`> Accept: */*`);
        lines.push(`>`);
        lines.push(`< ${statusLine}`);
        hdrs.forEach(h => lines.push(`< ${h}`));
        lines.push(`<`);
    }
    if (flags.include) {
        lines.push(statusLine);
        lines.push(...hdrs);
        lines.push("");
    }
    if (!flags.head) {
        lines.push(fetched.body);
    }
    if (flags.verbose) {
        lines.push(`* Connection #0 to host ${host} left intact`);
    }

    return lines.join("\n");
}
