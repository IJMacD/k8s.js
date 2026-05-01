import { describe, it, expect } from 'vitest';
import { readPodFile } from '../commands/helpers/pod-filesystem';
import { createTestState, createTestPod, createTestConfigMap, createTestPV, createTestPVC } from './helpers';

describe('Pod Filesystem - Ephemeral Container Files', () => {
    it('should write and read ephemeral files scoped to container', () => {
        let state = createTestState();
        
        const pod = createTestPod('test-pod', 'default', [
            { name: 'container1' },
            { name: 'container2' },
        ]);
        state.Pods.push(pod);

        // Write to container1
        state = {
            ...state,
            Filesystems: {
                ...state.Filesystems,
                Ephemeral: {
                    ...state.Filesystems.Ephemeral,
                    'default/test-pod/container1': {
                        '/app/file.txt': 'content1',
                    },
                },
            },
        };

        // Read from container1
        const file1 = readPodFile(pod, '/app/file.txt', state, 'container1');
        expect(file1).not.toBeNull();
        expect(file1?.content).toBe('content1');
        expect(file1?.source).toBe('ephemeral');

        // Try to read from container2 - should not find it (isolated)
        const file2 = readPodFile(pod, '/app/file.txt', state, 'container2');
        expect(file2).toBeNull();
    });

    it('should isolate ephemeral files between containers', () => {
        const state = createTestState();
        
        const pod = createTestPod('test-pod', 'default', [
            { name: 'app' },
            { name: 'sidecar' },
        ]);
        state.Pods.push(pod);

        // Write same path to different containers
        state.Filesystems.Ephemeral['default/test-pod/app'] = {
            '/data/config.json': 'app-config',
        };
        state.Filesystems.Ephemeral['default/test-pod/sidecar'] = {
            '/data/config.json': 'sidecar-config',
        };

        // Read from each container
        const appFile = readPodFile(pod, '/data/config.json', state, 'app');
        const sidecarFile = readPodFile(pod, '/data/config.json', state, 'sidecar');

        expect(appFile?.content).toBe('app-config');
        expect(sidecarFile?.content).toBe('sidecar-config');
        // Same path, different content - properly isolated!
    });
});

describe('Pod Filesystem - EmptyDir Volumes', () => {
    it('should share emptyDir files across containers in same pod', () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'shared-pod',
            'default',
            [
                { name: 'writer', volumeMounts: [{ name: 'cache', mountPath: '/cache' }] },
                { name: 'reader', volumeMounts: [{ name: 'cache', mountPath: '/data' }] },
            ],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        state.Pods.push(pod);

        // Write via writer container (use relative paths in filesystem)
        state.Filesystems.EmptyDir['default/shared-pod/cache'] = {
            'shared.txt': 'shared-content',
        };

        // Read from writer container at /cache
        const writerFile = readPodFile(pod, '/cache/shared.txt', state, 'writer');
        expect(writerFile?.content).toBe('shared-content');

        // Read from reader container at /data (different mount path, same volume!)
        const readerFile = readPodFile(pod, '/data/shared.txt', state, 'reader');
        expect(readerFile?.content).toBe('shared-content');
    });

    it('should isolate emptyDir volumes between different pods', () => {
        const state = createTestState();
        
        const pod1 = createTestPod(
            'pod1',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'cache', mountPath: '/cache' }] }],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        const pod2 = createTestPod(
            'pod2',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'cache', mountPath: '/cache' }] }],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        state.Pods.push(pod1, pod2);

        // Write to pod1's emptyDir (relative paths)
        state.Filesystems.EmptyDir['default/pod1/cache'] = {
            'file.txt': 'pod1-data',
        };

        // Write to pod2's emptyDir (relative paths)
        state.Filesystems.EmptyDir['default/pod2/cache'] = {
            'file.txt': 'pod2-data',
        };

        // Each pod sees its own data
        const pod1File = readPodFile(pod1, '/cache/file.txt', state, 'app');
        const pod2File = readPodFile(pod2, '/cache/file.txt', state, 'app');

        expect(pod1File?.content).toBe('pod1-data');
        expect(pod2File?.content).toBe('pod2-data');
        // Different pods, different emptyDir instances!
    });

    it('should support multiple emptyDir volumes in same pod', () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'multi-vol-pod',
            'default',
            [
                {
                    name: 'app',
                    volumeMounts: [
                        { name: 'cache1', mountPath: '/cache1' },
                        { name: 'cache2', mountPath: '/cache2' },
                    ],
                },
            ],
            [
                { name: 'cache1', type: 'emptyDir' },
                { name: 'cache2', type: 'emptyDir' },
            ]
        );
        state.Pods.push(pod);

        // Write to different volumes (relative paths)
        state.Filesystems.EmptyDir['default/multi-vol-pod/cache1'] = {
            'data.txt': 'cache1-data',
        };
        state.Filesystems.EmptyDir['default/multi-vol-pod/cache2'] = {
            'data.txt': 'cache2-data',
        };

        // Read from each volume
        const cache1File = readPodFile(pod, '/cache1/data.txt', state, 'app');
        const cache2File = readPodFile(pod, '/cache2/data.txt', state, 'app');

        expect(cache1File?.content).toBe('cache1-data');
        expect(cache2File?.content).toBe('cache2-data');
    });
});

