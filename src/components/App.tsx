import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import './App.css'
import { Console } from './Console'
import type { ConsoleHandle } from './Console'
import { Browser } from './Browser'
import { Editor } from './Editor'
import { reducer, resetState, createNode, type AppState } from '../store/store';
import type { StorageClass } from '../types/storage/v1/StorageClass';
import { shell } from '../commands/command';
import { writeFile } from '../commands/helpers/filesystem';
import { ResourceTabs } from './ResourceTabs';
import { useDeploymentController } from '../controllers/useDeploymentController';
import { useReplicaSetController } from '../controllers/useReplicaSetController';
import { useKubelet } from '../controllers/useKubelet';
import { useEndpointsController } from '../controllers/useEndpointsController';
import { useScheduler } from '../controllers/useScheduler';
import { useJobController } from '../controllers/useJobController';
import { useCronJobController } from '../controllers/useCronJobController';
import { useDaemonSetController } from '../controllers/useDaemonSetController'
import { useStatefulSetController } from '../controllers/useStatefulSetController';
import { useServiceController } from '../controllers/useServiceController';
import { usePVCBinder } from '../controllers/usePVCBinder';
import { useLocalPathProvisioner } from '../controllers/useLocalPathProvisioner';
const STORAGE_KEY = 'k8s-apiserver';

function makeInitialState(): AppState {
  const now = new Date().toISOString();
  function makeNode(name: string, internalIP: string, podCIDR: string) {
    return {
      metadata: { uid: crypto.randomUUID(), name, labels: { 'kubernetes.io/hostname': name }, annotations: {}, creationTimestamp: now },
      spec: { unschedulable: false, podCIDR },
      status: {
        conditions: [
          { type: 'Ready' as const,          status: 'True'  as const, lastTransitionTime: now, reason: 'KubeletReady', message: 'kubelet is posting ready status' },
          { type: 'MemoryPressure' as const, status: 'False' as const, lastTransitionTime: now },
          { type: 'DiskPressure'   as const, status: 'False' as const, lastTransitionTime: now },
          { type: 'PIDPressure'    as const, status: 'False' as const, lastTransitionTime: now },
        ],
        capacity:    { cpu: '4', memory: '8Gi', pods: '110' },
        allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
        addresses: [
          { type: 'InternalIP' as const, address: internalIP },
          { type: 'Hostname'   as const, address: name },
        ],
      },
    };
  }
  return {
    Deployments: [],
    ReplicaSets: [],
    DaemonSets: [],
    StatefulSets: [],
    Pods: [],
    Services: [],
    Endpoints: [],
    Nodes: [
      makeNode('node-1', '192.168.0.1', '10.244.0.0/24'),
      makeNode('node-2', '192.168.0.2', '10.244.1.0/24'),
      makeNode('node-3', '192.168.0.3', '10.244.2.0/24'),
    ],
    Jobs: [],
    CronJobs: [],
    ConfigMaps: [],
    Secrets: [],
    PersistentVolumes: [],
    PersistentVolumeClaims: [],
    StorageClasses: [
      {
        metadata: { uid: crypto.randomUUID(), name: 'local-path', labels: {}, annotations: {}, creationTimestamp: now },
        provisioner: 'local-path-provisioner',
        reclaimPolicy: 'Delete',
        volumeBindingMode: 'WaitForFirstConsumer',
        allowVolumeExpansion: true,
      } satisfies StorageClass,
    ],
  };
}

