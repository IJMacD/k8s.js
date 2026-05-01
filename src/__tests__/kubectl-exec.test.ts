import { describe, it, expect } from 'vitest';
import { kubectlExec } from '../commands/kubectl-exec';
import { createTestState, createTestPod, createTestConfigMap, createTestPV, createTestPVC } from './helpers';
import type { AppState } from '../store/store';

/**
 * Helper to execute kubectl exec and collect all output
 */
async function execKubectlExec(
    args: string[],
    state: AppState,
): Promise<string[]> {
    const output: string[] = [];
    const generator = kubectlExec(args, 'default', state);
    for await (const line of generator) {
        output.push(line);
    }
    return output;
}

describe('kubectl exec - Basic Commands', () => {
    it('should execute pwd command', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'pwd'], state);

        expect(output).toEqual(['/']);
    });

    it('should execute echo command', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'echo', 'hello', 'world'], state);

        expect(output).toEqual(['hello world']);
    });

    it('should execute whoami command', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'whoami'], state);

        expect(output).toEqual(['root']);
    });
});

describe('kubectl exec - ls Command', () => {
    it('should list files in ConfigMap volume', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', {
            'app.conf': 'config-content',
            'database.yml': 'db-config',
        });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] }],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'ls', '/etc/config'], state);

        expect(output).toContain('app.conf');
        expect(output).toContain('database.yml');
    });

    it('should list root directory showing mount points', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'file.txt': 'content' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] }],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'ls', '/'], state);

        // Standard ls behavior - no trailing slashes
        expect(output.some(line => line === 'etc')).toBe(true);
    });

    it('should list files from multiple volume types', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'app.conf': 'content' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [
                {
                    name: 'app',
                    volumeMounts: [
                        { name: 'config', mountPath: '/etc/config' },
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

        // Add file to emptyDir
        state.Filesystems.EmptyDir['default/app/cache'] = {
            'temp.txt': 'cached-data',
        };

        const output = await execKubectlExec(['exec', 'app', '--', 'ls', '/'], state);

        // Standard ls behavior - no trailing slashes
        expect(output.some(line => line === 'etc')).toBe(true);
        expect(output.some(line => line === 'cache')).toBe(true);
    });

    it('should error when listing non-existent directory', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', '--', 'ls', '/nonexistent'], state)
        ).rejects.toThrow('No such file or directory');
    });
});

describe('kubectl exec - cat Command', () => {
    it('should read file from ConfigMap', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', {
            'app.conf': 'server_port=8080\ndatabase_url=postgres://localhost',
        });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] }],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'cat', '/etc/config/app.conf'], state);

        expect(output).toEqual(['server_port=8080\ndatabase_url=postgres://localhost']);
    });

    it('should read file from PVC', async () => {
        const state = createTestState();
        
        const pv = createTestPV('pv', '1Gi');
        const pvc = createTestPVC('pvc', 'default', 'pv');
        state.PersistentVolumes.push(pv);
        state.PersistentVolumeClaims.push(pvc);

        state.Filesystems.PVFilesystems['pv'] = {
            'data.txt': 'persistent-data',
        };

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'data', mountPath: '/data' }] }],
            [{ name: 'data', type: 'pvc', claimName: 'pvc' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'cat', '/data/data.txt'], state);

        expect(output).toEqual(['persistent-data']);
    });

    it('should read file from ephemeral filesystem', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        state.Filesystems.Ephemeral['default/app/app'] = {
            '/tmp/runtime.log': 'log-content',
        };

        const output = await execKubectlExec(['exec', 'app', '--', 'cat', '/tmp/runtime.log'], state);

        expect(output).toEqual(['log-content']);
    });

    it('should read multiple files', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', {
            'file1.txt': 'content1',
            'file2.txt': 'content2',
        });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'app',
            'default',
            [{ name: 'app', volumeMounts: [{ name: 'config', mountPath: '/etc' }] }],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(
            ['exec', 'app', '--', 'cat', '/etc/file1.txt', '/etc/file2.txt'],
            state
        );

        expect(output).toEqual(['content1', 'content2']);
    });

    it('should error when file not found', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', '--', 'cat', '/nonexistent.txt'], state)
        ).rejects.toThrow('No such file or directory');
    });
});

describe('kubectl exec - env Command', () => {
    it('should show environment variables', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [
            {
                name: 'app',
                volumeMounts: [],
            },
        ]);
        
        // Add env vars to container
        pod.spec.containers[0].env = [
            { name: 'DATABASE_URL', value: 'postgres://localhost' },
            { name: 'API_KEY', value: 'secret-key' },
        ];
        
        state.Pods.push(pod);

        const output = await execKubectlExec(['exec', 'app', '--', 'env'], state);

        expect(output.some(line => line === 'API_KEY=secret-key')).toBe(true);
        expect(output.some(line => line === 'DATABASE_URL=postgres://localhost')).toBe(true);
    });
});

describe('kubectl exec - Container Selection', () => {
    it('should default to first container', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'file.txt': 'content' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'multi',
            'default',
            [
                { name: 'primary', volumeMounts: [{ name: 'config', mountPath: '/etc/config' }] },
                { name: 'sidecar' },
            ],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        // Without -c flag, should use primary container
        const output = await execKubectlExec(['exec', 'multi', '--', 'ls', '/etc/config'], state);

        expect(output).toContain('file.txt');
    });

    it('should use specified container with -c flag', async () => {
        const state = createTestState();
        
        const cm = createTestConfigMap('config', 'default', { 'file.txt': 'content' });
        state.ConfigMaps.push(cm);

        const pod = createTestPod(
            'multi',
            'default',
            [
                { name: 'primary' },
                { name: 'sidecar', volumeMounts: [{ name: 'config', mountPath: '/config' }] },
            ],
            [{ name: 'config', type: 'configMap', configMapName: 'config' }]
        );
        state.Pods.push(pod);

        const output = await execKubectlExec(
            ['exec', 'multi', '-c', 'sidecar', '--', 'ls', '/config'],
            state
        );

        expect(output).toContain('file.txt');
    });
});

describe('kubectl exec - Error Handling', () => {
    it('should error when pod not found', async () => {
        const state = createTestState();

        await expect(
            execKubectlExec(['exec', 'nonexistent', '--', 'ls'], state)
        ).rejects.toThrow('pods "nonexistent" not found');
    });

    it('should error when pod not running', async () => {
        const state = createTestState();
        
        const pod = createTestPod('pending-pod', 'default', [{ name: 'app' }]);
        pod.status.phase = 'Pending';
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'pending-pod', '--', 'ls'], state)
        ).rejects.toThrow('is not running');
    });

    it('should error when container not found', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'main' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', '-c', 'nonexistent', '--', 'ls'], state)
        ).rejects.toThrow('container "nonexistent" not found');
    });

    it('should error when no -- separator', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', 'ls'], state)
        ).rejects.toThrow('requires -- before command');
    });

    it('should error when no command specified', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', '--'], state)
        ).rejects.toThrow('no command specified');
    });

    it('should error for unsupported command', async () => {
        const state = createTestState();
        
        const pod = createTestPod('app', 'default', [{ name: 'app' }]);
        state.Pods.push(pod);

        await expect(
            execKubectlExec(['exec', 'app', '--', 'rm', '-rf', '/'], state)
        ).rejects.toThrow('command not implemented: rm');
    });
});