describe('Pod Filesystem - PVC/PV Volumes', () => {
    it('should share PV files across multiple pods mounting same PVC', () => {
        const state = createTestState();
        
        const pv = createTestPV('pv-shared', '1Gi');
        const pvc = createTestPVC('shared-pvc', 'default', 'pv-shared');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod1 = createTestPod(
            'writer-pod',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'shared-pvc' }]
        );
        const pod2 = createTestPod(
            'reader-pod',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'storage', mountPath: '/mnt/storage' }] }],
            [{ name: 'storage', type: 'pvc', claimName: 'shared-pvc' }]
        );
        state.Pods.push(pod1, pod2);

        // Write to PV (relative paths within PV)
        state.Filesystems.PVFilesystems['pv-shared'] = {
            'shared-file.txt': 'persistent-data',
        };

        // Read from pod1 at /data
        const pod1File = readPodFile(pod1, '/data/shared-file.txt', state, 'app');
        expect(pod1File?.content).toBe('persistent-data');

        // Read from pod2 at /mnt/storage (different mount path, same PV!)
        const pod2File = readPodFile(pod2, '/mnt/storage/shared-file.txt', state, 'app');
        expect(pod2File?.content).toBe('persistent-data');
    });

    it('should share PV files across containers in same pod', () => {
        const state = createTestState();
        
        const pv = createTestPV('pv-test', '1Gi');
        const pvc = createTestPVC('test-pvc', 'default', 'pv-test');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'multi-container-pod',
            'default',
            [
                { name: 'app', volumeMounts: [{ name: 'vol', mountPath: '/app/data' }] },
                { name: 'backup', volumeMounts: [{ name: 'vol', mountPath: '/backup' }] },
            ],
            [{ name: 'vol', type: 'pvc', claimName: 'test-pvc' }]
        );
        state.Pods.push(pod);

        // Write to PV (relative paths)
        state.Filesystems.PVFilesystems['pv-test'] = {
            'important.txt': 'important-data',
        };

        // Both containers see the same data
        const appFile = readPodFile(pod, '/app/data/important.txt', state, 'app');
        const backupFile = readPodFile(pod, '/backup/important.txt', state, 'backup');

        expect(appFile?.content).toBe('important-data');
        expect(backupFile?.content).toBe('important-data');
    });

    it('should isolate PVs with different PVCs', () => {
        const state = createTestState();
        
        const pv1 = createTestPV('pv-1', '1Gi');
        const pv2 = createTestPV('pv-2', '1Gi');
        const pvc1 = createTestPVC('pvc-1', 'default', 'pv-1');
        const pvc2 = createTestPVC('pvc-2', 'default', 'pv-2');
        state.PersistentVolumes.push(pv1, pv2);
        state.PersistentVolumeClaims.push(pvc1, pvc2);

        const pod1 = createTestPod(
            'pod1',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'vol', mountPath: '/data' }] }],
            [{ name: 'vol', type: 'pvc', claimName: 'pvc-1' }]
        );
        const pod2 = createTestPod(
            'pod2',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'vol', mountPath: '/data' }] }],
            [{ name: 'vol', type: 'pvc', claimName: 'pvc-2' }]
        );
        state.Pods.push(pod1, pod2);

        // Write to different PVs (relative paths)
        state.Filesystems.PVFilesystems['pv-1'] = {
            'file.txt': 'pv1-data',
        };
        state.Filesystems.PVFilesystems['pv-2'] = {
            'file.txt': 'pv2-data',
        };

        // Each pod sees its own PV
        const pod1File = readPodFile(pod1, '/data/file.txt', state, 'app');
        const pod2File = readPodFile(pod2, '/data/file.txt', state, 'app');

        expect(pod1File?.content).toBe('pv1-data');
        expect(pod2File?.content).toBe('pv2-data');
    });
});

