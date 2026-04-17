import { useEffect, useState } from 'react';
import type { AppState } from '../store/store';
import type { Pod } from '../types/v1/Pod';
import './ResourceTabs.css';

/** Coloured squares representing each container's state in a Pod row. */
function ContainerSquares({ pod }: { pod: Pod }) {
  const initContainers = pod.spec.initContainers ?? [];
  const appContainers  = pod.spec.containers;

  // Derive per-container colour from containerStatuses / initContainerStatuses.
  // green  = running + ready
  // orange = running but not yet ready
  // grey   = not running (waiting, terminated, or no status yet)
  const squareColor = (name: string, isInit: boolean): string => {
    const statuses = isInit
      ? (pod.status.initContainerStatuses ?? [])
      : (pod.status.containerStatuses     ?? []);
    const s = statuses.find(cs => cs.name === name);
    if (!s) return '#888'; // no status yet → grey
    if (s.state.running) {
      // Init containers have ready=false while running (real k8s semantics) — still show as green
      if (isInit) return '#22c55e';
      return s.ready ? '#22c55e' : '#f97316'; // app: green if ready, orange if not
    }
    if (s.state.terminated) {
      // exitCode 0 = completed successfully → dark green
      // exitCode non-zero = failed → red
      if (s.state.terminated.exitCode === 0) return '#15803d';
      return '#ef4444';
    }
    return '#888'; // waiting → grey
  };

  // Fallback for pods that have no containerStatuses at all: derive from phase
  const phaseColor = (): string => {
    switch (pod.status.phase) {
      case 'Running':   return '#22c55e';
      case 'Succeeded': return '#15803d';
      case 'Failed':    return '#ef4444';
      default:          return '#888';
    }
  };

  const hasStatuses = (pod.status.containerStatuses?.length ?? 0) > 0 ||
                      (pod.status.initContainerStatuses?.length ?? 0) > 0;

  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {initContainers.map(ic => (
        <span
          key={`init-${ic.name}`}
          title={`init: ${ic.name}`}
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '2px',
            background: hasStatuses ? squareColor(ic.name, true) : '#888',
            opacity: 0.7,
          }}
        />
      ))}
      {initContainers.length > 0 && (
        <span style={{ color: 'var(--muted, #888)', fontSize: '0.7em', margin: '0 1px' }}>|</span>
      )}
      {appContainers.map(c => (
        <span
          key={c.name}
          title={c.name}
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '2px',
            background: hasStatuses ? squareColor(c.name, false) : phaseColor(),
          }}
        />
      ))}
    </span>
  );
}

function age(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

function intervalForAge(seconds: number): number {
  if (seconds < 60) return 1_000;       // update every second while < 1m
  if (seconds < 3_600) return 10_000;  // every 10s while < 1h
  if (seconds < 86_400) return 60_000; // every minute while < 1d
  return 600_000;                       // every 10 minutes otherwise
}

function AgeCell({ timestamp }: { timestamp: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    function schedule() {
      const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
      const ms = intervalForAge(seconds);
      const id = setTimeout(() => {
        setTick(t => t + 1);
        schedule();
      }, ms);
      return id;
    }
    const id = schedule();
    return () => clearTimeout(id);
  }, [timestamp]);

  return <td>{timestamp ? age(timestamp) : ''}</td>;
}

type Tab = 'Deployments' | 'DaemonSets' | 'StatefulSets' | 'ReplicaSets' | 'Pods' | 'Services' | 'Nodes' | 'Jobs' | 'CronJobs';

const TABS: Tab[] = ['Deployments', 'DaemonSets', 'StatefulSets', 'ReplicaSets', 'Pods', 'Services', 'Nodes', 'Jobs', 'CronJobs'];

type Props = Pick<AppState, 'Deployments' | 'DaemonSets' | 'StatefulSets' | 'ReplicaSets' | 'Pods' | 'Services' | 'Endpoints' | 'Nodes' | 'Jobs' | 'CronJobs'>;

