import type { AppState } from "../store/store";

// ---------------------------------------------------------------------------
// Images that are considered to be serving HTTP traffic, with their
// well-known default listen ports (used when the container declares no ports).
// ---------------------------------------------------------------------------
const HTTP_SERVER_IMAGES: Array<{ match: string; defaultPorts: number[] }> = [
    { match: "nginx",                              defaultPorts: [80, 443] },
    { match: "httpd",                              defaultPorts: [80, 443] },
    { match: "apache",                             defaultPorts: [80, 443] },
    { match: "caddy",                              defaultPorts: [80, 443, 2015] },
    { match: "traefik",                            defaultPorts: [80, 443, 8080] },
    { match: "python",                             defaultPorts: [8000] },
    { match: "node",                               defaultPorts: [3000, 8080] },
    { match: "ruby",                               defaultPorts: [3000] },
    { match: "php",                                defaultPorts: [80, 443] },
    { match: "golang",                             defaultPorts: [8080, 8000] },
    { match: "hashicorp/http-echo",                defaultPorts: [5678] },
    { match: "mendhak/http-https-echo",            defaultPorts: [8080, 8443] },
    { match: "kennethreitz/httpbin",               defaultPorts: [80] },
    { match: "kong",                               defaultPorts: [8000, 8443] },
    { match: "envoyproxy/envoy",                   defaultPorts: [10000, 9901] },
    { match: "istio/proxyv2",                      defaultPorts: [15001, 15006, 15021] },
    { match: "gcr.io/google-containers/echoserver", defaultPorts: [8080] },
    { match: "ealen/echo-server",                  defaultPorts: [80] },
    { match: "inanimate/echo-server",              defaultPorts: [8080] },
];

function imageEntry(image: string) {
    const base = image.split(":")[0].toLowerCase();
    return HTTP_SERVER_IMAGES.find(
        h => base === h.match || base.startsWith(h.match + "/") || base.endsWith("/" + h.match),
    );
}

function isHttpServer(image: string): boolean {
    return imageEntry(image) !== undefined;
}

function defaultPortsForImage(image: string): number[] {
    return imageEntry(image)?.defaultPorts ?? [];
}

// ---------------------------------------------------------------------------
// Parse --include/-I/-v flags from the arg list
// ---------------------------------------------------------------------------
interface CurlFlags {
    include: boolean; // -i / --include: show response headers
    head: boolean;    // -I / --head: HEAD request only
    verbose: boolean; // -v
    url: string;
    port: number;     // always resolved: from URL, --port flag, or scheme default (80/443)
    path: string;
}

