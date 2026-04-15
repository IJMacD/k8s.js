import type { ActionDispatch } from "react";
import {
    scaleDeployment,
    scaleStatefulSet,
    type Action,
    type AppState,
} from "../store/store";

export async function* kubectlScale(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    const replicasFlag = args.find(a => a.startsWith("--replicas="));
    if (!replicasFlag) throw Error("kubectl scale: --replicas=N is required");
    const replicas = parseInt(replicasFlag.slice("--replicas=".length), 10);
    if (isNaN(replicas) || replicas < 0) throw Error("kubectl scale: --replicas must be a non-negative integer");

    // statefulset/NAME  or  statefulset NAME  or  sts/NAME  or  sts NAME
    const stsSlashArg = args.find(a => a.startsWith("statefulset/") || a.startsWith("sts/"));
    if (stsSlashArg) {
        const resourceName = stsSlashArg.slice(stsSlashArg.indexOf("/") + 1);
        dispatch(scaleStatefulSet(resourceName, replicas, namespace));
        yield `statefulset.apps/${resourceName} scaled`; return;
    }
    if (args[1] === "statefulset" || args[1] === "sts") {
        const resourceName = args[2];
        if (!resourceName) throw Error("kubectl scale: missing statefulset name");
        dispatch(scaleStatefulSet(resourceName, replicas, namespace));
        yield `statefulset.apps/${resourceName} scaled`; return;
    }

    // accept: deployment/NAME  or  deployment NAME
    let resourceName: string | undefined;
    const slashArg = args.find(a => a.startsWith("deployment/"));
    if (slashArg) {
        resourceName = slashArg.slice("deployment/".length);
    } else if (args[1] === "deployment") {
        resourceName = args[2];
    }
    if (!resourceName) throw Error("kubectl scale: specify deployment/NAME, statefulset/NAME, or equivalent");

    // Verify resource exists before scaling
    if (!state.Deployments.find(d => d.metadata.name === resourceName && d.metadata.namespace === namespace))
        throw Error(`Error from server (NotFound): deployments "${resourceName}" not found`);

    dispatch(scaleDeployment(resourceName, replicas, namespace));
    yield `deployment.apps/${resourceName} scaled`;
}
