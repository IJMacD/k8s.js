import type { ActionDispatch } from "react";
import {
    deletePod,
    updateNodeSpec,
    type Action,
    type AppState,
} from "../store/store";

export async function* kubectlNode(
    args: string[],
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    if (args[0] === "cordon" || args[0] === "uncordon") {
        const name = args[1];
        if (!name) throw Error(`kubectl ${args[0]}: missing node name`);
        const node = state.Nodes.find(n => n.metadata.name === name);
        if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
        const unschedulable = args[0] === "cordon";
        dispatch(updateNodeSpec(name, { unschedulable }));
        yield `node/${name} ${unschedulable ? "cordoned" : "uncordoned"}`; return;
    }
    if (args[0] === "drain") {
        const name = args[1];
        if (!name) throw Error("kubectl drain: missing node name");
        const node = state.Nodes.find(n => n.metadata.name === name);
        if (!node) throw Error(`Error from server (NotFound): nodes "${name}" not found`);
        // Cordon first
        dispatch(updateNodeSpec(name, { unschedulable: true }));
        // Evict all pods on the node
        const nodePods = state.Pods.filter(p => p.spec.nodeName === name);
        for (const pod of nodePods) {
            dispatch(deletePod(pod.metadata.name, pod.metadata.namespace));
        }
        yield (
            `node/${name} cordoned\n` +
            nodePods.map(p => `pod/${p.metadata.name} evicted`).join("\n") +
            (nodePods.length ? "\n" : "") +
            `node/${name} drained`
        ); return;
    }
}
