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

function parseUrl(rawUrl: string): { host: string; port: number; path: string } {
    const scheme = rawUrl.match(/^(https?):\/\//)?.[1] ?? "http";
    const schemeDefaultPort = scheme === "https" ? 443 : 80;
    let rest = rawUrl.replace(/^https?:\/\//, "");

    const slashIdx = rest.indexOf("/");
    let path = "/";
    if (slashIdx !== -1) {
        path = rest.slice(slashIdx);
        rest = rest.slice(0, slashIdx);
    }

    const colonIdx = rest.lastIndexOf(":");
    let host = rest;
    let port = schemeDefaultPort;
    if (colonIdx !== -1 && !rest.includes("]")) {
        const maybePort = parseInt(rest.slice(colonIdx + 1), 10);
        if (!isNaN(maybePort)) {
            port = maybePort;
            host = rest.slice(0, colonIdx);
        }
    }

    return { host, port, path };
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
    dialIP: string;     // IP the client connects to (ClusterIP for services, pod IP for direct)
    resolvedIP: string; // pod endpoint IP
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
                dialIP: host,
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

    // --- 4. LoadBalancer ingress IP or hostname ---
    for (const svc of Services) {
        if (svc.spec.type !== "LoadBalancer") continue;
        const ingress = svc.status.loadBalancer?.ingress ?? [];
        const matched = ingress.some(i => i.ip === host || i.hostname === host);
        if (matched) {
            return resolveViaService(svc.metadata.name, svc.metadata.namespace, portHint, state);
        }
    }

    // --- 5. NodePort: <node-ip>:<nodePort> or <node-name>:<nodePort> ---
    const isNode = state.Nodes.some(
        n => n.metadata.name === host || n.status.addresses.some(a => a.address === host),
    );
    if (isNode) {
        for (const svc of state.Services) {
            if (svc.spec.type !== "NodePort" && svc.spec.type !== "LoadBalancer") continue;
            const svcPort = svc.spec.ports.find(p => p.nodePort === portHint);
            if (svcPort) {
                return resolveViaService(svc.metadata.name, svc.metadata.namespace, svcPort.port, state);
            }
        }
        // Node exists but no service is exposed on this nodePort
        return { ok: false, reason: "port_refused", port: portHint };
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
    // Named targetPort (string) is resolved to a concrete port number via the pod's container ports.
    const podImage = pod.spec.containers[0]?.image ?? "";
    const podContainerPorts = pod.spec.containers.flatMap(c => c.ports?.map(p => p.containerPort) ?? []);
    const podAllowedPorts = podContainerPorts.length > 0 ? podContainerPorts : defaultPortsForImage(podImage);

    const resolvedTargetPort: number =
        typeof svcPort.targetPort === "number"
            ? svcPort.targetPort
            : pod.spec.containers.flatMap(c => c.ports ?? []).find(p => p.name === svcPort.targetPort)?.containerPort ?? 0;

    if (podAllowedPorts.length > 0 && !podAllowedPorts.includes(resolvedTargetPort)) {
        return { ok: false, reason: "port_refused", port: portHint };
    }

    return {
            ok: true,
            target: {
                podName: pod.metadata.name,
                podNamespace: pod.metadata.namespace,
                image: pod.spec.containers[0]?.image ?? "",
                phase: pod.status.phase,
                port: resolvedTargetPort,
                dialIP: svc.spec.clusterIP,
                resolvedIP: epAddress.ip,
                viaService: svcName,
            },
        };
}

// ---------------------------------------------------------------------------
// Simulated fetch — used by the Browser pane (returns structured data)
// ---------------------------------------------------------------------------
export interface SimResponse {
    ok: true;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    host: string;
    dialPort: number;
    path: string;
    dialIP: string;     // IP the client connects to
    resolvedIP: string; // pod endpoint IP
    podName: string;
    viaService?: string;
}
export interface SimError {
    ok: false;
    kind: 'not_found' | 'port_refused' | 'pod_not_ready' | 'not_http';
    error: string;
    host: string;
    port: number;
    podName?: string;
    podPhase?: string;
    podImage?: string;
}

export function clusterFetch(rawUrl: string, state: AppState): SimResponse | SimError {
    const { host, port, path } = parseUrl(rawUrl);

    if (!host) return { ok: false, kind: 'not_found', host: '', port: 0, error: "No URL provided" };

    // Escape HTML special characters in any value that comes from user input
    // before interpolating into the HTML body (which is rendered via dangerouslySetInnerHTML).
    const esc = (s: string) =>
        s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const result = resolve(host, port, state);

    if (!result.ok) {
        if (result.reason === "port_refused") {
            return { ok: false, kind: 'port_refused', host, port: result.port, error: `Failed to connect to ${host} port ${result.port}: Connection refused` };
        }
        return { ok: false, kind: 'not_found', host, port, error: `Could not resolve host: ${host}` };
    }

    const { target } = result;

    if (target.phase !== "Running") {
        return { ok: false, kind: 'pod_not_ready', host, port: target.port, podName: target.podName, podPhase: target.phase, error: `Connection refused (Pod ${target.podName} is ${target.phase})` };
    }
    if (!isHttpServer(target.image)) {
        return { ok: false, kind: 'not_http', host, port: target.port, podName: target.podName, podImage: target.image, error: `Connection refused (Pod ${target.podName} image "${target.image}" is not an HTTP server)` };
    }

    const date = new Date().toUTCString();
    const server = (() => {
        const base = target.image.split(":")[0].split("/").pop() ?? "server";
        if (base.startsWith("nginx")) return "nginx";
        if (base.startsWith("httpd") || base.startsWith("apache")) return "Apache/2.4";
        if (base.startsWith("caddy")) return "Caddy";
        if (base.startsWith("python")) return "SimpleHTTP/0.6 Python/3.11";
        return base;
    })();

    const body = [
        `<!DOCTYPE html>`,
        `<html><head><title>Welcome to ${esc(host)}</title></head>`,
        `<body>`,
        `<h1>Hello from ${esc(target.podName)}</h1>`,
        `<p>Pod IP: ${esc(target.resolvedIP)} | Port: ${target.port} | Path: ${esc(path)}</p>`,
        `</body></html>`,
    ].join("\n");

    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
            "Date": date,
            "Server": server,
            "Content-Type": "text/html",
            "Connection": "keep-alive",
        },
        body,
        host,
        dialPort: port,
        path,
        dialIP: target.dialIP,
        resolvedIP: target.resolvedIP,
        podName: target.podName,
        viaService: target.viaService,
    };
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
