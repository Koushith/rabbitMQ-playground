import { useEffect, useState } from 'react';

const API = 'http://localhost:3001';
const PIZZA_TYPES = [
  'Margherita',
  'Pepperoni',
  'Hawaiian',
  'Quattro Formaggi',
  'Veggie',
];

export default function App() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [burnt, setBurnt] = useState([]);
  const [form, setForm] = useState({
    type: 'Margherita',
    ovenTooHot: false,
    bakeTimeMs: 2000,
  });
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      const [s, o, b] = await Promise.all([
        fetch(`${API}/stats`).then((r) => r.json()),
        fetch(`${API}/orders`).then((r) => r.json()),
        fetch(`${API}/burnt`).then((r) => r.json()),
      ]);
      if (s.error) throw new Error(s.error);
      setStats(s);
      setOrders(Array.isArray(o) ? o : []);
      setBurnt(Array.isArray(b) ? b : []);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, []);

  async function placeOrder(overrides = {}) {
    await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...overrides }),
    });
  }
  async function orderBatch(n, overrides) {
    await Promise.all(Array.from({ length: n }, () => placeOrder(overrides)));
  }
  async function resendBurnt() {
    await fetch(`${API}/burnt/resend`, { method: 'POST' });
  }
  async function trashBurnt() {
    await fetch(`${API}/burnt/trash`, { method: 'POST' });
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Pizzeria</h1>
          <p className="muted sub">
            a pub/sub learning app — customers order pizzas, chefs cook them in
            the background
          </p>
        </div>
        <a href="http://localhost:15672" target="_blank" rel="noreferrer">
          RabbitMQ admin ↗
        </a>
      </header>

      {err && <div className="err">Kitchen is offline: {err}</div>}

      <section className="panel">
        <h2>1. Place an order</h2>
        <div className="row">
          <label>
            Pizza
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {PIZZA_TYPES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Bake time (ms)
            <input
              type="number"
              value={form.bakeTimeMs}
              onChange={(e) =>
                setForm({ ...form, bakeTimeMs: Number(e.target.value) })
              }
            />
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={form.ovenTooHot}
              onChange={(e) =>
                setForm({ ...form, ovenTooHot: e.target.checked })
              }
            />
            Oven too hot (pizza will burn)
          </label>
        </div>
        <div className="row buttons">
          <button onClick={() => placeOrder()}>Order 1</button>
          <button onClick={() => orderBatch(10)}>Order 10</button>
          <button
            className="danger"
            onClick={() => orderBatch(5, { ovenTooHot: true })}
          >
            Order 5 that will burn
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>2. Kitchen right now</h2>
        <div className="kitchen-stats">
          <StatTile
            label="Waiting to cook"
            value={stats?.kitchen?.waiting}
            color="grey"
            hint="in the queue — no chef yet"
          />
          <StatTile
            label="Cooking now"
            value={stats?.kitchen?.cooking}
            color="orange"
            hint="a chef is working on it"
          />
          <StatTile
            label="Chefs on duty"
            value={stats?.kitchen?.chefs}
            color="blue"
            hint="worker processes connected"
          />
          <StatTile
            label="In the trash"
            value={stats?.burnt?.count}
            color="red"
            hint="gave up after retries"
          />
        </div>
        <p className="muted rates">
          Orders per second: {fmt(stats?.kitchen?.ordersPerSec)} · Cooking
          starts: {fmt(stats?.kitchen?.cookingPerSec)} · Deliveries:{' '}
          {fmt(stats?.kitchen?.deliveriesPerSec)}
        </p>
      </section>

      <section className="panel">
        <h2>3. Order tracker ({orders.length})</h2>
        <p className="muted hint">
          Every pizza you order shows here. Watch the status change live:
          <b> waiting → cooking → delivered</b> (or <b>burnt</b> if the oven
          was too hot and all retries failed).
        </p>
        <table className="orders">
          <thead>
            <tr>
              <th>Order</th>
              <th>Pizza</th>
              <th>Status</th>
              <th>Chef</th>
              <th>Attempts</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  No orders yet — place one above.
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <code>#{o.id.slice(0, 6)}</code>
                </td>
                <td>{o.type}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>{o.chef || '—'}</td>
                <td>{o.attempts || (o.status === 'waiting' ? 0 : 1)}</td>
                <td className="muted">{formatAge(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="row between">
          <div>
            <h2>4. Trash — burnt pizzas ({burnt.length})</h2>
            <p className="muted hint">
              When a chef fails to cook a pizza even after 3 retries, it lands
              here instead of being lost. You can send it back to the kitchen
              (e.g. after fixing the oven) or throw it away.
            </p>
          </div>
          <div className="row">
            <button onClick={resendBurnt} disabled={burnt.length === 0}>
              Send back to kitchen
            </button>
            <button
              className="danger"
              onClick={trashBurnt}
              disabled={burnt.length === 0}
            >
              Throw away
            </button>
          </div>
        </div>
        {burnt.length === 0 ? (
          <p className="muted">empty</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Pizza</th>
                <th>Why it burnt</th>
                <th>Times tried</th>
              </tr>
            </thead>
            <tbody>
              {burnt.map((m, i) => {
                const d = m.properties?.headers?.['x-death']?.[0] ?? {};
                return (
                  <tr key={i}>
                    <td>
                      <code>#{m.payload?.id?.slice?.(0, 6)}</code>
                    </td>
                    <td>{m.payload?.type}</td>
                    <td>{d.reason || '—'}</td>
                    <td>{d.count ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer>
        <p>
          <b>Tip:</b> open another terminal and run{' '}
          <code>WORKER_ID=chef-luigi npm run dev</code> inside{' '}
          <code>worker/</code> to add a second chef. "Chefs on duty" will jump
          to 2 and orders cook in parallel.
        </p>
      </footer>
    </div>
  );
}

function StatTile({ label, value, color, hint }) {
  return (
    <div className={`tile ${color}`}>
      <div className="n">{value ?? '—'}</div>
      <div className="lbl">{label}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{status || 'unknown'}</span>;
}

function fmt(n) {
  if (n == null) return '—';
  return n.toFixed(1);
}

function formatAge(iso) {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
