import type { AppState } from "../store/store";

export async function* kubectlRollout(
    args: string[],
    namespace: string,
    state: AppState,
    getState: () => AppState,
): AsyncGenerator<string> {
    const subCmd = args[1];
    if (!subCmd) throw Error("kubectl rollout: subcommand required (status, undo)");

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
        throw Error("kubectl rollout undo: not yet implemented");
    }

    throw Error(`kubectl rollout: unknown subcommand "${subCmd}"`);
}
