import { describe, it, expect, beforeEach } from 'vitest';
import { kubectlCp } from '../commands/kubectl-cp';
import { reducer } from '../store/store';
import { createTestState, createTestPod, createTestConfigMap, createTestPV, createTestPVC } from './helpers';
import { writeFile, readFile } from '../commands/helpers/filesystem';
import type { Action, AppState } from '../store/store';

/**
 * Helper to execute kubectl cp and collect all output
 */
async function execKubectlCp(
    args: string[],
    state: AppState,
): Promise<{ output: string[]; finalState: AppState }> {
    const output: string[] = [];
    let currentState = state;
    
    // Mock dispatcher that applies actions
    const dispatch = (action: Action) => {
        currentState = reducer(currentState, action);
    };

    // Execute kubectl cp and collect output
    const generator = kubectlCp(args, 'default', currentState, dispatch);
    for await (const line of generator) {
        output.push(line);
    }

    return { output, finalState: currentState };
}

describe('kubectl cp - Pod to Local', () => {
    beforeEach(() => {
        // Clear filesystem before each test
        // Note: In real implementation, filesystem is in-memory per test
    });

    it('should copy file from ConfigMap volume to local', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('web-content', 'default', {
            'index.html': '<html>Hello World</html>',
        });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'webserver',
            'default',
            [{ name: 'nginx', volumeMounts: [{ name: 'content', mountPath: '/usr/share/nginx/html' }] }],
            [{ name: 'content', type: 'configMap', configMapName: 'web-content' }]
        );
        state.Pods.push(pod);

        // Execute: kubectl cp webserver:/usr/share/nginx/html/index.html ./downloaded.html
        const { output } = await execKubectlCp(
            ['cp', 'webserver:/usr/share/nginx/html/index.html', './downloaded.html'],
            state
        );

        expect(output).toHaveLength(1);
        expect(output[0]).toContain('Copied webserver:/usr/share/nginx/html/index.html to ./downloaded.html');
        expect(output[0]).toContain('source: configMap');

        // Verify file was written to local filesystem
        const content = readFile('./downloaded.html');
        expect(content).toBe('<html>Hello World</html>');
    });

    it('should copy file from PVC volume to local', async () => {
        const state = createTestState();
        
        const pv = createTestPV('data-pv', '1Gi');
        const pvc = createTestPVC('app-data', 'default', 'data-pv');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        // Pre-populate PV with data
        state.Filesystems.PVFilesystems['data-pv'] = {
            'database.db': 'database-content',
        };

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'app-data' }]
        );
        state.Pods.push(pod);

        const { output } = await execKubectlCp(
            ['cp', 'app:/data/database.db', './backup.db'],
            state
        );

        expect(output[0]).toContain('Copied app:/data/database.db to ./backup.db');
        
        const content = readFile('./backup.db');
        expect(content).toBe('database-content');
    });

    it('should copy file from emptyDir volume to local', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'cache-pod',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'cache', mountPath: '/cache' }] }],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        state.Pods.push(pod);

        // Pre-populate emptyDir
        state.Filesystems.EmptyDir['default/cache-pod/cache'] = {
            'temp.txt': 'cached-data',
        };

        const { output } = await execKubectlCp(
            ['cp', 'cache-pod:/cache/temp.txt', './temp.txt'],
            state
        );

        expect(output[0]).toContain('Copied cache-pod:/cache/temp.txt to ./temp.txt');
        
        const content = readFile('./temp.txt');
        expect(content).toBe('cached-data');
    });

    it('should copy file from ephemeral filesystem to local', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app' }]
        );
        state.Pods.push(pod);

        // Pre-populate ephemeral filesystem
        state.Filesystems.Ephemeral['default/app/app'] = {
            '/tmp/runtime.log': 'log-content',
        };

        const { output } = await execKubectlCp(
            ['cp', 'app:/tmp/runtime.log', './runtime.log'],
            state
        );

        expect(output[0]).toContain('Copied app:/tmp/runtime.log to ./runtime.log');
        
        const content = readFile('./runtime.log');
        expect(content).toBe('log-content');
    });

    it('should specify container with -c flag', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'app.conf': 'config-data' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'multi-container',
            'default',
            [
                { name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] },
                { name: 'sidecar', volumeMounts: [{ name: 'config', mountPath: '/config' }] },
            ],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const { output } = await execKubectlCp(
            ['cp', 'multi-container:/config/app.conf', './app.conf', '-c', 'sidecar'],
            state
        );

        expect(output[0]).toContain('Copied multi-container:/config/app.conf to ./app.conf');
        
        const content = readFile('./app.conf');
        expect(content).toBe('config-data');
    });
});

