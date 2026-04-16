import { useCallback, useReducer, useRef, useState } from 'react';
import './App.css'
import { Console } from './Console'
import type { ConsoleHandle } from './Console'
import { Browser } from './Browser'
import { Editor } from './Editor'
import { reducer, type Action, type AppState } from '../store/store';
import { command } from '../commands/command';
import { stageUpload } from '../commands/kubectl-apply';
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

const initialState: AppState = {
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
}

function App() {
  const [store, dispatch] = useReducer<AppState, [action: Action]>(reducer, initialState)
  const [bottomTab, setBottomTab] = useState<'terminal' | 'browser' | 'editor' | null>('terminal');
  const [editorSession, setEditorSession] = useState<{ id: string; yaml: string; namespace: string } | null>(null);

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

  const storeRef = useRef(store);
  // eslint-disable-next-line react-hooks/refs
  storeRef.current = store;

  const consoleRef = useRef<ConsoleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(content => {
      stageUpload(file.name, content);
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
    return command(inputLine, dispatch, () => storeRef.current, openEditor);
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px' }}>
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
    </>
  )
}

export default App