describe('Pod Filesystem - ConfigMap Volumes', () => {
    it('should read ConfigMap files from multiple containers', () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('app-config', 'default', {
            'app.conf': 'setting=value',
            'database.conf': 'host=localhost',
        });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'config-pod',
            'default',
            [
                { name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] },
                { name: 'sidecar', volumeMounts: [{ name: 'config', mountPath: '/config' }] },
            ],
            [{ name: 'config', type: 'configMap', configMapName: 'app-config' }]
        );
        state.Pods.push(pod);

        // Both containers can read ConfigMap
        const appFile = readPodFile(pod, '/etc/config/app.conf', state, 'app');
        const sidecarFile = readPodFile(pod, '/config/app.conf', state, 'sidecar');

        expect(appFile?.content).toBe('setting=value');
        expect(appFile?.source).toBe('configMap');
        expect(sidecarFile?.content).toBe('setting=value');
        expect(sidecarFile?.source).toBe('configMap');
    });
});

describe('Pod Filesystem - Mixed Volume Types', () => {
    it('should handle pod with ConfigMap, emptyDir, and ephemeral files', () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'app.conf': 'readonly-config' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'mixed-pod',
            'default',
            [
                {
                    name: 'app',
                    volumeMounts: [
                        { name: 'config', mountPath: '/etc/app' },
                        { name: 'cache', mountPath: '/cache' },
                    ],
                },
            ],
            [
                { name: 'config', type: 'configMap', configMapName: 'config' },
                { name: 'cache', type: 'emptyDir' },
            ]
        );
        state.Pods.push(pod);

        // Add emptyDir file (relative path)
        state.Filesystems.EmptyDir['default/mixed-pod/cache'] = {
            'temp.txt': 'temp-data',
        };

        // Add ephemeral file
        state.Filesystems.Ephemeral['default/mixed-pod/app'] = {
            '/runtime/state.json': '{"status":"running"}',
        };

        // Read from all sources
        const configFile = readPodFile(pod, '/etc/app/app.conf', state, 'app');
        const cacheFile = readPodFile(pod, '/cache/temp.txt', state, 'app');
        const ephemeralFile = readPodFile(pod, '/runtime/state.json', state, 'app');

        expect(configFile?.content).toBe('readonly-config');
        expect(configFile?.source).toBe('configMap');
        expect(cacheFile?.content).toBe('temp-data');
        expect(cacheFile?.source).toBe('emptyDir');
        expect(ephemeralFile?.content).toBe('{"status":"running"}');
        expect(ephemeralFile?.source).toBe('ephemeral');
    });

    it('should handle pod with PVC and emptyDir sharing between containers', () => {
        const state = createTestState();
        
        const pv = createTestPV('pv-1', '1Gi');
        const pvc = createTestPVC('data-pvc', 'default', 'pv-1');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'complex-pod',
            'default',
            [
                {
                    name: 'app',
                    volumeMounts: [
                        { name: 'persistent', mountPath: '/data' },
                        { name: 'shared-cache', mountPath: '/cache' },
                    ],
                },
                {
                    name: 'backup',
                    volumeMounts: [
                        { name: 'persistent', mountPath: '/backup/data' },
                        { name: 'shared-cache', mountPath: '/tmp/cache' },
                    ],
                },
            ],
            [
                { name: 'persistent', type: 'pvc', claimName: 'data-pvc' },
                { name: 'shared-cache', type: 'emptyDir' },
            ]
        );
        state.Pods.push(pod);

        // Add PV data (relative path)
        state.Filesystems.PVFilesystems['pv-1'] = {
            'database.db': 'persistent-db-data',
        };

        // Add emptyDir data (relative path)
        state.Filesystems.EmptyDir['default/complex-pod/shared-cache'] = {
            'cache.tmp': 'cached-data',
        };

        // App container reads
        const appPvFile = readPodFile(pod, '/data/database.db', state, 'app');
        const appCacheFile = readPodFile(pod, '/cache/cache.tmp', state, 'app');

        // Backup container reads (different paths, same data!)
        const backupPvFile = readPodFile(pod, '/backup/data/database.db', state, 'backup');
        const backupCacheFile = readPodFile(pod, '/tmp/cache/cache.tmp', state, 'backup');

        // PV data shared
        expect(appPvFile?.content).toBe('persistent-db-data');
        expect(backupPvFile?.content).toBe('persistent-db-data');

        // EmptyDir data shared
        expect(appCacheFile?.content).toBe('cached-data');
        expect(backupCacheFile?.content).toBe('cached-data');
    });
});
