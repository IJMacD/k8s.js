import { useEffect, useState } from 'react';
import type { AppState } from './store';
import './ResourceTabs.css';

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

type Tab = 'Deployments' | 'ReplicaSets' | 'Pods' | 'Services';

const TABS: Tab[] = ['Deployments', 'ReplicaSets', 'Pods', 'Services'];

type Props = Pick<AppState, 'Deployments' | 'ReplicaSets' | 'Pods' | 'Services' | 'Endpoints'>;

export function ResourceTabs({ Deployments, ReplicaSets, Pods, Services, Endpoints }: Props) {
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
          <table className="resource-tabs__table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Name</th>
                <th>Status</th>
                <th>Ready</th>
                <th>IP</th>
                <th>Containers</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {Pods.map(p => {
                const ready = p.status.conditions?.find(c => c.type === 'Ready')?.status === 'True';
                return (
                  <tr key={`${p.metadata.namespace}/${p.metadata.name}`}>
                    <td>{p.metadata.namespace}</td>
                    <td>{p.metadata.name}</td>
                    <td>{p.status.phase}</td>
                    <td>{ready ? '1/1' : '0/1'}</td>
                    <td>{p.status.podIP ?? '—'}</td>
                    <td>{p.spec.containers.map(c => c.image).join(', ')}</td>
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
                const ips = ep?.subsets.flatMap(sub => sub.addresses.map(a => a.ip)) ?? [];
                return (
                  <tr key={`${s.metadata.namespace}/${s.metadata.name}`}>
                    <td>{s.metadata.namespace}</td>
                    <td>{s.metadata.name}</td>
                    <td>{s.spec.type}</td>
                    <td>{s.spec.clusterIP}</td>
                    <td>{s.spec.ports.map(p => `${p.port}/TCP`).join(', ')}</td>
                    <td>{ips.length > 0 ? ips.join(', ') : '—'}</td>
                    <AgeCell timestamp={s.metadata.creationTimestamp} />
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
