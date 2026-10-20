const $ = (id) => document.getElementById(id);
let me = null;
let mode = 'login';

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const money = (n) => `$${n.toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Auth ----------
function setMode(m) {
  mode = m;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === m));
  $('confirmWrap').hidden = m !== 'register';
  $('authSubmit').textContent = m === 'register' ? 'Create account' : 'Log in';
  $('authForm').password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('authError').textContent = '';
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tab)));

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('authError').textContent = '';
  if (mode === 'register' && f.password.value !== f.confirm.value) {
    $('authError').textContent = 'Passwords do not match';
    return;
  }
  try {
    await api(`/api/${mode}`, { username: f.username.value, password: f.password.value });
    f.reset();
    await boot();
  } catch (err) {
    $('authError').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', {});
  await boot();
});

// ---------- Orders ----------
async function loadMenu() {
  const menu = await api('/api/menu');
  $('menuSelect').innerHTML = '<option value="">— choose —</option>' +
    menu.map((m) => `<option value="${m.id}">${esc(m.name)} (${money(m.price)})</option>`).join('');
  if (me.is_admin) {
    $('menuList').innerHTML = menu.map((m) =>
      `<li><span>${esc(m.name)} — ${money(m.price)}</span><button class="link" data-remove="${m.id}">Remove</button></li>`).join('');
  }
}

async function loadOrders() {
  const orders = await api('/api/orders');
  let total = 0;
  const summary = {};
  $('ordersBody').innerHTML = orders.map((o) => {
    const cost = o.price * o.quantity;
    total += cost;
    summary[o.item] = (summary[o.item] || 0) + o.quantity;
    return `<tr class="${o.user_id === me.id ? 'mine' : ''}"><td>${esc(o.username)}</td><td>${esc(o.item)}</td>
      <td>${o.quantity}</td><td>${esc(o.notes)}</td><td class="num">${money(cost)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No orders yet today.</td></tr>';
  $('ordersCount').textContent = `${orders.length} of ${window.userCount} people ordered`;
  $('ordersTotal').textContent = money(total);
  $('summary').innerHTML = Object.entries(summary).map(([k, v]) => `<li>${v} × ${esc(k)}</li>`).join('') ||
    '<li class="muted">Nothing yet</li>';

  const mine = orders.find((o) => o.user_id === me.id);
  const f = $('orderForm');
  if (mine) {
    f.menu_item_id.value = mine.menu_item_id;
    f.quantity.value = mine.quantity;
    f.notes.value = mine.notes;
  }
  $('orderSubmit').textContent = mine ? 'Update order' : 'Place order';
  $('cancelOrder').hidden = !mine;
}

$('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('orderError').textContent = $('orderOk').textContent = '';
  try {
    await api('/api/orders', { menu_item_id: f.menu_item_id.value, quantity: f.quantity.value, notes: f.notes.value });
    $('orderOk').textContent = 'Order saved ✔';
    await loadOrders();
  } catch (err) {
    $('orderError').textContent = err.message;
  }
});

$('cancelOrder').addEventListener('click', async () => {
  await api('/api/orders/cancel', {});
  $('orderForm').reset();
  $('orderOk').textContent = 'Order cancelled';
  await loadOrders();
});

// ---------- Admin menu ----------
$('menuForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await api('/api/menu', { name: f.name.value, price: f.price.value });
  f.reset();
  await loadMenu();
});

$('menuList').addEventListener('click', async (e) => {
  const id = e.target.dataset.remove;
  if (!id || !confirm('Remove this item from the menu?')) return;
  await api('/api/menu/remove', { id });
  await loadMenu();
});

// ---------- Boot ----------
async function boot() {
  const info = await api('/api/me');
  me = info.user;
  window.userCount = info.userCount;
  $('auth').hidden = !!me;
  $('app').hidden = !me;
  $('userbar').hidden = !me;
  if (!me) {
    const left = info.maxUsers - info.userCount;
    $('seats').textContent = left > 0
      ? `${left} of ${info.maxUsers} account spots left.`
      : 'All account spots are taken.';
    setMode('login');
    return;
  }
  $('whoami').textContent = `Hi, ${me.username}${me.is_admin ? ' (admin)' : ''}`;
  $('date').textContent = new Date(info.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('adminCard').hidden = !me.is_admin;
  await loadMenu();
  await loadOrders();
}

boot();
