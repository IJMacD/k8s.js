import type { AppState } from "../../store/store";
import { resolveFieldRef } from "./pod-metadata";

/**
 * Represents a file in a pod's filesystem.
 */
export interface PodFile {
    path: string;
    content: string;
    source: "configMap" | "secret" | "downwardAPI" | "ephemeral" | "pv" | "emptyDir";
}

/**
 * Result of listing files in a pod's filesystem.
 */
export interface PodFileList {
    files: PodFile[];
    directories: string[];
}

/**
 * Resolves volume mounts for a pod and returns all accessible files.
 */
export function listPodFiles(
    pod: AppState["Pods"][number],
    state: AppState,
    containerName?: string,
): PodFileList {
    const ns = pod.metadata.namespace;
    const files: PodFile[] = [];
    const directories = new Set<string>();

    // Filter containers
    const containers = containerName
        ? pod.spec.containers.filter(c => c.name === containerName)
        : pod.spec.containers;

    for (const container of containers) {
        for (const vm of container.volumeMounts ?? []) {
            const vol = pod.spec.volumes?.find(v => v.name === vm.name);
            if (!vol) continue;

            // Track the mount path as a directory
            directories.add(vm.mountPath);

            let data: Record<string, string> | undefined;
            let source: PodFile["source"] = "ephemeral";

            if (vol.configMap) {
                data = state.ConfigMaps.find(
                    cm => cm.metadata.name === vol.configMap!.name && cm.metadata.namespace === ns,
                )?.data;
                source = "configMap";
            } else if (vol.secret) {
                data = state.Secrets.find(
                    s => s.metadata.name === vol.secret!.secretName && s.metadata.namespace === ns,
                )?.data;
                source = "secret";
            } else if (vol.persistentVolumeClaim) {
                // Find the PVC
                const pvc = state.PersistentVolumeClaims.find(
                    p => p.metadata.name === vol.persistentVolumeClaim!.claimName && p.metadata.namespace === ns,
                );
                if (pvc && pvc.spec.volumeName) {
                    // Get files from PV filesystem
                    data = state.Filesystems.PVFilesystems[pvc.spec.volumeName];
                    source = "pv"; // PV files are writable
                }
            } else if (vol.emptyDir) {
                // Get files from emptyDir filesystem
                const emptyDirKey = `${ns}/${pod.metadata.name}/${vol.name}`;
                data = state.Filesystems.EmptyDir[emptyDirKey];
                source = "emptyDir"; // emptyDir files are writable
            } else if (vol.downwardAPI) {
                // Construct data from downwardAPI items
                data = {};
                source = "downwardAPI";
                for (const item of vol.downwardAPI.items ?? []) {
                    if (item.fieldRef) {
                        data[item.path] = resolveFieldRef(item.fieldRef.fieldPath, pod);
                    } else if (item.resourceFieldRef) {
                        const resource = item.resourceFieldRef.resource;
                        if (resource === "limits.cpu") {
                            data[item.path] = container.resources?.limits?.cpu ?? "1";
                        } else if (resource === "limits.memory") {
                            data[item.path] = container.resources?.limits?.memory ?? "512Mi";
                        } else if (resource === "requests.cpu") {
                            data[item.path] = container.resources?.requests?.cpu ?? "100m";
                        } else if (resource === "requests.memory") {
                            data[item.path] = container.resources?.requests?.memory ?? "128Mi";
                        } else {
                            data[item.path] = `(${resource})`;
                        }
                    }
                }
            }

            if (!data) continue;

            // Add all files from this volume mount
            for (const [filename, content] of Object.entries(data)) {
                const fullPath = vm.mountPath.endsWith('/')
                    ? `${vm.mountPath}${filename}`
                    : `${vm.mountPath}/${filename}`;
                
                files.push({
                    path: fullPath,
                    content,
                    source,
                });

                // Track parent directories
                const parts = fullPath.split('/').filter(Boolean);
                for (let i = 1; i < parts.length; i++) {
                    directories.add('/' + parts.slice(0, i).join('/'));
                }
            }
        }
    }

    return {
        files,
        directories: Array.from(directories).sort(),
    };
}

/**
 * Reads a file from a pod's filesystem.
 * Returns the file content if found, or null if not found.
 */