function parseArgs(rawArgs: string[]): CurlFlags {
    let include = false;
    let head = false;
    let verbose = false;
    let urlArg = "";
    let portOverride: number | null = null;

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
        if (!urlArg) urlArg = a;
    }

    // Detect scheme and strip protocol prefix
    const scheme = urlArg.match(/^(https?):\/\//)?.[1] ?? "http";
    const schemeDefaultPort = scheme === "https" ? 443 : 80;
    let rest = urlArg.replace(/^https?:\/\//, "");

    // Extract path
    const slashIdx = rest.indexOf("/");
    let path = "/";
    if (slashIdx !== -1) {
        path = rest.slice(slashIdx);
        rest = rest.slice(0, slashIdx);
    }

    // Extract port from host:port
    const colonIdx = rest.lastIndexOf(":");
    let host = rest;
    if (colonIdx !== -1 && !rest.includes("]")) {
        const maybePort = parseInt(rest.slice(colonIdx + 1), 10);
        if (!isNaN(maybePort)) {
            portOverride = portOverride ?? maybePort;
            host = rest.slice(0, colonIdx);
        }
    }

    return { include, head, verbose, url: host, port: portOverride ?? schemeDefaultPort, path };
}

// ---------------------------------------------------------------------------
// Resolve host string → list of candidate {pod, port} targets
// ---------------------------------------------------------------------------
interface Target {
    podName: string;
    podNamespace: string;
    image: string;
    phase: string;
    port: number;
    resolvedIP: string;
    viaService?: string;
}

// ---------------------------------------------------------------------------
// Resolve result — distinguishes "host unknown" from "port refused"
// ---------------------------------------------------------------------------
type ResolveResult =
    | { ok: true; target: Target }
    | { ok: false; reason: "not_found" | "port_refused"; port: number }

function resolve(host: string, portHint: number, state: AppState): ResolveResult {
    const { Pods, Services } = state;

    // --- 1. Direct pod IP ---
    const podByIP = Pods.find(p => p.status.podIP === host);
    if (podByIP) {
        const containerPorts = podByIP.spec.containers.flatMap(c => c.ports?.map(p => p.containerPort) ?? []);
        const image = podByIP.spec.containers[0]?.image ?? "";
        // Port must match declared container ports; if none declared, fall back to image well-known ports.
        const allowedPorts = containerPorts.length > 0 ? containerPorts : defaultPortsForImage(image);
        if (allowedPorts.length > 0 && !allowedPorts.includes(portHint)) {
            return { ok: false, reason: "port_refused", port: portHint };
        }
        return {
            ok: true,
            target: {
                podName: podByIP.metadata.name,
                podNamespace: podByIP.metadata.namespace,
                image,
                phase: podByIP.status.phase,
                port: portHint,
                resolvedIP: host,
            },
        };
    }

    // --- 2. Service ClusterIP ---
    const svcByIP = Services.find(s => s.spec.clusterIP === host);
    if (svcByIP) {
        return resolveViaService(svcByIP.metadata.name, svcByIP.metadata.namespace, portHint, state);
    }

    // --- 3. DNS: <svc>, <svc>.<ns>, <svc>.<ns>.svc.cluster.local ---
    // Also support <svc>.<ns>.svc, <svc>.<ns>.svc.cluster
    const dnsPatterns = [
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster\.local$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc\.cluster$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)\.svc$/,
        /^(?<svc>[^.]+)\.(?<ns>[^.]+)$/,
    ];
    for (const pattern of dnsPatterns) {
        const m = host.match(pattern);
        if (m?.groups) {
            const r = resolveViaService(m.groups.svc, m.groups.ns, portHint, state);
            // A port_refused result is definitive — the service was found but rejected the port
            if (r.ok || r.reason === "port_refused") return r;
        }
    }
    // Short DNS: just <svc> — try the default namespace
    const svcByName = Services.find(s => s.metadata.name === host && s.metadata.namespace === "default");
    if (svcByName) {
        return resolveViaService(svcByName.metadata.name, svcByName.metadata.namespace, portHint, state);
    }

    return { ok: false, reason: "not_found", port: portHint };
}

function resolveViaService(svcName: string, svcNs: string, portHint: number, state: AppState): ResolveResult {
    const svc = state.Services.find(s => s.metadata.name === svcName && s.metadata.namespace === svcNs);
    if (!svc) return { ok: false, reason: "not_found", port: portHint };

    // Port must match a declared service port — no fallback to first port.
    const svcPort = svc.spec.ports.find(p => p.port === portHint);
    if (!svcPort) {
        return { ok: false, reason: "port_refused", port: portHint };
    }

    const ep = state.Endpoints.find(e => e.metadata.name === svcName && e.metadata.namespace === svcNs);
    const allAddresses = ep?.subsets.flatMap(s => s.addresses) ?? [];
    if (allAddresses.length === 0) return { ok: false, reason: "not_found", port: svcPort.port };
    // Simulate load-balancing: pick a random endpoint address each time.
    const epAddress = allAddresses[Math.floor(Math.random() * allAddresses.length)];

    const podRef = epAddress.targetRef;
    const pod = podRef
        ? state.Pods.find(p => p.metadata.name === podRef.name && p.metadata.namespace === podRef.namespace)
        : state.Pods.find(p => p.status.podIP === epAddress.ip);

    if (!pod) return { ok: false, reason: "not_found", port: svcPort.port };

    // Validate that targetPort is reachable on the pod (same check as the direct pod-IP path).
    const podImage = pod.spec.containers[0]?.image ?? "";
    const podContainerPorts = pod.spec.containers.flatMap(c => c.ports?.map(p => p.containerPort) ?? []);
    const podAllowedPorts = podContainerPorts.length > 0 ? podContainerPorts : defaultPortsForImage(podImage);
    if (podAllowedPorts.length > 0 && !podAllowedPorts.includes(svcPort.targetPort)) {
        return { ok: false, reason: "port_refused", port: portHint };
    }

    return {
        ok: true,
        target: {
            podName: pod.metadata.name,
            podNamespace: pod.metadata.namespace,
            image: pod.spec.containers[0]?.image ?? "",
            phase: pod.status.phase,
            port: svcPort.targetPort,
            resolvedIP: epAddress.ip,
            viaService: svcName,
        },
    };
}

