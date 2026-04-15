import type { ActionDispatch } from "react";
import {
    setDeploymentImage,
    type Action,
    type AppState,
} from "../store/store";
import { kubectlCreate } from "./kubectl-create";
import { kubectlDelete } from "./kubectl-delete";
import { kubectlDescribe } from "./kubectl-describe";
import { kubectlExpose } from "./kubectl-expose";
import { kubectlGet } from "./kubectl-get";
import { kubectlNode } from "./kubectl-node";
import { kubectlPatch } from "./kubectl-patch";
import { kubectlRollout } from "./kubectl-rollout";
import { kubectlScale } from "./kubectl-scale";

/**
 * Strips -n / --namespace flags from kubectl args and returns the clean
 * positional args alongside the resolved namespace.
 */
function parseKubectlArgs(rawArgs: string[]): { namespace: string; args: string[] } {
    let namespace = "default";
    const args: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const a = rawArgs[i];
        if ((a === "-n" || a === "--namespace") && rawArgs[i + 1]) {
            namespace = rawArgs[++i];
        } else if (a.startsWith("--namespace=")) {
            namespace = a.slice("--namespace=".length);
        } else {
            args.push(a);
        }
    }
    return { namespace, args };
}

export async function* kubectl(
    rawArgs: string[],
    dispatch: ActionDispatch<[action: Action]>,
    getState: () => AppState,
): AsyncGenerator<string> {
    const state = getState();
    const { namespace, args } = parseKubectlArgs(rawArgs);
    if (args[0] === "run" || args[0] === "create") {
        yield* kubectlCreate(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "set" && args[1] === "image") {
        // kubectl set image deployment/<name> <container>=<image>
        const resourceArg = args[2];
        if (!resourceArg?.startsWith("deployment/"))
            throw Error("kubectl set image: specify deployment/<name>");
        const deploymentName = resourceArg.slice("deployment/".length);
        if (!deploymentName) throw Error("kubectl set image: missing deployment name");

        const assignArg = args[3];
        if (!assignArg?.includes("="))
            throw Error("kubectl set image: expected <container>=<image>");
        const eqIdx = assignArg.indexOf("=");
        const container = assignArg.slice(0, eqIdx);
        const image = assignArg.slice(eqIdx + 1);
        if (!container || !image)
            throw Error("kubectl set image: expected <container>=<image>");

        dispatch(setDeploymentImage(deploymentName, container, image, namespace));
        yield `deployment.apps/${deploymentName} image updated`; return;
    }
    if (args[0] === "scale") {
        yield* kubectlScale(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "expose") {
        yield* kubectlExpose(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "cordon" || args[0] === "uncordon" || args[0] === "drain") {
        yield* kubectlNode(args, state, dispatch);
        return;
    }
    if (args[0] === "get") {
        const allNamespaces = rawArgs.includes("-A") || rawArgs.includes("--all-namespaces");
        yield* kubectlGet(args, namespace, allNamespaces, state);
        return;
    }
    if (args[0] === "rollout") {
        yield* kubectlRollout(args, namespace, state, getState);
        return;
    }
    if (args[0] === "describe") {
        yield* kubectlDescribe(args, namespace, state);
        return;
    }
    if (args[0] === "patch") {
        yield* kubectlPatch(args, namespace, state, dispatch);
        return;
    }

    if (args[0] === "delete") {
        yield* kubectlDelete(args, namespace, state, dispatch);
        return;
    }
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
