import type { ActionDispatch } from "react";
import { patchResource, rollbackDeployment, type Action, type AppState } from "../store/store";

export async function* kubectlRollout(
    args: string[],
    namespace: string,
    state: AppState,
    getState: () => AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const subCmd = args[1];
    if (!subCmd) throw Error("kubectl rollout: subcommand required (status, undo, restart, history)");

    if (subCmd === "status") {
        const resourceArg = args[2];
        if (!resourceArg) throw Error("kubectl rollout status: specify a resource (e.g. deployment/<name>)");

        // Only deployments supported for now
        const kind = resourceArg.includes("/") ? resourceArg.split("/")[0].toLowerCase() : "deployment";
        const name = resourceArg.includes("/") ? resourceArg.split("/")[1] : (args[3] ?? resourceArg);
        if (kind !== "deployment" && kind !== "deploy")
            throw Error("kubectl rollout status: only deployments are supported");

        // Parse --timeout=<N>s (default 300s), --watch=false disables waiting
        const timeoutFlag = args.find(a => a.startsWith("--timeout="));
        const timeoutMs = timeoutFlag
            ? parseInt(timeoutFlag.slice("--timeout=".length), 10) * 1000
            : 300_000;
        const noWatch = args.includes("--watch=false") || args.includes("--no-wait");

        const d = state.Deployments.find(
            dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
        );
        if (!d) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        const isComplete = (s: AppState) => {
            const dep = s.Deployments.find(
                dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
            );
            if (!dep) return false;
            return dep.status.updatedReplicas >= dep.spec.replicas &&
                dep.status.readyReplicas >= dep.spec.replicas &&
                dep.status.availableReplicas >= dep.spec.replicas;
        };

        if (noWatch) {
            if (isComplete(state)) {
                yield `deployment "${name}" successfully rolled out`; return;
            }
            yield `Waiting for deployment "${name}" rollout to finish: ${d.status.readyReplicas} of ${d.spec.replicas} updated replicas are available...`; return;
        }

        // Poll live state; only yield a line when the status message changes (matches real kubectl behaviour)
        const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
        const deadline = Date.now() + timeoutMs;
        let lastLine = '';
        while (true) {
            const current = getState();
            if (isComplete(current)) {
                yield `deployment "${name}" successfully rolled out`;
                return;
            }
            if (Date.now() >= deadline) {
                const dep = current.Deployments.find(
                    dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
                );
                throw new Error(`error: timed out waiting for the condition on deployments/${name}\n(${dep?.status.readyReplicas ?? 0}/${dep?.spec.replicas ?? 0} replicas available)`);
            }
            const dep = current.Deployments.find(
                dep => dep.metadata.name === name && dep.metadata.namespace === namespace,
            );
            const line = `Waiting for deployment "${name}" rollout to finish: ${dep?.status.readyReplicas ?? 0}/${dep?.spec.replicas ?? 0} updated replicas are available...`;
            if (line !== lastLine) {
                yield line;
                lastLine = line;
            }
            await sleep(500);
        }
    }

    if (subCmd === "undo") {
        const resourceArg = args[2];
        if (!resourceArg) throw Error("kubectl rollout undo: specify a resource (e.g. deployment/<name>)");

        const kind = resourceArg.includes("/") ? resourceArg.split("/")[0].toLowerCase() : "deployment";
        const name = resourceArg.includes("/") ? resourceArg.split("/")[1] : (args[3] ?? resourceArg);
        if (kind !== "deployment" && kind !== "deploy")
            throw Error("kubectl rollout undo: only deployments are supported");

        const toRevFlag = args.find(a => a.startsWith("--to-revision="));
        const toRevision = toRevFlag ? parseInt(toRevFlag.slice("--to-revision=".length), 10) : undefined;

        const deployment = state.Deployments.find(
            d => d.metadata.name === name && d.metadata.namespace === namespace,
        );
        if (!deployment) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        // Sort ascending by creation time: oldest = revision 1, newest = current
        const ownedRSes = state.ReplicaSets
            .filter(rs =>
                rs.metadata.namespace === namespace &&
                rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name),
            )
            .sort((a, b) =>
                new Date(a.metadata.creationTimestamp).getTime() - new Date(b.metadata.creationTimestamp).getTime(),
            );

        if (ownedRSes.length < 2) {
            throw Error(`error: no rollout history found for deployment "${name}"`);
        }

        let targetRS;
        if (toRevision !== undefined) {
            if (toRevision === 0 || toRevision > ownedRSes.length)
                throw Error(`error: unable to find specified revision ${toRevision} in history`);
            targetRS = ownedRSes[toRevision - 1];
            const currentRS = ownedRSes[ownedRSes.length - 1];
            if (targetRS.metadata.name === currentRS.metadata.name)
                throw Error(`error: deployment "${name}" is already at revision ${toRevision}`);
        } else {
            // Default: roll back to the second-most-recent RS
            targetRS = ownedRSes[ownedRSes.length - 2];
        }

        dispatch(rollbackDeployment(name, targetRS.spec.template, namespace));
        yield `deployment.apps/${name} rolled back`;
        return;
    }

    if (subCmd === "restart") {
        const resourceArg = args[2];
        if (!resourceArg) throw Error("kubectl rollout restart: specify a resource (e.g. deployment/<name>)");

        const kind = resourceArg.includes("/") ? resourceArg.split("/")[0].toLowerCase() : "deployment";
        const name = resourceArg.includes("/") ? resourceArg.split("/")[1] : (args[3] ?? resourceArg);
        if (kind !== "deployment" && kind !== "deploy")
            throw Error("kubectl rollout restart: only deployments are supported");

        const deployment = state.Deployments.find(
            d => d.metadata.name === name && d.metadata.namespace === namespace,
        );
        if (!deployment) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        const restartedAt = new Date().toISOString();
        dispatch(patchResource("deployment", name, {
            metadata: { generation: deployment.metadata.generation + 1 },
            spec: {
                template: {
                    metadata: {
                        annotations: {
                            ...(deployment.spec.template.metadata?.annotations ?? {}),
                            "kubectl.kubernetes.io/restartedAt": restartedAt,
                        },
                    },
                },
            },
        }, namespace));
        yield `deployment.apps/${name} restarted`;
        return;
    }

    if (subCmd === "history") {
        const resourceArg = args[2];
        if (!resourceArg) throw Error("kubectl rollout history: specify a resource (e.g. deployment/<name>)");

        const kind = resourceArg.includes("/") ? resourceArg.split("/")[0].toLowerCase() : "deployment";
        const name = resourceArg.includes("/") ? resourceArg.split("/")[1] : (args[3] ?? resourceArg);
        if (kind !== "deployment" && kind !== "deploy")
            throw Error("kubectl rollout history: only deployments are supported");

        const deployment = state.Deployments.find(
            d => d.metadata.name === name && d.metadata.namespace === namespace,
        );
        if (!deployment) throw Error(`Error from server (NotFound): deployments "${name}" not found`);

        // Sort ascending by creation time: oldest = revision 1, newest = current
        const ownedRSes = state.ReplicaSets
            .filter(rs =>
                rs.metadata.namespace === namespace &&
                rs.metadata.ownerReferences?.some(r => r.kind === "Deployment" && r.name === name),
            )
            .sort((a, b) =>
                new Date(a.metadata.creationTimestamp).getTime() - new Date(b.metadata.creationTimestamp).getTime(),
            );

        // --revision=N: show detailed info for a specific revision
        const revFlag = args.find(a => a.startsWith("--revision="));
        if (revFlag) {
            const revNum = parseInt(revFlag.slice("--revision=".length), 10);
            const rs = ownedRSes[revNum - 1];
            if (!rs) throw Error(`error: unable to find the specified revision`);
            const images = rs.spec.template.spec.containers
                .map(c => `    ${c.name}: ${c.image}`)
                .join("\n");
            const restartedAt = rs.spec.template.metadata?.annotations?.["kubectl.kubernetes.io/restartedAt"];
            const extra = restartedAt ? `\n  Annotations: kubectl.kubernetes.io/restartedAt=${restartedAt}` : "";
            yield `deployment.apps/${name} with revision #${revNum}\nPod Template:\n  Containers:\n${images}${extra}`;
            return;
        }

        if (ownedRSes.length === 0) {
            yield `deployment.apps/${name}\nREVISION  CHANGE-CAUSE\n(none)`;
            return;
        }

        const lines = [`deployment.apps/${name}`, "REVISION  CHANGE-CAUSE"];
        ownedRSes.forEach((rs, i) => {
            const changeCause = rs.metadata.annotations?.["kubernetes.io/change-cause"] ?? "<none>";
            const marker = i === ownedRSes.length - 1 ? " (current)" : "";
            lines.push(`${String(i + 1).padEnd(10)}${changeCause}${marker}`);
        });
        yield lines.join("\n");
        return;
    }

    throw Error(`kubectl rollout: unknown subcommand "${subCmd}". Supported: status, undo, restart, history`);
}