// ---------------------------------------------------------------------------
// Build the simulated HTTP response output
// ---------------------------------------------------------------------------
function buildResponse(target: Target, flags: CurlFlags): string {
    const date = new Date().toUTCString();
    const server = (() => {
        const base = target.image.split(":")[0].split("/").pop() ?? "server";
        if (base.startsWith("nginx")) return "nginx";
        if (base.startsWith("httpd") || base.startsWith("apache")) return "Apache/2.4";
        if (base.startsWith("caddy")) return "Caddy";
        if (base.startsWith("python")) return "SimpleHTTP/0.6 Python/3.11";
        return base;
    })();

    const statusLine = "HTTP/1.1 200 OK";
    const headers = [
        `Date: ${date}`,
        `Server: ${server}`,
        `Content-Type: text/html`,
        `Connection: keep-alive`,
    ];

    const body = [
        `<!DOCTYPE html>`,
        `<html><head><title>Welcome</title></head>`,
        `<body>`,
        `<h1>Hello from ${target.podName}</h1>`,
        `<p>Pod IP: ${target.resolvedIP} | Port: ${target.port} | Path: ${flags.path}</p>`,
        `</body></html>`,
    ].join("\n");

    const lines: string[] = [];

    if (flags.verbose) {
        // flags.port is what the client dialed (service port); target.port is the pod's receive port (targetPort).
        lines.push(`* Trying ${target.resolvedIP}:${flags.port}...`);
        lines.push(`* Connected to ${flags.url} (${target.resolvedIP}) port ${flags.port}`);
        if (flags.head) {
            lines.push(`> HEAD ${flags.path} HTTP/1.1`);
        } else {
            lines.push(`> GET ${flags.path} HTTP/1.1`);
        }
        lines.push(`> Host: ${flags.url}`);
        lines.push(`> Accept: */*`);
        lines.push(`>`);
        lines.push(`< ${statusLine}`);
        headers.forEach(h => lines.push(`< ${h}`));
        lines.push(`<`);
    }

    if (flags.include) {
        lines.push(statusLine);
        lines.push(...headers);
        lines.push("");
    }

    if (!flags.head) {
        lines.push(body);
    }

    if (flags.verbose) {
        lines.push(`* Connection #0 to host ${flags.url} left intact`);
    }

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function curl(rawArgs: string[], state: AppState): string {
    const flags = parseArgs(rawArgs);

    if (!flags.url) {
        return [
            `curl: try 'curl --help' for more information`,
            `Usage: curl [options] <url>`,
            `  Supports pod IPs, service ClusterIPs, and in-cluster DNS names.`,
            `  Only pods running an HTTP server image receive requests.`,
        ].join("\n");
    }

    const result = resolve(flags.url, flags.port, state);

    if (!result.ok) {
        if (result.reason === "port_refused") {
            return `curl: (7) Failed to connect to ${flags.url} port ${result.port} after 0 ms: Connection refused`;
        }
        return `curl: (6) Could not resolve host: ${flags.url}`;
    }

    const { target } = result;

    if (target.phase !== "Running") {
        return `curl: (7) Failed to connect to ${flags.url} port ${target.port} after 0 ms: Connection refused\n(Pod ${target.podName} is ${target.phase})`;
    }

    if (!isHttpServer(target.image)) {
        return `curl: (7) Failed to connect to ${flags.url} port ${target.port} after 0 ms: Connection refused\n(Pod ${target.podName} image "${target.image}" is not an HTTP server)`;
    }

    return buildResponse(target, flags);
}
