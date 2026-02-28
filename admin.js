'use strict';
// admin.js — PWA browser version (no require/fs)
// DB, sha256, escHtml defined in db.js

let editingId = null;
let _editOrderId = null;
let _editOrderItems = [];
let _editClientPhone = null;

// ─── Tab switching ───
function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`tab-${name}-btn`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'clients') renderClients();
    if (name === 'settings') { loadGlobalRules(); initPasswordSettings(); }
    if (name === 'services') renderServices();
}

// ─── Init ───
window.addEventListener('DOMContentLoaded', () => {
    renderServices();
    setToday();
    initPasswordSettings();
});

// ═══════════════════════════════
// SERVICES
// ═══════════════════════════════
function renderServices() {
    const tbody = document.getElementById('services-tbody');
    const services = DB.getAllServices();
    if (!services.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-text">Нет услуг. Добавьте первую.</div></div></td></tr>`;
        return;
    }
    tbody.innerHTML = services.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escHtml(s.name)}</strong></td>
        <td class="text-accent font-bold">${fmt(s.price)} ₽</td>
        <td>
          <div class="flex-row" style="gap:4px;">
            <button class="btn btn-secondary btn-icon" onclick="editService(${s.id})" title="Изменить">✏️</button>
            <button class="btn btn-danger btn-icon" onclick="deleteService(${s.id}, '${escHtml(s.name).replace(/'/g, "\\'")}')">🗑</button>
          </div>
        </td>
      </tr>`).join('');
}

function showAddForm() {
    editingId = null;
    document.getElementById('form-title').textContent = 'Новая услуга';
    document.getElementById('f-name').value = '';
    document.getElementById('f-price').value = '';
    document.getElementById('save-btn').textContent = '💾 Добавить';
    document.getElementById('service-form-card').classList.add('visible');
    document.getElementById('f-name').focus();
}

function editService(id) {
    const s = DB.getAllServices().find((x) => x.id === id);
    if (!s) return;
    editingId = id;
    document.getElementById('form-title').textContent = 'Редактирование услуги';
    document.getElementById('f-name').value = s.name;
    document.getElementById('f-price').value = s.price;
    document.getElementById('save-btn').textContent = '💾 Сохранить изменения';
    document.getElementById('service-form-card').classList.add('visible');
    document.getElementById('f-name').focus();
    document.getElementById('tab-services').scrollTop = 0;
}

function cancelForm() {
    editingId = null;
    document.getElementById('service-form-card').classList.remove('visible');
}

function saveService() {
    const name = document.getElementById('f-name').value.trim();
    const price = parseFloat(document.getElementById('f-price').value);
    if (!name) { showNotif('Введите название услуги', true); return; }
    if (isNaN(price) || price < 0) { showNotif('Введите корректную цену', true); return; }
    if (editingId) { DB.updateService(editingId, name, price, ''); showNotif('✅ Услуга обновлена'); }
    else { DB.addService(name, price, ''); showNotif('✅ Услуга добавлена'); }
    cancelForm();
    renderServices();
}

function deleteService(id, name) {
    if (!confirm(`Удалить услугу «${name}»?`)) return;
    DB.deleteService(id);
    showNotif('Услуга удалена');
    renderServices();
}

// ═══════════════════════════════
// STATS / ORDERS
// ═══════════════════════════════
function setToday() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('date-from').value = today;
    document.getElementById('date-to').value = today;
}

function setThisMonth() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    document.getElementById('date-from').value = from;
    document.getElementById('date-to').value = to;
}

function applyFilter() {
    const fromStr = document.getElementById('date-from').value;
    const toStr = document.getElementById('date-to').value;
    if (!fromStr || !toStr) { showNotif('Укажите период', true); return; }
    const fromMs = new Date(fromStr + 'T00:00:00').getTime();
    const toMs = new Date(toStr + 'T23:59:59').getTime();
    const stats = DB.getStatsByPeriod(fromMs, toMs);

    document.getElementById('orders-period-label').textContent = `(${fromStr} — ${toStr})`;
    document.getElementById('stat-cards').style.display = 'grid';
    document.getElementById('stat-cards').innerHTML = `
        <div class="stat-card"><div class="stat-label">Выручка</div><div class="stat-value">${fmt(stats.revenue)}<span class="stat-unit">₽</span></div></div>
        <div class="stat-card"><div class="stat-label">Заказов</div><div class="stat-value">${stats.orderCount}</div></div>
        <div class="stat-card"><div class="stat-label">Позиций продано</div><div class="stat-value">${stats.itemCount}</div></div>
    `;

    if (stats.byService.length) {
        document.getElementById('service-stats-wrap').style.display = 'block';
        document.getElementById('service-stats-tbody').innerHTML = stats.byService.map((r) =>
            `<tr><td>${escHtml(r.service_name)}</td><td class="font-bold">${r.total_qty}</td><td class="text-accent font-bold">${fmt(r.total_revenue)} ₽</td></tr>`
        ).join('');
    }

    renderOrders(stats.orders);
}

function renderOrders(orders) {
    const tbody = document.getElementById('orders-tbody');
    if (!orders || !orders.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:20px;"><div class="empty-text">Нет заказов за выбранный период</div></div></td></tr>`;
        return;
    }
    tbody.innerHTML = orders.map((o) => {
        const summary = DB.getOrderSummary(o.id);
        const phoneHtml = o.phone ? `<span style="font-size:12px;">${escHtml(o.phone)}</span>` : `<span class="text-dim" style="font-size:12px;">—</span>`;
        const discHtml = o.discount > 0 ? ` <span class="badge badge-accent">-${o.discount}%</span>` : '';
        return `<tr>
          <td onclick="openOrderModal(${o.id})" style="cursor:pointer;"><span class="badge badge-accent">#${o.id}</span></td>
          <td onclick="openOrderModal(${o.id})" style="cursor:pointer;font-size:12px;">${fmtDate(o.datetime)}</td>
          <td>${phoneHtml}</td>
          <td onclick="openOrderModal(${o.id})" style="cursor:pointer;font-size:12px;color:var(--text-dim);">${escHtml(summary)}</td>
          <td class="font-bold text-accent">${fmt(o.total)} ₽${discHtml}</td>
          <td>
            <div class="flex-row" style="gap:2px;">
              <button class="btn btn-secondary btn-icon" onclick="openEditOrderModal(${o.id})">✏️</button>
              <button class="btn btn-danger btn-icon" onclick="confirmDeleteOrder(${o.id})">🗑</button>
            </div>
          </td>
        </tr>`;
    }).join('');
}