describe('kubectl cp - Local to Pod', () => {
    beforeEach(() => {
        // Create a test file in local filesystem
        writeFile('./test-upload.txt', 'upload-content');
    });

    it('should copy file from local to PVC volume', async () => {
        const state = createTestState();
        
        const pv = createTestPV('upload-pv', '1Gi');
        const pvc = createTestPVC('upload-pvc', 'default', 'upload-pv');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'uploader',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'upload-pvc' }]
        );
        state.Pods.push(pod);

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-upload.txt', 'uploader:/data/uploaded.txt'],
            state
        );

        expect(output[0]).toContain('Copied ./test-upload.txt to uploader:/data/uploaded.txt');
        expect(output[0]).toContain('persistent volume: upload-pv');

        // Verify file was written to PV
        expect(finalState.Filesystems.PVFilesystems['upload-pv']).toBeDefined();
        expect(finalState.Filesystems.PVFilesystems['upload-pv']['uploaded.txt']).toBe('upload-content');
    });

    it('should copy file from local to emptyDir volume', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'cache-writer',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'cache', mountPath: '/cache' }] }],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        state.Pods.push(pod);

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-upload.txt', 'cache-writer:/cache/cached.txt'],
            state
        );

        expect(output[0]).toContain('Copied ./test-upload.txt to cache-writer:/cache/cached.txt');
        expect(output[0]).toContain('emptyDir volume: cache');

        // Verify file was written to emptyDir
        expect(finalState.Filesystems.EmptyDir['default/cache-writer/cache']).toBeDefined();
        expect(finalState.Filesystems.EmptyDir['default/cache-writer/cache']['cached.txt']).toBe('upload-content');
    });

    it('should copy file from local to ephemeral filesystem', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app' }]
        );
        state.Pods.push(pod);

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-upload.txt', 'app:/tmp/uploaded.txt'],
            state
        );

        expect(output[0]).toContain('Copied ./test-upload.txt to app:/tmp/uploaded.txt');
        expect(output[0]).toContain('ephemeral filesystem');

        // Verify file was written to ephemeral
        expect(finalState.Filesystems.Ephemeral['default/app/app']).toBeDefined();
        expect(finalState.Filesystems.Ephemeral['default/app/app']['/tmp/uploaded.txt']).toBe('upload-content');
    });

    it('should default to first container when -c not specified', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'multi',
            'default',
            [
                { name: 'primary' },
                { name: 'secondary' },
            ]
        );
        state.Pods.push(pod);

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-upload.txt', 'multi:/tmp/file.txt'],
            state
        );

        expect(output[0]).toContain('defaulted to container "primary"');
        expect(finalState.Filesystems.Ephemeral['default/multi/primary']).toBeDefined();
        expect(finalState.Filesystems.Ephemeral['default/multi/primary']['/tmp/file.txt']).toBe('upload-content');
    });

    it('should use specified container with -c flag', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'multi',
            'default',
            [
                { name: 'primary' },
                { name: 'secondary' },
            ]
        );
        state.Pods.push(pod);

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-upload.txt', 'multi:/tmp/file.txt', '-c', 'secondary'],
            state
        );

        expect(output[0]).toContain('Copied ./test-upload.txt to multi:/tmp/file.txt');
        expect(output[0]).not.toContain('defaulted');
        expect(finalState.Filesystems.Ephemeral['default/multi/secondary']).toBeDefined();
        expect(finalState.Filesystems.Ephemeral['default/multi/secondary']['/tmp/file.txt']).toBe('upload-content');
    });
});

describe('kubectl cp - Read-Only Protection', () => {
    beforeEach(() => {
        writeFile('./malicious.txt', 'hacked-content');
    });

    it('should reject writes to ConfigMap mounts', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'app.conf': 'original' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] }],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', './malicious.txt', 'app:/etc/config/app.conf'], state)
        ).rejects.toThrow('volume mount is read-only');
    });

    it('should reject writes to Secret mounts', async () => {
        const state = createTestState();
        
        state.Secrets.push({
            metadata: {
                name: 'creds',
                namespace: 'default',
                uid: crypto.randomUUID(),
                labels: {},
                annotations: {},
                creationTimestamp: new Date().toISOString(),
            },
            type: 'Opaque',
            data: { 'token': 'secret-123' },
        });

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'secret', mountPath: '/etc/secrets' }] }],
            [{ name: 'secret', type: 'secret', secretName: 'creds' }]
        );
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', './malicious.txt', 'app:/etc/secrets/token'], state)
        ).rejects.toThrow('volume mount is read-only');
    });

    it('should reject writes to emptyDir with readOnly flag', async () => {
        const state = createTestState();
        
        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'cache', mountPath: '/cache', readOnly: true }] }],
            [{ name: 'cache', type: 'emptyDir' }]
        );
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', './malicious.txt', 'app:/cache/file.txt'], state)
        ).rejects.toThrow('volume mount is read-only');
    });

    it('should reject writes to PVC with readOnly flag', async () => {
        const state = createTestState();
        
        const pv = createTestPV('readonly-pv', '1Gi');
        const pvc = createTestPVC('readonly-pvc', 'default', 'readonly-pv');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data', readOnly: true }] }],
            [{ name: 'data', type: 'pvc', claimName: 'readonly-pvc' }]
        );
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', './malicious.txt', 'app:/data/file.txt'], state)
        ).rejects.toThrow('volume mount is read-only');
    });
});