export function readPodFile(
    pod: AppState["Pods"][number],
    filePath: string,
    state: AppState,
    containerName?: string,
): { content: string; source: PodFile["source"] } | null {
    // Normalize the path (remove trailing slashes, ensure leading slash)
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    // Check ephemeral filesystem first
    // If container specified, check that container; otherwise check all containers
    if (containerName) {
        const containerKey = `${pod.metadata.namespace}/${pod.metadata.name}/${containerName}`;
        const ephemeralFiles = state.Filesystems.Ephemeral[containerKey];
        if (ephemeralFiles && normalizedPath in ephemeralFiles) {
            return {
                content: ephemeralFiles[normalizedPath],
                source: "ephemeral",
            };
        }
    } else {
        // Check all containers for this pod
        const podPrefix = `${pod.metadata.namespace}/${pod.metadata.name}/`;
        for (const [key, files] of Object.entries(state.Filesystems.Ephemeral)) {
            if (key.startsWith(podPrefix) && normalizedPath in files) {
                return {
                    content: files[normalizedPath],
                    source: "ephemeral",
                };
            }
        }
    }

    // Check volume mounts
    const fileList = listPodFiles(pod, state, containerName);
    const file = fileList.files.find(f => f.path === normalizedPath);
    if (file) {
        return { content: file.content, source: file.source };
    }

    return null;
}

/**
 * Determines if a path is within a PVC mount and returns the PV name and relative path.
 * Returns null if the path is not in a PVC mount or the PVC is not bound.
 */
