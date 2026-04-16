import type { AppState } from "../store/store";
import type { Container, Pod } from "../types/v1/Pod";

// ---------------------------------------------------------------------------
// Fake log generator
// ---------------------------------------------------------------------------

function simpleHash(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return h >>> 0;
}

const HTTP_PATHS  = ["/", "/healthz", "/readyz", "/metrics", "/api/v1/status", "/api/v1/items"];
const HTTP_IPS    = ["10.244.0.5", "10.244.1.3", "10.244.2.7", "10.244.0.9"];
const HTTP_CODES  = [200, 200, 200, 200, 200, 304, 404, 499];
const HTTP_AGENTS = [
    '"kube-probe/1.28"',
    '"prometheus/2.45"',
    '"Go-http-client/1.1"',
    '"curl/7.88"',
];

const APP_LEVELS  = ["INFO", "INFO", "INFO", "DEBUG", "WARN"];
const APP_MSGS    = [
    "handling request",
    "processed event",
    "reconcile loop tick",
    "health check passed",
    "cache hit",
    "cache miss – fetching from upstream",
    "worker idle",
    "metrics collected",
    "connection pool resized",
    "config refreshed",
];

const DB_LINES = [
    "database system is ready to accept connections",
    "autovacuum launcher started",
    "checkpoint complete: wrote {n} buffers (0.1%); 0 WAL file(s) added",
    "connection received: host=10.244.0.5 port={p}",
    "statement: SELECT 1",
    "statement: BEGIN",
    "statement: COMMIT",
    "slow query ({ms} ms): SELECT * FROM sessions WHERE expires_at < NOW()",
];

const REDIS_LINES = [
    "* Ready to accept connections",
    "* DB loaded from disk: 0.000 seconds",
    "# Server started, Redis version 7.0.11",
    "* 1 changes in 3600 seconds. Saving...",
    "* Background saving started",
    "* DB saved on disk",
    "* Connecting to MASTER 10.244.1.2:6379",
    "* MASTER <-> REPLICA sync started",
    "* Full resync from master: {offset}",
    "* MASTER <-> REPLICA sync: Finished with success",
];

function httpDateStr(ts: string): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${pad(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function generateLogLine(image: string, idx: number, ts: string): string {
    const imageName = image.split(":")[0].split("/").pop() ?? "app";
    const h = simpleHash(imageName + String(idx));

    // HTTP access-log style
    if (/nginx|apache|caddy|haproxy|envoy|traefik/.test(imageName)) {
        const ip    = HTTP_IPS[h % HTTP_IPS.length];
        const path  = HTTP_PATHS[(h >>> 3) % HTTP_PATHS.length];
        const code  = HTTP_CODES[(h >>> 6) % HTTP_CODES.length];
        const size  = ((h >>> 9) % 4096) + 64;
        const agent = HTTP_AGENTS[(h >>> 12) % HTTP_AGENTS.length];
        return `${ip} - - [${httpDateStr(ts)}] "GET ${path} HTTP/1.1" ${code} ${size} "-" ${agent} "-"`;
    }

    // Redis-style
    if (/redis/.test(imageName)) {
        const line = REDIS_LINES[h % REDIS_LINES.length]
            .replace("{offset}", String((h >>> 4) % 100000))
        return `${(h % 9999).toString().padStart(5)} ${ts.slice(0, 19).replace("T", " ")} * ${line}`;
    }

    // Postgres / MySQL / Mongo style
    if (/postgres|mysql|mariadb|mongo/.test(imageName)) {
        const line = DB_LINES[h % DB_LINES.length]
            .replace("{n}", String((h >>> 4) % 512))
            .replace("{p}", String(40000 + (h >>> 8) % 20000))
            .replace("{ms}", String(100 + (h >>> 12) % 4900));
        return `${ts.slice(0, 19).replace("T", " ")} UTC [${(h % 9999) + 1}] LOG:  ${line}`;
    }

    // Generic structured log
    const level = APP_LEVELS[h % APP_LEVELS.length];
    const msg   = APP_MSGS[(h >>> 4) % APP_MSGS.length];
    return `${ts} ${level.padEnd(5)} ${imageName} ${msg}`;
}

function generateFakeLogs(pod: Pod, container: Container, count: number): string[] {
    if (count === 0) return [];
    const startMs = pod.metadata.creationTimestamp
        ? new Date(pod.metadata.creationTimestamp).getTime()
        : Date.now() - 3_600_000;
    const endMs = Date.now();
    const span  = Math.max(endMs - startMs, 1);

    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
        const ts = new Date(startMs + Math.floor((span / count) * i)).toISOString();
        lines.push(generateLogLine(container.image, i, ts));
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function* kubectlLogs(
    args: string[],
    namespace: string,
    state: AppState,
): AsyncGenerator<string> {
    // kubectl logs <pod> [-c <container>] [--tail=N] [-f/--follow] [--previous]
    const podName = args[1];
    if (!podName || podName.startsWith("-"))
        throw Error("kubectl logs: must specify a Pod name");

    const pod = state.Pods.find(
        p => p.metadata.name === podName && p.metadata.namespace === namespace,
    );
    if (!pod) throw Error(`Error from server (NotFound): pods "${podName}" not found`);

    if (pod.status.phase === "Pending") {
        throw Error(
            `Error from server (BadRequest): container "${pod.spec.containers[0]?.name}" in pod "${podName}" is waiting to start: ContainerCreating`,
        );
    }

    // Resolve container: -c <name>  or  --container=<name>
    let containerName: string | undefined;
    const cIdx = args.findIndex(a => a === "-c" || a === "--container");
    if (cIdx >= 0) {
        containerName = args[cIdx + 1];
    } else {
        const inline = args.find(a => a.startsWith("-c=") || a.startsWith("--container="));
        if (inline) containerName = inline.slice(inline.indexOf("=") + 1);
    }

    const container = containerName
        ? pod.spec.containers.find(c => c.name === containerName)
        : pod.spec.containers[0];

    if (!container) {
        throw Error(
            containerName
                ? `Error from server (BadRequest): container "${containerName}" in pod "${podName}" is not valid`
                : `Error from server (BadRequest): pod "${podName}" has no containers`,
        );
    }

    // Parse options
    const tailFlag  = args.find(a => a.startsWith("--tail="));
    const tailN     = tailFlag ? parseInt(tailFlag.slice("--tail=".length), 10) : 20;
    const follow    = args.includes("-f") || args.includes("--follow");

    const lines = generateFakeLogs(pod, container, Math.max(0, tailN));
    for (const line of lines) {
        yield line;
    }

    if (follow) {
        const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
        let idx = lines.length;
        while (true) {
            await sleep(1500 + (simpleHash(podName + idx) % 3000));
            yield generateLogLine(container.image, idx++, new Date().toISOString());
        }
    }
}
