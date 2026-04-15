import type { ActionDispatch } from "react";
import type { Container, EnvRecord } from "../types/v1/Pod";
import {
    patchResource,
    setDeploymentImage,
    type Action,
    type AppState,
} from "../store/store";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type WorkloadKind = "deployment" | "daemonset" | "statefulset" | "job" | "cronjob";

const WORKLOAD_KINDS: WorkloadKind[] = ["deployment", "daemonset", "statefulset", "job", "cronjob"];

function isWorkloadKind(k: string): k is WorkloadKind {
    return (WORKLOAD_KINDS as string[]).includes(k);
}

/** e.g. `deployment/my-app` → `{ kind: "deployment", name: "my-app" }` */
function parseResourceArg(arg: string): { kind: string; name: string } | null {
    const slash = arg.indexOf("/");
    if (slash === -1) return null;
    return { kind: arg.slice(0, slash).toLowerCase(), name: arg.slice(slash + 1) };
}

/** Canonical resource string for CLI output (e.g. `deployment.apps`, `job.batch`). */
function resourceLabel(kind: WorkloadKind): string {
    switch (kind) {
        case "deployment":  return "deployment.apps";
        case "daemonset":   return "daemonset.apps";
        case "statefulset": return "statefulset.apps";
        case "job":         return "job.batch";
        case "cronjob":     return "cronjob.batch";
    }
}

/** Read the containers array from the live state for any workload kind. */
function getContainers(
    kind: WorkloadKind,
    name: string,
    namespace: string,
    state: AppState,
): Container[] | null {
    switch (kind) {
        case "deployment": {
            const r = state.Deployments.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
            return r?.spec.template.spec.containers ?? null;
        }
        case "daemonset": {
            const r = state.DaemonSets.find(d => d.metadata.name === name && d.metadata.namespace === namespace);
            return r?.spec.template.spec.containers ?? null;
        }
        case "statefulset": {
            const r = state.StatefulSets.find(s => s.metadata.name === name && s.metadata.namespace === namespace);
            return r?.spec.template.spec.containers ?? null;
        }
        case "job": {
            const r = state.Jobs.find(j => j.metadata.name === name && j.metadata.namespace === namespace);
            return r?.spec.template.spec.containers ?? null;
        }
        case "cronjob": {
            const r = state.CronJobs.find(c => c.metadata.name === name && c.metadata.namespace === namespace);
            return r?.spec.jobTemplate.spec.template.spec.containers ?? null;
        }
    }
}

/** Build the patch object that replaces the containers array in the pod spec. */
function buildContainersPatch(kind: WorkloadKind, containers: Container[]): Record<string, unknown> {
    if (kind === "cronjob") {
        return { spec: { jobTemplate: { spec: { template: { spec: { containers } } } } } };
    }
    return { spec: { template: { spec: { containers } } } };
}

