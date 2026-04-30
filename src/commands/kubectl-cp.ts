import type { ActionDispatch } from "react";
import { type Action, type AppState, writeEphemeralFile, writePVFile, writeEmptyDirFile } from "../store/store";
import { readPodFile, listPodDirectory, resolvePVCMount, resolveEmptyDirMount } from "./helpers/pod-filesystem";
import { readFile, writeFile } from "./helpers/filesystem";

/**
 * kubectl cp implementation
 * Supports copying files between pods and local filesystem.
 * 
 * Usage:
 *   kubectl cp <pod>:<path> <local-path>        # Copy from pod to local
 *   kubectl cp <local-path> <pod>:<path>        # Copy from local to pod (future)
 *   kubectl cp <pod>:<path> <local-path> -c <container>  # Specify container
 */
export async function* kubectlCp(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch?: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    if (args.length < 3) {
        throw Error("kubectl cp: requires source and destination arguments");
    }

    const source = args[1];
    const destination = args[2];

    // Parse container flag
    let containerName: string | undefined;
    const containerFlagIdx = args.findIndex(a => a === "-c" || a === "--container");
    if (containerFlagIdx >= 0 && args[containerFlagIdx + 1]) {
        containerName = args[containerFlagIdx + 1];
    }

    // Determine direction: pod->local or local->pod
    const sourcePodMatch = source.match(/^([^:]+):(.+)$/);
    const destPodMatch = destination.match(/^([^:]+):(.+)$/);

    if (sourcePodMatch && !destPodMatch) {
        // Copy from pod to local filesystem
        yield* copyFromPod(sourcePodMatch[1], sourcePodMatch[2], destination, namespace, state, containerName);
    } else if (!sourcePodMatch && destPodMatch) {
        // Copy from local filesystem to pod
        if (!dispatch) {
            throw Error("kubectl cp: copying to pod requires dispatcher (internal error)");
        }
        yield* copyToPod(source, destPodMatch[1], destPodMatch[2], namespace, state, containerName, dispatch);
    } else if (sourcePodMatch && destPodMatch) {
        throw Error("kubectl cp: copying between pods is not supported (copy via local filesystem)");
    } else {
        throw Error("kubectl cp: at least one of source or destination must be a pod path (pod:path)");
    }
}

/**
 * Copy a file from a pod to the local filesystem.
 */
async function* copyFromPod(
    podName: string,
    podPath: string,
    localPath: string,
    namespace: string,
    state: AppState,
    containerName?: string,
): AsyncGenerator<string> {
    // Find the pod
    const pod = state.Pods.find(p => 
        p.metadata.name === podName && p.metadata.namespace === namespace
    );

    if (!pod) {
        throw Error(`Error from server (NotFound): pods "${podName}" not found`);
    }

    // Check if pod is running
    if (pod.status.phase !== "Running") {
        throw Error(`Error: pod ${podName} is not running (current phase: ${pod.status.phase})`);
    }

    // Verify container if specified
    if (containerName) {
        const containerExists = pod.spec.containers.some(c => c.name === containerName);
        if (!containerExists) {
            throw Error(`Error: container "${containerName}" not found in pod "${podName}"`);
        }
    }

    // Read the file from the pod
    const fileData = readPodFile(pod, podPath, state, containerName);

    if (!fileData) {
        // Check if it's a directory
        const dirContents = listPodDirectory(pod, podPath, state, containerName);
        if (dirContents.files.length > 0 || dirContents.directories.length > 0) {
            throw Error(`kubectl cp: ${podPath} is a directory (directory copying not yet supported)`);
        }
        throw Error(`Error: file ${podPath} not found in pod ${podName}`);
    }

    // Write to local filesystem
    writeFile(localPath, fileData.content);

    yield `Copied ${podName}:${podPath} to ${localPath} (source: ${fileData.source})`;
}

/**
 * Copy a file from the local filesystem to a pod.
 * Writes to the pod's ephemeral filesystem.
 */
async function* copyToPod(
    localPath: string,
    podName: string,
    podPath: string,
    namespace: string,
    state: AppState,
    containerName: string | undefined,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    // Find the pod
    const pod = state.Pods.find(p => 
        p.metadata.name === podName && p.metadata.namespace === namespace
    );

    if (!pod) {
        throw Error(`Error from server (NotFound): pods "${podName}" not found`);
    }

    // Check if pod is running
    if (pod.status.phase !== "Running") {
        throw Error(`Error: pod ${podName} is not running (current phase: ${pod.status.phase})`);
    }

    // Determine target container (default to first container if not specified)
    let targetContainer = containerName;
    if (!targetContainer) {
        if (pod.spec.containers.length === 0) {
            throw Error(`Error: pod "${podName}" has no containers`);
        }
        targetContainer = pod.spec.containers[0].name;
        // Note: Real kubectl would show "Defaulted container..." message
    } else {
        // Verify container exists
        const containerExists = pod.spec.containers.some(c => c.name === targetContainer);
        if (!containerExists) {
            throw Error(`Error: container "${targetContainer}" not found in pod "${podName}"`);
        }
    }

    // Read from local filesystem
    const content = readFile(localPath);
    if (content === undefined) {
        throw Error(`kubectl cp: ${localPath}: No such file or directory`);
    }

    // Normalize the pod path (ensure leading slash)
    const normalizedPath = podPath.startsWith('/') ? podPath : `/${podPath}`;

    // Check if path is within a PVC mount
    const pvcMount = resolvePVCMount(pod, normalizedPath, state, targetContainer);

    if (pvcMount) {
        // Writing to a PVC mount
        if (pvcMount.readOnly) {
            throw Error(`Error: cannot copy to ${podPath}: volume mount is read-only`);
        }

        // Write to PV filesystem
        dispatch(writePVFile(pvcMount.pvName, pvcMount.relativePath, content));

        const containerSuffix = !containerName && pod.spec.containers.length > 1
            ? ` (defaulted to container "${targetContainer}")`
            : "";
        yield `Copied ${localPath} to ${podName}:${podPath} (persistent volume: ${pvcMount.pvName})${containerSuffix}`;
        return;
    }

    // Check if path is within an emptyDir mount
    const emptyDirMount = resolveEmptyDirMount(pod, normalizedPath, targetContainer);

    if (emptyDirMount) {
        // Writing to an emptyDir mount
        if (emptyDirMount.readOnly) {
            throw Error(`Error: cannot copy to ${podPath}: volume mount is read-only`);
        }

        // Write to emptyDir filesystem
        dispatch(writeEmptyDirFile(podName, namespace, emptyDirMount.volumeName, emptyDirMount.relativePath, content));

        const containerSuffix = !containerName && pod.spec.containers.length > 1
            ? ` (defaulted to container "${targetContainer}")`
            : "";
        yield `Copied ${localPath} to ${podName}:${podPath} (emptyDir volume: ${emptyDirMount.volumeName})${containerSuffix}`;
        return;
    }

    // Write to pod's ephemeral filesystem (container-specific)
    dispatch(writeEphemeralFile(podName, namespace, targetContainer, normalizedPath, content));

    const containerSuffix = !containerName && pod.spec.containers.length > 1
        ? ` (defaulted to container "${targetContainer}")`
        : "";
    yield `Copied ${localPath} to ${podName}:${podPath} (ephemeral filesystem)${containerSuffix}`;
}