// ─── Order detail modal ───
function openOrderModal(orderId) {
    const order = DB.getAllOrders().find((o) => o.id === orderId);
    if (!order) return;
    const items = DB.getOrderItems(orderId);
    document.getElementById('modal-title').textContent = `Заказ #${orderId} — ${fmtDate(order.datetime)}`;
    document.getElementById('modal-items-tbody').innerHTML = items.map((i) =>
        `<tr><td>${escHtml(i.service_name)}</td><td>${fmt(i.service_price)} ₽</td><td>${i.quantity}</td><td class="font-bold text-accent">${fmt(i.service_price * i.quantity)} ₽</td></tr>`
    ).join('');
    document.getElementById('modal-total').textContent = fmt(order.total);
    document.getElementById('order-modal').classList.add('open');
}
function closeModal() { document.getElementById('order-modal').classList.remove('open'); }

// ─── Edit/Delete order ───
function confirmDeleteOrder(id) {
    if (!confirm(`Удалить заказ #${id}?`)) return;
    DB.deleteOrder(id);
    showNotif(`Заказ #${id} удалён`);
    applyFilter();
}

function openEditOrderModal(orderId) {
    _editOrderId = orderId;
    _editOrderItems = DB.getOrderItems(orderId).map((i) => ({ service_name: i.service_name, service_price: i.service_price, quantity: i.quantity }));
    document.getElementById('edit-order-title').textContent = `Редактирование заказа #${orderId}`;
    renderEditOrderTable();
    document.getElementById('edit-order-modal').classList.add('open');
}

