'use strict';
// cashier.js — PWA API Client (Async)
// DB, printReceipt, sha256, AppConfig, escHtml defined in db.js

let basket = [];
let services = [];
let currentDiscount = 0;

window.addEventListener('DOMContentLoaded', () => {
    services = DB.getAllServices();
    renderServiceSelect();
});

function renderServiceSelect() {
    const sel = document.getElementById('service-select');
    sel.innerHTML = '<option value="">— Выберите услугу —</option>';
    services.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name}  —  ${fmt(s.price)} ₽`;
        sel.appendChild(opt);
    });
}

function onServiceChange() {
    const sel = document.getElementById('service-select');
    const badge = document.getElementById('price-badge');
    const id = parseInt(sel.value);
    if (!id) { badge.textContent = 'Сначала выберите услугу'; badge.classList.remove('has-price'); return; }
    const svc = services.find((s) => s.id === id);
    if (svc) { badge.textContent = `${fmt(svc.price)} ₽ за единицу`; badge.classList.add('has-price'); }
}

function onPhoneChange() {
    const phone = document.getElementById('phone-input').value.trim();
    const badge = document.getElementById('client-badge');
    if (!phone || phone.length < 5) {
        badge.style.display = 'none';
        currentDiscount = 0;
        renderBasket();
        return;
    }
    const client = DB.getClientByPhone(phone);
    if (client) {
        currentDiscount = client.discount || 0;
        const dHtml = currentDiscount > 0
            ? `<span style="color:var(--accent);font-weight:700;">Скидка: ${currentDiscount}%</span>`
            : `<span style="color:var(--text-dim);">Скидка не назначена</span>`;
        badge.innerHTML = `👤 <strong>Постоянный клиент</strong><br>${dHtml}${client.notes ? `<br><span style="color:var(--text-dim);font-size:12px;">${escHtml(client.notes)}</span>` : ''}`;
        badge.style.borderColor = currentDiscount > 0 ? 'var(--accent)' : 'var(--border)';
    } else {
        currentDiscount = 0;
        badge.innerHTML = `<span style="color:var(--text-dim);">📋 Новый клиент — телефон будет сохранён</span>`;
        badge.style.borderColor = 'var(--border)';
    }
    badge.style.display = 'block';
    renderBasket();
}

function addItem() {
    const sel = document.getElementById('service-select');
    const qty = parseInt(document.getElementById('qty-input').value);
    const sid = parseInt(sel.value);
    if (!sid) { showNotif('Выберите услугу', true); return; }
    if (!qty || qty < 1) { showNotif('Укажите корректное количество', true); return; }
    const svc = services.find((s) => s.id === sid);
    if (!svc) return;
    const ex = basket.find((b) => b.service_id === sid);
    if (ex) { ex.quantity += qty; } else {
        basket.push({ service_id: svc.id, service_name: svc.name, service_price: svc.price, quantity: qty });
    }
    sel.value = '';
    document.getElementById('qty-input').value = 1;
    document.getElementById('price-badge').textContent = 'Сначала выберите услугу';
    document.getElementById('price-badge').classList.remove('has-price');
    renderBasket();
}

function removeItem(idx) { basket.splice(idx, 1); renderBasket(); }

function clearOrder() {
    if (!basket.length) return;
    basket = [];
    document.getElementById('phone-input').value = '';
    document.getElementById('client-badge').style.display = 'none';
    currentDiscount = 0;
    renderBasket();
}

function renderBasket() {
    const empty = document.getElementById('empty-basket');
    const tbl = document.getElementById('basket-table');
    const tbody = document.getElementById('basket-tbody');
    const countEl = document.getElementById('basket-count');
    const totalEl = document.getElementById('total-amount');
    const clearBtn = document.getElementById('clear-btn');
    const printBtn = document.getElementById('print-btn');

    if (!basket.length) {
        empty.style.display = 'flex'; tbl.classList.remove('visible');
        countEl.textContent = '— позиций'; totalEl.textContent = '0.00';
        clearBtn.disabled = true; printBtn.disabled = true; return;
    }
    empty.style.display = 'none'; tbl.classList.add('visible');

    let subtotal = 0;
    let html = '';
    basket.forEach((item, i) => {
        const line = item.service_price * item.quantity;
        subtotal += line;
        html += `<tr>
          <td>${i + 1}</td>
          <td><strong>${escHtml(item.service_name)}</strong></td>
          <td>${item.quantity}</td>
          <td>${fmt(item.service_price)} ₽</td>
          <td class="font-bold text-accent">${fmt(line)} ₽</td>
          <td><button class="del-btn" onclick="removeItem(${i})">✕</button></td>
        </tr>`;
    });
    tbody.innerHTML = html;

    const disc = currentDiscount;
    const total = +(subtotal * (1 - disc / 100)).toFixed(2);
    const qty = basket.reduce((s, b) => s + b.quantity, 0);
    countEl.textContent = `${basket.length} позиц. / ${qty} ед.`;
    if (disc > 0) {
        totalEl.innerHTML = `<span style="font-size:1rem;color:var(--text-dim);text-decoration:line-through;">${fmt(subtotal)}</span>&nbsp;${fmt(total)}&nbsp;<span style="font-size:1rem;color:var(--accent);font-weight:600;">-${disc}%</span>`;
    } else {
        totalEl.textContent = fmt(total);
    }
    clearBtn.disabled = false; printBtn.disabled = false;
}

function printOrder() {
    if (!basket.length) return;
    const btn = document.getElementById('print-btn');
    btn.disabled = true; btn.textContent = '⏳ Сохранение...';
    try {
        const phone = (document.getElementById('phone-input').value || '').trim();
        const discount = currentDiscount;
        const rules = DB.getSetting('global_rules') || '';
        const orderId = DB.createOrder(basket, phone, discount);
        printReceipt(orderId, Date.now(), basket, phone, discount, rules);
        showNotif(`✅ Билет №${orderId} успешно оформлен (оффлайн)`);
        clearOrder();
    } catch (e) {
        showNotif('Ошибка: ' + e.message, true);
    } finally {
        btn.disabled = false; btn.textContent = '🖨 Печать билета';
    }
}

function goHome() {
    if (basket.length > 0 && !confirm('В корзине есть позиции. Выйти?')) return;
    window.location.href = 'index.html';
}

function fmt(n) { return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

let notifTimer;
function showNotif(msg, isError = false) {
    const old = document.querySelector('.notif'); if (old) old.remove();
    clearTimeout(notifTimer);
    const el = document.createElement('div');
    el.className = 'notif' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    notifTimer = setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 400); }, 3000);
}

window.onServiceChange = onServiceChange;
window.onPhoneChange = onPhoneChange;
window.addItem = addItem;
window.removeItem = removeItem;
window.clearOrder = clearOrder;
window.printOrder = printOrder;
window.goHome = goHome;