export function ResourceTabs({ Deployments, DaemonSets, StatefulSets, ReplicaSets, Pods, Services, Endpoints, Nodes, Jobs, CronJobs }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Deployments');

  return (
    <div className="resource-tabs">
      <div role="tablist" className="resource-tabs__tablist">
        {TABS.map(tab => (
          <button
            key={tab}
            role="tab"
            className="resource-tabs__tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="resource-tabs__panel">
        {activeTab === 'Deployments' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Desired</th>
                <th>Ready</th>
                <th>Available</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Deployments.map(d => (
                <tr key={`${d.metadata.namespace}/${d.metadata.name}`}>
                  <td>{d.metadata.namespace}</td>
                  <td>{d.metadata.name}</td>
                  <td>{d.spec.replicas}</td>
                  <td>{d.status.readyReplicas}</td>
                  <td>{d.status.availableReplicas}</td>
                  <AgeCell timestamp={d.metadata.creationTimestamp} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === 'DaemonSets' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Desired</th>
                <th>Current</th>
                <th>Ready</th>
                <th>Available</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {DaemonSets.map(ds => (
                <tr key={`${ds.metadata.namespace}/${ds.metadata.name}`}>
                  <td>{ds.metadata.namespace}</td>
                  <td>{ds.metadata.name}</td>
                  <td>{ds.status.desiredNumberScheduled}</td>
                  <td>{ds.status.currentNumberScheduled}</td>
                  <td>{ds.status.numberReady}</td>
                  <td>{ds.status.numberAvailable}</td>
                  <AgeCell timestamp={ds.metadata.creationTimestamp} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === 'StatefulSets' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Desired</th>
                <th>Ready</th>
                <th>Service</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {StatefulSets.map(sts => (
                <tr key={`${sts.metadata.namespace}/${sts.metadata.name}`}>
                  <td>{sts.metadata.namespace}</td>
                  <td>{sts.metadata.name}</td>
                  <td>{sts.spec.replicas}</td>
                  <td>{sts.status.readyReplicas}/{sts.spec.replicas}</td>
                  <td>{sts.spec.serviceName}</td>
                  <AgeCell timestamp={sts.metadata.creationTimestamp} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === 'ReplicaSets' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Desired</th>
                <th>Ready</th>
                <th>Available</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {ReplicaSets.map(r => (
                <tr key={`${r.metadata.namespace}/${r.metadata.name}`}>
                  <td>{r.metadata.namespace}</td>
                  <td>{r.metadata.name}</td>
                  <td>{r.spec?.replicas}</td>
                  <td>{r.status?.readyReplicas}</td>
                  <td>{r.status?.availableReplicas}</td>
                  <AgeCell timestamp={r.metadata.creationTimestamp} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === 'Pods' && (
          <table className="resource-tabs__table resource-tabs__table--fixed">
            <colgroup>
              <col style={{ width: '9em' }}  />{/* Namespace */}
              <col style={{ width: '22%' }}  />{/* Name — takes remaining space */}
              <col style={{ width: '10em' }} />{/* Status */}
              <col style={{ width: '8em' }}  />{/* Ready (squares) */}
              <col style={{ width: '9em' }}  />{/* IP */}
              <col style={{ width: '9em' }}  />{/* Node */}
              <col style={{ width: '5em' }}  />{/* Age */}
            </colgroup>
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Status</th>
                <th>Ready</th>
                <th>IP</th>
                <th>Node</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Pods.map(p => {
                const totalInit = p.spec.initContainers?.length ?? 0;
                let statusStr = p.status.phase as string;
                if (p.status.phase === 'Pending' && totalInit > 0) {
                  const doneInit = (p.status.initContainerStatuses ?? [])
                    .filter(s => s.state?.terminated !== undefined).length;
                  if (doneInit < totalInit) statusStr = `Init:${doneInit}/${totalInit}`;
                  else if ((p.status.containerStatuses ?? []).some(s => s.state?.waiting?.reason === 'ContainerCreating'))
                    statusStr = 'PodInitializing';
                } else if (p.status.phase === 'Pending' && p.spec.nodeName) {
                  if ((p.status.containerStatuses ?? []).some(s => s.state?.waiting?.reason === 'ContainerCreating'))
                    statusStr = 'ContainerCreating';
                }
                return (
                  <tr key={`${p.metadata.namespace}/${p.metadata.name}`}>
                    <td>{p.metadata.namespace}</td>
                    <td>{p.metadata.name}</td>
                    <td>{statusStr}</td>
                    <td><ContainerSquares pod={p} /></td>
                    <td>{p.status.podIP ?? '—'}</td>
                    <td>{p.spec.nodeName ?? '—'}</td>
                    <AgeCell timestamp={p.metadata.creationTimestamp} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {activeTab === 'Services' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Type</th>
                <th>Cluster IP</th>
                <th>Port(s)</th>
                <th>Endpoints</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Services.map(s => {
                const ep = Endpoints.find(
                  e => e.metadata.name === s.metadata.name && e.metadata.namespace === s.metadata.namespace
                );
                const endpoints = ep?.subsets.flatMap(sub =>
                  sub.addresses.flatMap(a =>
                    sub.ports.map(p => `${a.ip}:${p.port}`)
                  )
                ) ?? [];
                return (
                  <tr key={`${s.metadata.namespace}/${s.metadata.name}`}>
                    <td>{s.metadata.namespace}</td>
                    <td>{s.metadata.name}</td>
                    <td>{s.spec.type}</td>
                    <td>{s.spec.clusterIP}</td>
                    <td>{s.spec.ports.map(p => p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol ?? 'TCP'}` : `${p.port}/${p.protocol ?? 'TCP'}`).join(', ')}</td>
                    <td>{endpoints.length > 0 ? endpoints.join(', ') : '—'}</td>
                    <AgeCell timestamp={s.metadata.creationTimestamp} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {activeTab === 'Nodes' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Internal IP</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Pods</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Nodes.map(n => {
                const ready = n.status.conditions.find(c => c.type === 'Ready')?.status === 'True';
                const status = n.spec.unschedulable
                  ? (ready ? 'Ready,SchedulingDisabled' : 'NotReady,SchedulingDisabled')
                  : (ready ? 'Ready' : 'NotReady');
                const ip = n.status.addresses.find(a => a.type === 'InternalIP')?.address ?? '—';
                const podCount = Pods.filter(p => p.spec.nodeName === n.metadata.name).length;
                return (
                  <tr key={n.metadata.name}>
                    <td>{n.metadata.name}</td>
                    <td>{status}</td>
                    <td>{'<none>'}</td>
                    <td>{ip}</td>
                    <td>{n.status.capacity.cpu}</td>
                    <td>{n.status.capacity.memory}</td>
                    <td>{podCount}</td>
                    <AgeCell timestamp={n.metadata.creationTimestamp} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {activeTab === 'Jobs' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Completions</th>
                <th>Active</th>
                <th>Succeeded</th>
                <th>Failed</th>
                <th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Jobs.map(j => {
                const isComplete = j.status.conditions.some(c => c.type === 'Complete' && c.status === 'True');
                const isFailed   = j.status.conditions.some(c => c.type === 'Failed'   && c.status === 'True');
                const statusLabel = isComplete ? 'Complete' : isFailed ? 'Failed' : 'Running';
                return (
                  <tr key={`${j.metadata.namespace}/${j.metadata.name}`}>
                    <td>{j.metadata.namespace}</td>
                    <td>{j.metadata.name}</td>
                    <td>{j.status.succeeded}/{j.spec.completions}</td>
                    <td>{j.status.active}</td>
                    <td>{j.status.succeeded}</td>
                    <td>{j.status.failed}</td>
                    <td>{statusLabel}</td>
                    <AgeCell timestamp={j.metadata.creationTimestamp} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {activeTab === 'CronJobs' && (
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Schedule</th>
                <th>Last Schedule</th>
                <th>Active</th>
                <th>Suspend</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {CronJobs.map(c => {
                const activeCount = Jobs.filter(
                  j => j.metadata.ownerReferences?.some(r => r.kind === "CronJob" && r.name === c.metadata.name) &&
                       !j.status.conditions.some(cond => (cond.type === 'Complete' || cond.type === 'Failed') && cond.status === 'True'),
                ).length;
                return (
                  <tr key={`${c.metadata.namespace}/${c.metadata.name}`}>
                    <td>{c.metadata.namespace}</td>
                    <td>{c.metadata.name}</td>
                    <td>{c.spec.schedule}</td>
                    <td>{c.status.lastScheduleTime ? c.status.lastScheduleTime.slice(0, 19).replace('T', ' ') : '—'}</td>
                    <td>{activeCount}</td>
                    <td>{c.spec.suspend ? 'True' : 'False'}</td>
                    <AgeCell timestamp={c.metadata.creationTimestamp} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