export function resolvePVCMount(
    pod: AppState["Pods"][number],
    filePath: string,
    state: AppState,
    containerName?: string,
): { pvName: string; relativePath: string; readOnly: boolean } | null {
    const ns = pod.metadata.namespace;

    // Determine which container(s) to check
    const containers = containerName
        ? pod.spec.containers.filter(c => c.name === containerName)
        : pod.spec.containers;

    // Check each container's volume mounts
    for (const container of containers) {
        for (const vm of container.volumeMounts ?? []) {
            // Check if path is within this mount path
            const mountPath = vm.mountPath.endsWith('/') ? vm.mountPath.slice(0, -1) : vm.mountPath;
            if (filePath === mountPath || filePath.startsWith(mountPath + '/')) {
                // Find the volume
                const vol = pod.spec.volumes?.find(v => v.name === vm.name);
                if (vol?.persistentVolumeClaim) {
                    // Find the PVC
                    const pvc = state.PersistentVolumeClaims.find(
                        p => p.metadata.name === vol.persistentVolumeClaim!.claimName && p.metadata.namespace === ns,
                    );
                    if (pvc && pvc.spec.volumeName) {
                        // Calculate relative path within the PV (strip leading slash for consistency)
                        const relativePath = filePath === mountPath ? '/' : filePath.slice(mountPath.length + 1);
                        return {
                            pvName: pvc.spec.volumeName,
                            relativePath,
                            readOnly: vm.readOnly ?? false,
                        };
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Determines if a path is within an emptyDir mount and returns the volume name and relative path.
 * Returns null if the path is not in an emptyDir mount.
 */
export function resolveEmptyDirMount(
    pod: AppState["Pods"][number],
    filePath: string,
    containerName?: string,
): { volumeName: string; relativePath: string; readOnly: boolean } | null {
    // Determine which container(s) to check
    const containers = containerName
        ? pod.spec.containers.filter(c => c.name === containerName)
        : pod.spec.containers;

    // Check each container's volume mounts
    for (const container of containers) {
        for (const vm of container.volumeMounts ?? []) {
            // Check if path is within this mount path
            const mountPath = vm.mountPath.endsWith('/') ? vm.mountPath.slice(0, -1) : vm.mountPath;
            if (filePath === mountPath || filePath.startsWith(mountPath + '/')) {
                // Find the volume
                const vol = pod.spec.volumes?.find(v => v.name === vm.name);
                if (vol?.emptyDir) {
                    // Calculate relative path within the emptyDir (strip leading slash for consistency)
                    const relativePath = filePath === mountPath ? '/' : filePath.slice(mountPath.length + 1);
                    return {
                        volumeName: vol.name,
                        relativePath,
                        readOnly: vm.readOnly ?? false,
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Checks if a path is within a read-only volume mount (ConfigMap, Secret, or readOnly flag).
 * Returns true if the path is in a read-only mount.
 */
export function isReadOnlyMount(
    pod: AppState["Pods"][number],
    filePath: string,
    containerName?: string,
): boolean {
    const containers = containerName
        ? pod.spec.containers.filter(c => c.name === containerName)
        : pod.spec.containers;

    for (const container of containers) {
        for (const vm of container.volumeMounts ?? []) {
            const mountPath = vm.mountPath.endsWith('/') ? vm.mountPath.slice(0, -1) : vm.mountPath;
            if (filePath === mountPath || filePath.startsWith(mountPath + '/')) {
                // Check if mount itself is marked readOnly
                if (vm.readOnly) {
                    return true;
                }

                // Check if volume type is inherently read-only
                const vol = pod.spec.volumes?.find(v => v.name === vm.name);
                if (vol?.configMap || vol?.secret || vol?.downwardAPI) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Lists all files in a directory within a pod's filesystem.
 */
export function listPodDirectory(
    pod: AppState["Pods"][number],
    dirPath: string,
    state: AppState,
    containerName?: string,
): { files: string[]; directories: string[] } {
    const fileList = listPodFiles(pod, state, containerName);
    
    // Normalize the directory path
    const normalizedDir = dirPath === '/' ? '/' : 
        (dirPath.startsWith('/') ? dirPath : `/${dirPath}`).replace(/\/$/, '');
    
    const files: string[] = [];
    const subdirs = new Set<string>();

    // Add ephemeral files
    // If container specified, check that container; otherwise check all containers
    if (containerName) {
        const containerKey = `${pod.metadata.namespace}/${pod.metadata.name}/${containerName}`;
        const ephemeralFiles = state.Filesystems.Ephemeral[containerKey];
        if (ephemeralFiles) {
            for (const ephemeralPath of Object.keys(ephemeralFiles)) {
                if (normalizedDir === '/') {
                    const parts = ephemeralPath.split('/').filter(Boolean);
                    if (parts.length === 1) {
                        files.push(parts[0]);
                    } else if (parts.length > 1) {
                        subdirs.add(parts[0]);
                    }
                } else if (ephemeralPath.startsWith(normalizedDir + '/')) {
                    const relativePath = ephemeralPath.slice(normalizedDir.length + 1);
                    const parts = relativePath.split('/');
                    if (parts.length === 1) {
                        files.push(parts[0]);
                    } else {
                        subdirs.add(parts[0]);
                    }
                }
            }
        }
    } else {
        // Check all containers for this pod
        const podPrefix = `${pod.metadata.namespace}/${pod.metadata.name}/`;
        for (const [key, ephemeralFiles] of Object.entries(state.Filesystems.Ephemeral)) {
            if (key.startsWith(podPrefix)) {
                for (const ephemeralPath of Object.keys(ephemeralFiles)) {
                    if (normalizedDir === '/') {
                        const parts = ephemeralPath.split('/').filter(Boolean);
                        if (parts.length === 1) {
                            files.push(parts[0]);
                        } else if (parts.length > 1) {
                            subdirs.add(parts[0]);
                        }
                    } else if (ephemeralPath.startsWith(normalizedDir + '/')) {
                        const relativePath = ephemeralPath.slice(normalizedDir.length + 1);
                        const parts = relativePath.split('/');
                        if (parts.length === 1) {
                            files.push(parts[0]);
                        } else {
                            subdirs.add(parts[0]);
                        }
                    }
                }
            }
        }
    }

    // Find files directly in this directory from volume mounts
    for (const file of fileList.files) {
        if (normalizedDir === '/') {
            // Root directory - take first path component
            const parts = file.path.split('/').filter(Boolean);
            if (parts.length === 1) {
                files.push(parts[0]);
            } else if (parts.length > 1) {
                subdirs.add(parts[0]);
            }
        } else if (file.path.startsWith(normalizedDir + '/')) {
            const relativePath = file.path.slice(normalizedDir.length + 1);
            const parts = relativePath.split('/');
            if (parts.length === 1) {
                files.push(parts[0]);
            } else {
                subdirs.add(parts[0]);
            }
        }
    }

    // Find subdirectories
    for (const dir of fileList.directories) {
        if (dir !== normalizedDir && dir.startsWith(normalizedDir + '/')) {
            const relativePath = dir.slice(normalizedDir.length + 1);
            const parts = relativePath.split('/');
            if (parts.length >= 1 && parts[0]) {
                subdirs.add(parts[0]);
            }
        }
    }

    return {
        files: Array.from(new Set(files)).sort(),
        directories: Array.from(subdirs).sort(),
    };
}