describe('kubectl cp - Error Handling', () => {
    it('should error when pod not found', async () => {
        const state = createTestState();

        await expect(
            execKubectlCp(['cp', 'nonexistent:/file.txt', './file.txt'], state)
        ).rejects.toThrow('pods "nonexistent" not found');
    });

    it('should error when pod is not running', async () => {
        const state = createTestState();
        
        const pod = createTestPod('pending-pod', 'default', [{ name: 'app' }]);
        pod.status.phase = 'Pending';
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', 'pending-pod:/file.txt', './file.txt'], state)
        ).rejects.toThrow('is not running');
    });

    it('should error when container not found', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'main' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', 'app:/file.txt', './file.txt', '-c', 'nonexistent'], state)
        ).rejects.toThrow('container "nonexistent" not found');
    });

    it('should error when source file not found in pod', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', 'app:/nonexistent.txt', './file.txt'], state)
        ).rejects.toThrow('not found');
    });

    it('should error when local source file not found', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlCp(['cp', './nonexistent.txt', 'app:/file.txt'], state)
        ).rejects.toThrow('No such file or directory');
    });

    it('should error when missing arguments', async () => {
        const state = createTestState();

        await expect(
            execKubectlCp(['cp', 'pod:/file.txt'], state)
        ).rejects.toThrow('requires source and destination');
    });

    it('should error when copying between pods', async () => {
        const state = createTestState();

        await expect(
            execKubectlCp(['cp', 'pod1:/file.txt', 'pod2:/file.txt'], state)
        ).rejects.toThrow('copying between pods is not supported');
    });
});

describe('kubectl cp - Dynamic PVC Binding', () => {
    it('should work with PVC bound by usePVCBinder controller', async () => {
        const state = createTestState();

        // Create unbound PVC (no volumeName set initially)
        const pv = createTestPV('auto-pv', '1Gi');
        const pvc = createTestPVC('auto-pvc', 'default');
        // PVC initially has no volumeName - will be set by binding
        expect(pvc.spec.volumeName).toBeUndefined();

        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'auto-pvc' }]
        );
        state.Pods.push(pod);

        // Simulate binding by calling bindPVC action
        const bindAction = {
            type: 'BIND_PVC' as const,
            payload: { pvcName: 'auto-pvc', pvcNamespace: 'default', pvName: 'auto-pv' }
        };

        // Import reducer to apply action
        const { reducer } = await import('../store/store');
        const boundState = reducer(state, bindAction);

        // Verify binding set spec.volumeName
        const boundPVC = boundState.PersistentVolumeClaims.find(
            p => p.metadata.name === 'auto-pvc'
        );
        expect(boundPVC?.spec.volumeName).toBe('auto-pv');
        expect(boundPVC?.status.phase).toBe('Bound');

        // Now kubectl cp should work
        writeFile('./test-data.txt', 'test-content');

        const { output, finalState } = await execKubectlCp(
            ['cp', './test-data.txt', 'app:/data/file.txt'],
            boundState
        );

        expect(output[0]).toContain('persistent volume: auto-pv');
        expect(finalState.Filesystems.PVFilesystems['auto-pv']['file.txt']).toBe('test-content');
    });
});

describe('kubectl cp - Round-Trip', () => {
    it('should preserve content through local -> pod -> local round-trip', async () => {
        const state = createTestState();
        
        const pv = createTestPV('roundtrip-pv', '1Gi');
        const pvc = createTestPVC('roundtrip-pvc', 'default', 'roundtrip-pv');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        const pod = createTestPod(
            'storage',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'roundtrip-pvc' }]
        );
        state.Pods.push(pod);

        // Original content
        const originalContent = 'Round-trip test content';
        writeFile('./original.txt', originalContent);

        // Upload to pod
        const { finalState: stateAfterUpload } = await execKubectlCp(
            ['cp', './original.txt', 'storage:/data/file.txt'],
            state
        );

        // Download from pod
        await execKubectlCp(
            ['cp', 'storage:/data/file.txt', './downloaded.txt'],
            stateAfterUpload
        );

        // Verify content preserved
        const downloadedContent = readFile('./downloaded.txt');
        expect(downloadedContent).toBe(originalContent);
    });
});
