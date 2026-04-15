import { useReducer, useState } from 'react';
import './App.css'
import { Console } from './Console'
import { reducer, type Action, type AppState } from '../store/store';
import { command } from '../commands/command';
import { ResourceTabs } from './ResourceTabs';
import { useDeploymentController } from '../controllers/useDeploymentController';
import { useReplicaSetController } from '../controllers/useReplicaSetController';
import { useKubelet } from '../controllers/useKubelet';
import { useStatusController } from '../controllers/useStatusController';
import { useEndpointsController } from '../controllers/useEndpointsController';
import { useScheduler } from '../controllers/useScheduler';
import { useJobController } from '../controllers/useJobController';
import { useCronJobController } from '../controllers/useCronJobController';
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
  const [consoleOpen, setConsoleOpen] = useState(true);

  useDeploymentController(store, dispatch);
  useReplicaSetController(store, dispatch);
  useKubelet(store, dispatch);
  useStatusController(store, dispatch);
  useEndpointsController(store, dispatch);
  useScheduler(store, dispatch);
  useJobController(store, dispatch);
  useCronJobController(store, dispatch);

  function handleCommand(inputLine: string): Promise<string> {
    return command(inputLine, dispatch, store);
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <h1>k8s.js</h1>
        <ResourceTabs
          Deployments={store.Deployments}
          ReplicaSets={store.ReplicaSets}
          Pods={store.Pods}
          Services={store.Services}
          Endpoints={store.Endpoints}
          Nodes={store.Nodes}
          Jobs={store.Jobs}
          CronJobs={store.CronJobs}
        />
      </div>
      <div style={{ display: consoleOpen ? undefined : 'none' }}>
        <Console onCommand={handleCommand} onDismiss={() => setConsoleOpen(false)} />
      </div>
      {!consoleOpen && (
        <div style={{ backgroundColor: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 8px', height: '28px', flexShrink: 0 }}>
          <button
            onClick={() => setConsoleOpen(true)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Restore terminal"
            aria-label="Restore terminal"
          >
            <span style={{ transform: 'rotate(180deg)', display: 'inline-block', lineHeight: 1 }}>⌃</span>
            TERMINAL
          </button>
        </div>
      )}
    </>
  )
}

export default App