function renderEditOrderTable() {
    document.getElementById('edit-order-tbody').innerHTML = _editOrderItems.map((item, i) => `
        <tr>
          <td>${escHtml(item.service_name)}</td>
          <td>${fmt(item.service_price)} ₽</td>
          <td><input type="number" min="1" max="9999" value="${item.quantity}" style="width:65px;padding:4px 6px;" oninput="updateEditItem(${i},this.value)" inputmode="numeric"></td>
          <td class="text-accent font-bold">${fmt(item.service_price * item.quantity)} ₽</td>
          <td><button class="del-btn" onclick="removeEditOrderItem(${i})">✕</button></td>
        </tr>`).join('');
    updateEditOrderTotal();
}

function updateEditItem(idx, val) { const q = parseInt(val); if (q > 0) { _editOrderItems[idx].quantity = q; updateEditOrderTotal(); } }
function removeEditOrderItem(idx) { _editOrderItems.splice(idx, 1); renderEditOrderTable(); }
function updateEditOrderTotal() {
    const total = _editOrderItems.reduce((s, i) => s + i.service_price * i.quantity, 0);
    document.getElementById('edit-order-total').textContent = fmt(total);
}
function saveEditOrder() {
    if (!_editOrderItems.length) {
        if (!confirm('Список пуст. Удалить заказ?')) return;
        DB.deleteOrder(_editOrderId); showNotif(`Заказ #${_editOrderId} удалён`);
        closeEditOrderModal(); applyFilter(); return;
    }
    DB.updateOrder(_editOrderId, _editOrderItems);
    showNotif(`Заказ #${_editOrderId} обновлён`);
    closeEditOrderModal(); applyFilter();
}
function closeEditOrderModal() { document.getElementById('edit-order-modal').classList.remove('open'); }

// ═══════════════════════════════
// CLIENTS
// ═══════════════════════════════
function renderClients() {
    const clients = DB.getAllClients();
    const tbody = document.getElementById('clients-tbody');
    if (!clients.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:20px;"><div class="empty-text">Нет клиентов (телефоны не вводились)</div></div></td></tr>`;
        return;
    }
    tbody.innerHTML = clients.map((c) => {
        const disc = c.discount > 0 ? `<span class="badge badge-accent">${c.discount}%</span>` : `<span class="text-dim">—</span>`;
        return `<tr>
          <td><strong>${escHtml(c.phone)}</strong></td>
          <td style="text-align:center;">${c.visits}</td>
          <td class="text-accent font-bold">${fmt(c.total_spend)} ₽</td>
          <td>${disc}</td>
          <td style="font-size:12px;color:var(--text-dim);">${escHtml(c.notes) || '—'}</td>
          <td><button class="btn btn-secondary btn-icon" onclick="openEditClientModal('${escHtml(c.phone)}')">✏️</button></td>
        </tr>`;
    }).join('');
}

function openEditClientModal(phone) {
    _editClientPhone = phone;
    const c = DB.getClientByPhone(phone) || {};
    document.getElementById('ec-phone').value = phone;
    document.getElementById('ec-discount').value = c.discount || 0;
    document.getElementById('ec-notes').value = c.notes || '';
    document.getElementById('edit-client-modal').classList.add('open');
}
function saveEditClient() {
    const d = parseInt(document.getElementById('ec-discount').value) || 0;
    const n = document.getElementById('ec-notes').value.trim();
    DB.setClientDiscount(_editClientPhone, d, n);
    showNotif(`Клиент ${_editClientPhone} обновлён`);
    closeEditClientModal(); renderClients();
}
function removeClientFromDb() {
    if (!confirm(`Удалить ${_editClientPhone} из базы?`)) return;
    DB.deleteClient(_editClientPhone);
    showNotif('Клиент удалён'); closeEditClientModal(); renderClients();
}
function closeEditClientModal() { document.getElementById('edit-client-modal').classList.remove('open'); }

// ═══════════════════════════════
// SETTINGS
// ═══════════════════════════════
function loadGlobalRules() {
    const el = document.getElementById('global-rules-input');
    if (el) el.value = DB.getSetting('global_rules') || '';
    const msg = document.getElementById('rules-save-msg');
    if (msg) msg.textContent = '';
}
function saveGlobalRules() {
    const text = (document.getElementById('global-rules-input').value || '').trim();
    DB.setSetting('global_rules', text || null);
    const msg = document.getElementById('rules-save-msg');
    msg.style.color = 'var(--accent)'; msg.textContent = '✅ Правила сохранены';
}
function clearGlobalRules() {
    if (!confirm('Очистить текст правил?')) return;
    document.getElementById('global-rules-input').value = '';
    DB.setSetting('global_rules', null);
    const msg = document.getElementById('rules-save-msg');
    msg.style.color = 'var(--accent)'; msg.textContent = '✅ Правила удалены';
}