/** Parse a `-c / --containers` flag value from the arg list, returning the value and consumed index delta. */
function parseContainerFlag(args: string[], i: number): { value: string; advance: number } | null {
    const a = args[i];
    if ((a === "-c" || a === "--containers") && args[i + 1]) {
        return { value: args[i + 1], advance: 1 };
    }
    if (a.startsWith("-c=") || a.startsWith("--containers=")) {
        return { value: a.slice(a.indexOf("=") + 1), advance: 0 };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function* kubectlSet(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const sub = args[1];
    if (sub === "image") {
        yield* setImage(args, namespace, state, dispatch);
    } else if (sub === "env") {
        yield* setEnv(args, namespace, state, dispatch);
    } else if (sub === "resources") {
        yield* setResources(args, namespace, state, dispatch);
    } else {
        throw Error(`kubectl set: unsupported subcommand "${sub ?? ""}". Supported: image, env, resources`);
    }
}

// ---------------------------------------------------------------------------
// set image
// ---------------------------------------------------------------------------
// kubectl set image <type>/<name> <container>=<image> [<container>=<image>...]
//
// For deployments the dedicated setDeploymentImage action is used so that the
// deployment's generation counter is bumped and a rollout is triggered.
// All other workload types are updated via a patchResource call.
// ---------------------------------------------------------------------------

async function* setImage(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const resourceArg = args[2];
    if (!resourceArg) throw Error("kubectl set image: expected <type>/<name>");
    const res = parseResourceArg(resourceArg);
    if (!res) throw Error(`kubectl set image: expected <type>/<name>, got "${resourceArg}"`);
    const { kind, name } = res;

    const assignments = args.slice(3);
    if (assignments.length === 0) throw Error("kubectl set image: expected <container>=<image>");

    const pairs = assignments.map(a => {
        const eq = a.indexOf("=");
        if (eq === -1) throw Error(`kubectl set image: expected <container>=<image>, got "${a}"`);
        return { container: a.slice(0, eq), image: a.slice(eq + 1) };
    });

    if (kind === "deployment") {
        for (const { container, image } of pairs) {
            dispatch(setDeploymentImage(name, container, image, namespace));
        }
        yield `deployment.apps/${name} image updated`;
        return;
    }

    if (!isWorkloadKind(kind)) throw Error(`kubectl set image: unsupported resource type "${kind}"`);

    const containers = getContainers(kind, name, namespace, state);
    if (!containers) throw Error(`kubectl set image: ${kind}/${name} not found in namespace "${namespace}"`);

    let updated = containers;
    for (const { container, image } of pairs) {
        if (!updated.some(c => c.name === container))
            throw Error(`kubectl set image: container "${container}" not found in ${kind}/${name}`);
        updated = updated.map(c => c.name === container ? { ...c, image } : c);
    }

    dispatch(patchResource(kind, name, buildContainersPatch(kind, updated), namespace));
    yield `${resourceLabel(kind)}/${name} image updated`;
}

// ---------------------------------------------------------------------------
// set env
// ---------------------------------------------------------------------------
// kubectl set env <type>/<name> KEY=VALUE... [KEY-...] [-c <container>]
//
// KEY=VALUE  — add or update the environment variable
// KEY-       — remove the environment variable (trailing dash, no '=')
// -c / --containers <name>  — target a specific container (default: all)
// ---------------------------------------------------------------------------

async function* setEnv(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const resourceArg = args[2];
    if (!resourceArg) throw Error("kubectl set env: expected <type>/<name>");
    const res = parseResourceArg(resourceArg);
    if (!res) throw Error(`kubectl set env: expected <type>/<name>, got "${resourceArg}"`);
    const { kind, name } = res;

    if (!isWorkloadKind(kind)) throw Error(`kubectl set env: unsupported resource type "${kind}"`);

    let targetContainer: string | undefined;
    const upserts: EnvRecord[] = [];
    const deletes: string[] = [];

    for (let i = 3; i < args.length; i++) {
        const cFlag = parseContainerFlag(args, i);
        if (cFlag) {
            targetContainer = cFlag.value;
            i += cFlag.advance;
            continue;
        }
        const a = args[i];
        if (a.endsWith("-") && !a.includes("=")) {
            // KEY- → remove
            deletes.push(a.slice(0, -1));
        } else if (a.includes("=")) {
            const eq = a.indexOf("=");
            upserts.push({ name: a.slice(0, eq), value: a.slice(eq + 1) });
        }
    }

    if (upserts.length === 0 && deletes.length === 0)
        throw Error("kubectl set env: no environment variable changes specified (use KEY=VALUE to set, KEY- to unset)");

    const containers = getContainers(kind, name, namespace, state);
    if (!containers) throw Error(`kubectl set env: ${kind}/${name} not found in namespace "${namespace}"`);

    const updated = containers.map(c => {
        if (targetContainer && c.name !== targetContainer) return c;
        let env: EnvRecord[] = c.env ? [...c.env] : [];
        for (const { name: key, value } of upserts) {
            const idx = env.findIndex(e => e.name === key);
            if (idx >= 0) env[idx] = { name: key, value };
            else env.push({ name: key, value });
        }
        for (const key of deletes) {
            env = env.filter(e => e.name !== key);
        }
        return { ...c, env: env.length > 0 ? env : undefined };
    });

    dispatch(patchResource(kind, name, buildContainersPatch(kind, updated), namespace));
    yield `${resourceLabel(kind)}/${name} env updated`;
}

// ---------------------------------------------------------------------------
// set resources
// ---------------------------------------------------------------------------
// kubectl set resources <type>/<name> [--limits=cpu=x,memory=y]
//                                     [--requests=cpu=x,memory=y]
//                                     [-c <container>]
//
// Each flag value is a comma-separated list of resource=quantity pairs.
// Existing resource values not mentioned are preserved.
// ---------------------------------------------------------------------------

async function* setResources(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const resourceArg = args[2];
    if (!resourceArg) throw Error("kubectl set resources: expected <type>/<name>");
    const res = parseResourceArg(resourceArg);
    if (!res) throw Error(`kubectl set resources: expected <type>/<name>, got "${resourceArg}"`);
    const { kind, name } = res;

    if (!isWorkloadKind(kind)) throw Error(`kubectl set resources: unsupported resource type "${kind}"`);

    let targetContainer: string | undefined;
    let limitsCpu: string | undefined;
    let limitsMemory: string | undefined;
    let requestsCpu: string | undefined;
    let requestsMemory: string | undefined;

    for (let i = 3; i < args.length; i++) {
        const cFlag = parseContainerFlag(args, i);
        if (cFlag) {
            targetContainer = cFlag.value;
            i += cFlag.advance;
            continue;
        }
        const a = args[i];
        // Accept both --limits=cpu=x,memory=y and --limits cpu=x,memory=y
        let valueStr: string | undefined;
        let flagName: string | undefined;
        if (a.startsWith("--limits=")) {
            flagName = "limits"; valueStr = a.slice("--limits=".length);
        } else if (a === "--limits" && args[i + 1]) {
            flagName = "limits"; valueStr = args[++i];
        } else if (a.startsWith("--requests=")) {
            flagName = "requests"; valueStr = a.slice("--requests=".length);
        } else if (a === "--requests" && args[i + 1]) {
            flagName = "requests"; valueStr = args[++i];
        }
        if (flagName && valueStr) {
            for (const part of valueStr.split(",")) {
                const eq = part.indexOf("=");
                if (eq === -1) continue;
                const rKey = part.slice(0, eq);
                const rVal = part.slice(eq + 1);
                if (flagName === "limits") {
                    if (rKey === "cpu") limitsCpu = rVal;
                    else if (rKey === "memory") limitsMemory = rVal;
                } else {
                    if (rKey === "cpu") requestsCpu = rVal;
                    else if (rKey === "memory") requestsMemory = rVal;
                }
            }
        }
    }

    if (!limitsCpu && !limitsMemory && !requestsCpu && !requestsMemory)
        throw Error("kubectl set resources: --limits or --requests is required");

    const containers = getContainers(kind, name, namespace, state);
    if (!containers) throw Error(`kubectl set resources: ${kind}/${name} not found in namespace "${namespace}"`);

    const updated = containers.map(c => {
        if (targetContainer && c.name !== targetContainer) return c;
        const existing = c.resources ?? {};
        const limits = (limitsCpu || limitsMemory)
            ? { ...(existing.limits ?? {}), ...(limitsCpu ? { cpu: limitsCpu } : {}), ...(limitsMemory ? { memory: limitsMemory } : {}) }
            : existing.limits;
        const requests = (requestsCpu || requestsMemory)
            ? { ...(existing.requests ?? {}), ...(requestsCpu ? { cpu: requestsCpu } : {}), ...(requestsMemory ? { memory: requestsMemory } : {}) }
            : existing.requests;
        return {
            ...c,
            resources: {
                ...(limits ? { limits } : {}),
                ...(requests ? { requests } : {}),
            },
        };
    });

    dispatch(patchResource(kind, name, buildContainersPatch(kind, updated), namespace));
    yield `${resourceLabel(kind)}/${name} resource requirements updated`;
}
