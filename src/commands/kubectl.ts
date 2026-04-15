import type { ActionDispatch } from "react";
import {
    type Action,
    type AppState,
} from "../store/store";
import { kubectlApply } from "./kubectl-apply";
import { kubectlCreate } from "./kubectl-create";
import { kubectlDelete } from "./kubectl-delete";
import { kubectlDescribe } from "./kubectl-describe";
import { kubectlExpose } from "./kubectl-expose";
import { kubectlGet } from "./kubectl-get";
import { kubectlNode } from "./kubectl-node";
import { kubectlPatch } from "./kubectl-patch";
import { kubectlRollout } from "./kubectl-rollout";
import { kubectlScale } from "./kubectl-scale";
import { kubectlLabel } from "./kubectl-label";
import { kubectlSet } from "./kubectl-set";

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
    if (args[0] === "apply") {
        yield* kubectlApply(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "run" || args[0] === "create") {
        yield* kubectlCreate(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "set") {
        yield* kubectlSet(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "scale") {
        yield* kubectlScale(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "expose") {
        yield* kubectlExpose(args, namespace, state, dispatch);
        return;
    }
    if (args[0] === "label") {
        yield* kubectlLabel(args, namespace, state, dispatch);
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
