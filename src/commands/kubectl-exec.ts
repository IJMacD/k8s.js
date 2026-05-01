import type { AppState } from "../store/store";
import { readPodFile, listPodFiles } from "./helpers/pod-filesystem";
import { resolveEnv } from "./helpers/pod-env";

/**
 * kubectl exec implementation
 * Supports a limited set of commands for debugging pods.
 * 
 * Usage:
 *   kubectl exec <pod> -- <command> [args...]
 *   kubectl exec <pod> -c <container> -- <command> [args...]
 */
export async function* kubectlExec(
    args: string[],
    namespace: string,
    state: AppState,
): AsyncGenerator<string> {
    if (args.length < 3) {
        throw Error("kubectl exec: requires pod name and command (use -- to separate)");
    }

    const podName = args[1];
    
    // Find the -- separator
    const separatorIdx = args.indexOf('--');
    if (separatorIdx === -1) {
        throw Error("kubectl exec: requires -- before command");
    }

    // Parse container flag
    let containerName: string | undefined;
    const containerFlagIdx = args.findIndex(a => a === "-c" || a === "--container");
    if (containerFlagIdx >= 0 && containerFlagIdx < separatorIdx && args[containerFlagIdx + 1]) {
        containerName = args[containerFlagIdx + 1];
    }

    // Extract command and its arguments
    const command = args[separatorIdx + 1];
    const commandArgs = args.slice(separatorIdx + 2);

    if (!command) {
        throw Error("kubectl exec: no command specified");
    }

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

    // Determine target container (default to first)
    let targetContainer = containerName;
    if (!targetContainer) {
        if (pod.spec.containers.length === 0) {
            throw Error(`Error: pod "${podName}" has no containers`);
        }
        targetContainer = pod.spec.containers[0].name;
    } else {
        const containerExists = pod.spec.containers.some(c => c.name === targetContainer);
        if (!containerExists) {
            throw Error(`Error: container "${targetContainer}" not found in pod "${podName}"`);
        }
    }

    // Execute the command
    yield* executeCommand(command, commandArgs, pod, targetContainer, state);
}

/**
 * Execute a pseudo-shell command
 */
async function* executeCommand(
    command: string,
    args: string[],
    pod: AppState["Pods"][number],
    containerName: string,
    state: AppState,
): AsyncGenerator<string> {
    switch (command) {
        case "ls":
            yield* execLs(args, pod, containerName, state);
            break;
        
        case "cat":
            yield* execCat(args, pod, containerName, state);
            break;
        
        case "env":
            yield* execEnv(pod, containerName, state);
            break;
        
        case "pwd":
            yield "/";
            break;
        
        case "echo":
            yield args.join(' ');
            break;
        
        case "whoami":
            yield "root";
            break;
        
        default:
            throw Error(`kubectl exec: command not implemented: ${command}\nSupported commands: ls, cat, env, pwd, echo, whoami`);
    }
}

/**
 * Execute ls command - list files in pod's filesystem
 */
async function* execLs(
    args: string[],
    pod: AppState["Pods"][number],
    containerName: string,
    state: AppState,
): AsyncGenerator<string> {
    const path = args[0] || '/';
    
    // Get all files visible to this container
    const fileList = listPodFiles(pod, state, containerName);
    
    if (path === '/' || path === '.') {
        // List root directory - show top-level directories
        const dirs = new Set<string>();
        const files = new Set<string>();
        
        for (const file of fileList.files) {
            const parts = file.path.split('/').filter(Boolean);
            if (parts.length === 1) {
                files.add(parts[0]);
            } else if (parts.length > 1) {
                dirs.add(parts[0]);
            }
        }
        
        // Add directories from fileList.directories
        for (const dir of fileList.directories) {
            const parts = dir.split('/').filter(Boolean);
            if (parts.length > 0) {
                dirs.add(parts[0]);
            }
        }
        
        // Output directories first, then files (no trailing slash - standard ls behavior)
        const sortedDirs = Array.from(dirs).sort();
        const sortedFiles = Array.from(files).sort();
        
        for (const dir of sortedDirs) {
            yield dir;
        }
        for (const file of sortedFiles) {
            yield file;
        }
    } else {
        // List specific directory
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const pathPrefix = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
        
        const dirs = new Set<string>();
        const files = new Set<string>();
        
        for (const file of fileList.files) {
            if (file.path === normalizedPath) {
                // Exact match - it's a file
                yield normalizedPath.split('/').pop() || '';
                return;
            }
            
            if (file.path.startsWith(pathPrefix)) {
                const relativePath = file.path.slice(pathPrefix.length);
                const parts = relativePath.split('/').filter(Boolean);
                if (parts.length === 1) {
                    files.add(parts[0]);
                } else if (parts.length > 1) {
                    dirs.add(parts[0]);
                }
            }
        }
        
        // Check directories
        for (const dir of fileList.directories) {
            if (dir.startsWith(pathPrefix)) {
                const relativePath = dir.slice(pathPrefix.length);
                const parts = relativePath.split('/').filter(Boolean);
                if (parts.length > 0) {
                    dirs.add(parts[0]);
                }
            }
        }
        
        const sortedDirs = Array.from(dirs).sort();
        const sortedFiles = Array.from(files).sort();
        
        if (sortedDirs.length === 0 && sortedFiles.length === 0) {
            throw Error(`ls: cannot access '${path}': No such file or directory`);
        }
        
        for (const dir of sortedDirs) {
            yield dir;
        }
        for (const file of sortedFiles) {
            yield file;
        }
    }
}

/**
 * Execute cat command - read file contents
 */
async function* execCat(
    args: string[],
    pod: AppState["Pods"][number],
    containerName: string,
    state: AppState,
): AsyncGenerator<string> {
    if (args.length === 0) {
        throw Error("cat: missing file operand");
    }
    
    for (const path of args) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const fileData = readPodFile(pod, normalizedPath, state, containerName);
        
        if (!fileData) {
            throw Error(`cat: ${path}: No such file or directory`);
        }
        
        yield fileData.content;
    }
}

/**
 * Execute env command - show environment variables
 */
async function* execEnv(
    pod: AppState["Pods"][number],
    containerName: string,
    state: AppState,
): AsyncGenerator<string> {
    // Use resolveEnv from pod-env helper which handles env, envFrom, configmaps, secrets, and fieldRef
    const resolvedEnv = resolveEnv(pod, containerName, state);
    
    // Convert to KEY=VALUE format and yield sorted
    const envVars: string[] = [];
    
    for (const [key, value] of resolvedEnv) {
        envVars.push(`${key}=${value}`);
    }
    
    for (const envVar of envVars.sort()) {
        yield envVar;
    }
}