// ─── Password settings ───
function initPasswordSettings() {
    const has = !!DB.getSetting('admin_password_hash');
    const statusEl = document.getElementById('pw-status-msg');
    const currLabel = document.getElementById('pw-current-label');
    const removeBtn = document.getElementById('remove-pw-btn');
    if (!statusEl) return;
    statusEl.innerHTML = has
        ? '✅ <strong>Пароль установлен.</strong>'
        : '⚠️ Пароль не установлен. Администратор доступен без пароля.';
    if (currLabel) currLabel.textContent = has ? 'Текущий пароль (для подтверждения)' : 'Текущий пароль (не требуется)';
    if (removeBtn) removeBtn.style.display = has ? '' : 'none';
    ['s-pw-current', 's-pw-new', 's-pw-confirm'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    const msg = document.getElementById('pw-save-msg'); if (msg) msg.textContent = '';
}

async function savePassword() {
    const msgEl = document.getElementById('pw-save-msg');
    const current = document.getElementById('s-pw-current').value;
    const newPw = document.getElementById('s-pw-new').value;
    const confirm2 = document.getElementById('s-pw-confirm').value;
    const stored = DB.getSetting('admin_password_hash');
    if (stored && await sha256(current) !== stored) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Неверный текущий пароль'; return; }
    if (!newPw) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Введите новый пароль'; return; }
    if (newPw.length < 4) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Минимум 4 символа'; return; }
    if (newPw !== confirm2) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Пароли не совпадают'; return; }
    DB.setSetting('admin_password_hash', await sha256(newPw));
    msgEl.style.color = 'var(--accent)'; msgEl.textContent = '✅ Пароль сохранён';
    initPasswordSettings();
}

async function removePassword() {
    const msgEl = document.getElementById('pw-save-msg');
    const current = document.getElementById('s-pw-current').value;
    const stored = DB.getSetting('admin_password_hash');
    if (!stored) return;
    if (await sha256(current) !== stored) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Неверный пароль'; return; }
    if (!confirm('Убрать пароль?')) return;
    DB.setSetting('admin_password_hash', null);
    msgEl.style.color = 'var(--accent)'; msgEl.textContent = '✅ Пароль удалён';
    initPasswordSettings();
}

// ═══════════════════════════════
// UTILS
// ═══════════════════════════════
function fmt(n) { return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(ts) {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let notifTimer;
function showNotif(msg, isError = false) {
    const old = document.querySelector('.notif'); if (old) old.remove();
    clearTimeout(notifTimer);
    const el = document.createElement('div'); el.className = 'notif' + (isError ? ' error' : ''); el.textContent = msg;
    document.body.appendChild(el);
    notifTimer = setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 400); }, 3000);
}

// Close modals on overlay click
['order-modal', 'edit-order-modal', 'edit-client-modal'].forEach((id) => {
    document.getElementById(id).addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });
});

// Globals for onclick
window.switchTab = switchTab;
window.showAddForm = showAddForm;
window.editService = editService;
window.cancelForm = cancelForm;
window.saveService = saveService;
window.deleteService = deleteService;
window.setToday = setToday;
window.setThisMonth = setThisMonth;
window.applyFilter = applyFilter;
window.openOrderModal = openOrderModal;
window.closeModal = closeModal;
window.confirmDeleteOrder = confirmDeleteOrder;
window.openEditOrderModal = openEditOrderModal;
window.closeEditOrderModal = closeEditOrderModal;
window.updateEditItem = updateEditItem;
window.removeEditOrderItem = removeEditOrderItem;
window.saveEditOrder = saveEditOrder;
window.renderClients = renderClients;
window.openEditClientModal = openEditClientModal;
window.saveEditClient = saveEditClient;
window.removeClientFromDb = removeClientFromDb;
window.closeEditClientModal = closeEditClientModal;
window.saveGlobalRules = saveGlobalRules;
window.clearGlobalRules = clearGlobalRules;
window.savePassword = savePassword;
window.removePassword = removePassword;