function App() {
  const [store, dispatch] = useReducer(reducer, STORAGE_KEY, (key): AppState => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return { ...makeInitialState(), ...JSON.parse(stored) as AppState };
    } catch { /* ignore — fall back to fresh state */ }
    return makeInitialState();
  });
  const [bottomTab, setBottomTab] = useState<'terminal' | 'browser' | 'editor' | null>('terminal');
  const [editorSession, setEditorSession] = useState<{ id: string; yaml: string; namespace: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [nodeCpu, setNodeCpu] = useState('4');
  const [nodeMemory, setNodeMemory] = useState('8Gi');

  useDeploymentController(store, dispatch);
  useReplicaSetController(store, dispatch);
  useKubelet(store, dispatch);
  useEndpointsController(store, dispatch);
  useScheduler(store, dispatch);
  useJobController(store, dispatch);
  useCronJobController(store, dispatch);
  useDaemonSetController(store, dispatch);
  useStatefulSetController(store, dispatch);
  useServiceController(store, dispatch);
  usePVCBinder(store, dispatch);
  useLocalPathProvisioner(store, dispatch);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* ignore — storage quota exceeded */ }
  }, [store]);

  const storeRef = useRef(store);
  // eslint-disable-next-line react-hooks/refs
  storeRef.current = store;

  const consoleRef = useRef<ConsoleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(content => {
      writeFile(file.name, content);
      setBottomTab('terminal');
      consoleRef.current?.submitCommand(`kubectl apply -f ${file.name}`);
      // Reset so the same file can be re-applied
      e.target.value = '';
    });
  }

  const openEditor = useCallback((yaml: string, ns: string) => {
    setEditorSession({ id: crypto.randomUUID(), yaml, namespace: ns });
    setBottomTab('editor');
  }, []);

  function handleEditorClose() {
    setEditorSession(null);
    setBottomTab(prev => prev === 'editor' ? 'terminal' : prev);
  }

  function handleCommand(inputLine: string): AsyncGenerator<string> {
    return shell(inputLine, dispatch, () => storeRef.current, openEditor);
  }

  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', flexShrink: 0 }}>
          <h1 style={{ margin: '16px 0' }}>k8s.js</h1>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Apply a YAML manifest"
            style={{ background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#d4d4d4', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '4px 12px' }}
          >
            Apply YAML
          </button>
          <button
            onClick={() => { setNodeCpu('4'); setNodeMemory('8Gi'); setShowAddNode(true); }}
            title="Add a new node to the cluster"
            style={{ background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#d4d4d4', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '4px 12px' }}
          >
            Add node
          </button>
          <button
            onClick={() => setShowResetConfirm(true)}
            title="Reset the cluster to its initial state"
            style={{ background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#d4d4d4', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '4px 12px' }}
          >
            Reset cluster
          </button>
        </div>
        <ResourceTabs
          Deployments={store.Deployments}
          DaemonSets={store.DaemonSets}
          StatefulSets={store.StatefulSets}
          ReplicaSets={store.ReplicaSets}
          Pods={store.Pods}
          Services={store.Services}
          Endpoints={store.Endpoints}
          Nodes={store.Nodes}
          Jobs={store.Jobs}
          CronJobs={store.CronJobs}
          ConfigMaps={store.ConfigMaps}
          Secrets={store.Secrets}
          PersistentVolumes={store.PersistentVolumes}
          PersistentVolumeClaims={store.PersistentVolumeClaims}
          onAdd={openEditor}
        />
      </div>
      {/* Bottom panel — always mounted to preserve Console/Browser state */}
      <div style={{ display: bottomTab !== null ? 'flex' : 'none', flexDirection: 'column', flexShrink: 0 }}>
        {/* Tab strip */}
        <div style={{ display: 'flex', alignItems: 'stretch', backgroundColor: '#252526', borderTop: '1px solid #333', flexShrink: 0 }}>
          {(['terminal', 'browser', ...(editorSession ? ['editor' as const] : [])] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setBottomTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: bottomTab === tab ? '2px solid #c084fc' : '2px solid transparent',
                color: bottomTab === tab ? '#e0e0e0' : '#888',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '11px',
                letterSpacing: '0.05em',
                padding: '5px 16px',
              }}
            >
              {tab === 'terminal' ? '⌃ TERMINAL' : tab === 'browser' ? '🌐 BROWSER' : '✎ EDITOR'}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setBottomTab(null)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 10px', fontSize: '14px' }}
            title="Close panel"
          >✕</button>
        </div>
        {/* Panels */}
        <div style={{ display: bottomTab === 'terminal' ? undefined : 'none' }}>
          <Console ref={consoleRef} onCommand={handleCommand} />
        </div>
        <div style={{ display: bottomTab === 'browser' ? undefined : 'none' }}>
          <Browser state={store} />
        </div>
        {editorSession && (
          <div style={{ display: bottomTab === 'editor' ? undefined : 'none' }}>
            <Editor
              key={editorSession.id}
              state={store}
              dispatch={dispatch}
              initialContent={editorSession.yaml}
              namespace={editorSession.namespace}
              onClose={handleEditorClose}
            />
          </div>
        )}
      </div>
      {/* Minimised bar */}
      {bottomTab === null && (
        <div style={{ backgroundColor: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 8px', height: '28px', flexShrink: 0 }}>
          <button
            onClick={() => setBottomTab('terminal')}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '0 12px 0 0' }}
          >
            <span style={{ transform: 'rotate(180deg)', display: 'inline-block', lineHeight: 1 }}>⌃</span> TERMINAL
          </button>
          <button
            onClick={() => setBottomTab('browser')}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '0 8px' }}
          >
            🌐 BROWSER
          </button>
          {editorSession && (
            <button
              onClick={() => setBottomTab('editor')}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '0 8px' }}
            >
              ✎ EDITOR
            </button>
          )}
        </div>
      )}
      {showAddNode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddNode(false); }}>
          <div style={{ background: '#252526', border: '1px solid #555', borderRadius: '6px', padding: '24px 28px', minWidth: '320px', width: '100%', maxWidth: '400px' }}>
            <p style={{ color: '#e0e0e0', margin: '0 0 18px', fontWeight: 600 }}>Add node</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#aaa', fontSize: '12px', fontFamily: 'monospace' }}>
                CPU (cores)
                <input
                  type="text"
                  value={nodeCpu}
                  onChange={e => setNodeCpu(e.target.value)}
                  placeholder="e.g. 4"
                  style={{ background: '#1e1e1e', border: '1px solid #555', borderRadius: '4px', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '13px', padding: '6px 8px', outline: 'none' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#aaa', fontSize: '12px', fontFamily: 'monospace' }}>
                Memory
                <input
                  type="text"
                  value={nodeMemory}
                  onChange={e => setNodeMemory(e.target.value)}
                  placeholder="e.g. 8Gi"
                  style={{ background: '#1e1e1e', border: '1px solid #555', borderRadius: '4px', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '13px', padding: '6px 8px', outline: 'none' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowAddNode(false)}
                style={{ background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#d4d4d4', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '6px 16px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const cpu = nodeCpu.trim() || '4';
                  const memory = nodeMemory.trim() || '8Gi';
                  const existingNums = store.Nodes
                    .map(n => { const m = n.metadata.name.match(/^node-(\d+)$/); return m ? parseInt(m[1], 10) : 0; })
                    .filter(n => n > 0);
                  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : store.Nodes.length + 1;
                  const name = `node-${nextNum}`;
                  const usedIPs = new Set(
                    store.Nodes.flatMap(n => n.status.addresses.filter(a => a.type === 'InternalIP').map(a => a.address)),
                  );
                  let internalIP = '';
                  outer: for (let segment = 0; segment < 256; segment++) {
                    for (let octet = 1; octet <= 254; octet++) {
                      const candidate = `192.168.${segment}.${octet}`;
                      if (!usedIPs.has(candidate)) { internalIP = candidate; break outer; }
                    }
                  }
                  dispatch(createNode(name, { cpu, memory, internalIP }));
                  setShowAddNode(false);
                }}
                style={{ background: '#1d4023', border: '1px solid #4ade80', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '6px 16px' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#252526', border: '1px solid #555', borderRadius: '6px', padding: '24px 28px', maxWidth: '380px', width: '100%' }}>
            <p style={{ color: '#e0e0e0', margin: '0 0 8px', fontWeight: 600 }}>Reset cluster?</p>
            <p style={{ color: '#aaa', margin: '0 0 20px', fontSize: '13px' }}>This will remove all workloads and restore the three default nodes. This cannot be undone.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={{ background: '#3a3a3a', border: '1px solid #555', borderRadius: '4px', color: '#d4d4d4', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '6px 16px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { dispatch(resetState(makeInitialState())); setShowResetConfirm(false); }}
                style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', padding: '6px 16px' }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
