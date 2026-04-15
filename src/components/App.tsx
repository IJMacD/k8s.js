import { useReducer, useRef, useState } from 'react';
import './App.css'
import { Console } from './Console'
import { Browser } from './Browser'
import { reducer, type Action, type AppState } from '../store/store';
import { command } from '../commands/command';
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
  const [bottomTab, setBottomTab] = useState<'terminal' | 'browser' | null>('terminal');

  useDeploymentController(store, dispatch);
  useReplicaSetController(store, dispatch);
  useKubelet(store, dispatch);
  useEndpointsController(store, dispatch);
  useScheduler(store, dispatch);
  useJobController(store, dispatch);
  useCronJobController(store, dispatch);
  useDaemonSetController(store, dispatch);
  useStatefulSetController(store, dispatch);

  const storeRef = useRef(store);
  // eslint-disable-next-line react-hooks/refs
  storeRef.current = store;

  function handleCommand(inputLine: string): AsyncGenerator<string> {
    return command(inputLine, dispatch, () => storeRef.current);
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <h1>k8s.js</h1>
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
          {(['terminal', 'browser'] as const).map(tab => (
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
              {tab === 'terminal' ? '⌃ TERMINAL' : '🌐 BROWSER'}
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
          <Console onCommand={handleCommand} />
        </div>
        <div style={{ display: bottomTab === 'browser' ? undefined : 'none' }}>
          <Browser state={store} />
        </div>
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
        </div>
      )}
    </>
  )
}

export default App
