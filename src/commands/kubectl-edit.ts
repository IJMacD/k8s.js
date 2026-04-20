import type { AppState } from "../store/store";
import { kubectlGetYaml } from "./kubectl-get-yaml";
import { kindAliases } from "./helpers/resource-types";

export async function* kubectlEdit(
    args: string[],
    namespace: string,
    state: AppState,
    openEditor: (yaml: string, namespace: string) => void,
): AsyncGenerator<string> {
    // args[0] === 'edit', args[1] === resource type, args[2] === name (optional slash notation)
    const resourceToken = args[1];
    if (!resourceToken) {
        throw Error("kubectl edit: you must specify the type of resource to edit");
    }

    let type: string;
    let name: string | undefined;

    const slash = resourceToken.indexOf("/");
    if (slash >= 0) {
        type = resourceToken.slice(0, slash).toLowerCase();
        name = resourceToken.slice(slash + 1);
    } else {
        type = resourceToken.toLowerCase();
        name = args[2];
    }

    if (!name) {
        throw Error(`kubectl edit: must specify a resource name`);
    }

    const kind = kindAliases[type];
    if (!kind) {
        throw Error(`error: the server doesn't have a resource type "${type}"`);
    }

    // Collect the YAML for this single resource
    const chunks: string[] = [];
    for await (const chunk of kubectlGetYaml(
        ["get", type, name],
        namespace,
        false,
        state,
        "yaml",
    )) {
        chunks.push(chunk);
    }
    const yaml = chunks.join("\n");

    openEditor(yaml, namespace);
    yield `${kind}/${name} opened in editor`;
}
