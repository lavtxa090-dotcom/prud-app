/**
 * db.js — Браузерная версия базы данных (localStorage)
 * API идентичен Node.js-версии, но работает в любом браузере без Node.js.
 */
'use strict';

// ─── Конфигурация ───
const AppConfig = {
    ORG_NAME: 'Чистый пруд',
    ORG_SUBTITLE: 'Территория отдыха',
    FOOTER_TEXT: 'Спасибо за посещение!',
};

// ─── Хранилище ───
const STORAGE_KEY = 'chisty_prud_db';

function emptyDb() {
    return {
        services: [],
        orders: [],
        order_items: [],
        _seq: { service: 0, order: 0, item: 0 },
        _settings: {},
        _clients: {},
    };
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyDb();
        const data = JSON.parse(raw);
        // Миграции
        if (!data._seq) data._seq = { service: 0, order: 0, item: 0 };
        if (!data._settings) data._settings = {};
        if (!data._clients) data._clients = {};
        data.orders.forEach((o) => { if (o.phone === undefined) o.phone = ''; });
        data.orders.forEach((o) => { if (o.discount === undefined) o.discount = 0; });
        return data;
    } catch (e) {
        return emptyDb();
    }
}

function _save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── Публичный API ───
const DB = {

    // ── Услуги ──
    getAllServices() {
        return _load().services;
    },

    addService(name, price, rules) {
        const db = _load();
        db._seq.service++;
        db.services.push({ id: db._seq.service, name, price: +price, rules: rules || '' });
        _save(db);
        return db._seq.service;
    },

    updateService(id, name, price, rules) {
        const db = _load();
        const svc = db.services.find((s) => s.id === id);
        if (svc) { svc.name = name; svc.price = +price; svc.rules = rules || ''; }
        _save(db);
    },

    deleteService(id) {
        const db = _load();
        db.services = db.services.filter((s) => s.id !== id);
        _save(db);
    },

    // ── Заказы ──
    createOrder(items, phone, discountPct) {
        const db = _load();
        const discount = Math.min(100, Math.max(0, Number(discountPct) || 0));
        const subtotal = items.reduce((s, i) => s + i.service_price * i.quantity, 0);
        const total = +(subtotal * (1 - discount / 100)).toFixed(2);
        db._seq.order++;
        const orderId = db._seq.order;
        db.orders.push({ id: orderId, datetime: Date.now(), total, phone: (phone || '').trim(), discount });
        for (const item of items) {
            db._seq.item++;
            db.order_items.push({
                id: db._seq.item,
                order_id: orderId,
                service_id: item.service_id || null,
                service_name: item.service_name,
                service_price: item.service_price,
                quantity: item.quantity,
            });
        }
        _save(db);
        return orderId;
    },

    deleteOrder(orderId) {
        const db = _load();
        db.orders = db.orders.filter((o) => o.id !== orderId);
        db.order_items = db.order_items.filter((i) => i.order_id !== orderId);
        _save(db);
    },

    updateOrder(orderId, items) {
        const db = _load();
        const order = db.orders.find((o) => o.id === orderId);
        if (!order) return;
        db.order_items = db.order_items.filter((i) => i.order_id !== orderId);
        const subtotal = items.reduce((s, i) => s + i.service_price * i.quantity, 0);
        order.total = +(subtotal * (1 - (order.discount || 0) / 100)).toFixed(2);
        for (const item of items) {
            db._seq.item++;
            db.order_items.push({
                id: db._seq.item,
                order_id: orderId,
                service_id: item.service_id || null,
                service_name: item.service_name,
                service_price: item.service_price,
                quantity: item.quantity,
            });
        }
        _save(db);
    },

    getOrders(fromMs, toMs) {
        return _load().orders
            .filter((o) => o.datetime >= fromMs && o.datetime <= toMs)
            .sort((a, b) => b.datetime - a.datetime);
    },

    getAllOrders() {
        return _load().orders.sort((a, b) => b.datetime - a.datetime);
    },

    getOrderItems(orderId) {
        return _load().order_items.filter((i) => i.order_id === orderId);
    },

    getOrderSummary(orderId) {
        const items = _load().order_items.filter((i) => i.order_id === orderId);
        if (!items.length) return '—';
        return items.map((i) => `${i.service_name} ×${i.quantity}`).join(', ');
    },

    getStatsByPeriod(fromMs, toMs) {
        const db = _load();
        const orders = db.orders.filter((o) => o.datetime >= fromMs && o.datetime <= toMs);
        const ids = new Set(orders.map((o) => o.id));
        const items = db.order_items.filter((i) => ids.has(i.order_id));

        const revenue = orders.reduce((s, o) => s + o.total, 0);
        const orderCount = orders.length;
        const itemCount = items.reduce((s, i) => s + i.quantity, 0);

        // По услугам
        const svcMap = {};
        for (const item of items) {
            if (!svcMap[item.service_name]) svcMap[item.service_name] = { total_qty: 0, total_revenue: 0 };
            svcMap[item.service_name].total_qty += item.quantity;
            svcMap[item.service_name].total_revenue += item.service_price * item.quantity;
        }
        const byService = Object.entries(svcMap).map(([service_name, v]) => ({ service_name, ...v }));

        return { revenue, orderCount, itemCount, byService, orders };
    },

    // ── Настройки ──
    getSetting(key) {
        return _load()._settings[key] || null;
    },

    setSetting(key, value) {
        const db = _load();
        if (value === null || value === undefined) { delete db._settings[key]; }
        else { db._settings[key] = value; }
        _save(db);
    },

    // ── Клиенты ──
    getClientByPhone(phone) {
        if (!phone) return null;
        return _load()._clients[phone] || null;
    },

    setClientDiscount(phone, discount, notes) {
        if (!phone) return;
        const db = _load();
        db._clients[phone] = { discount: Math.min(100, Math.max(0, Number(discount) || 0)), notes: notes || '' };
        _save(db);
    },

    deleteClient(phone) {
        if (!phone) return;
        const db = _load();
        delete db._clients[phone];
        _save(db);
    },

    getAllClients() {
        const db = _load();
        const stats = {};
        for (const o of db.orders) {
            if (!o.phone) continue;
            if (!stats[o.phone]) stats[o.phone] = { visits: 0, total_spend: 0, last_visit: 0 };
            stats[o.phone].visits++;
            stats[o.phone].total_spend += o.total;
            if (o.datetime > stats[o.phone].last_visit) stats[o.phone].last_visit = o.datetime;
        }
        const allPhones = new Set([...Object.keys(db._clients), ...Object.keys(stats)]);
        return [...allPhones].map((phone) => ({
            phone,
            discount: (db._clients[phone] || {}).discount || 0,
            notes: (db._clients[phone] || {}).notes || '',
            visits: (stats[phone] || {}).visits || 0,
            total_spend: (stats[phone] || {}).total_spend || 0,
            last_visit: (stats[phone] || {}).last_visit || 0,
        })).sort((a, b) => b.visits - a.visits);
    },
};

// ─── SHA-256 через Web Crypto API (async) ───
async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Печать билета ───
function printReceipt(orderId, datetime, items, phone, discountPct, globalRules) {
    const discount = Number(discountPct) || 0;
    const subtotal = items.reduce((s, i) => s + i.service_price * i.quantity, 0);
    const total = +(subtotal * (1 - discount / 100)).toFixed(2);
    const d = new Date(datetime);
    const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const itemsHtml = items.map((i) =>
        `<div class="row"><span>${escHtml(i.service_name)} ×${i.quantity}</span><span>${(i.service_price * i.quantity).toFixed(2)} ₽</span></div>`
    ).join('');

    const discLine = discount > 0
        ? `<div class="row"><span>Скидка ${discount}%</span><span>−${(subtotal - total).toFixed(2)} ₽</span></div>` : '';

    const phoneLine = phone
        ? `<div style="text-align:center;font-size:9pt;margin:2px 0;">📱 ${phone}</div>` : '';

    const rulesHtml = globalRules && globalRules.trim()
        ? `<hr><div class="rules-title">─── ПРАВИЛА ТЕРРИТОРИИ ───</div><div class="rules-text">${escHtml(globalRules).replace(/\n/g, '<br>')}</div>` : '';

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Билет №${orderId}</title>
<style>
  @page { width:80mm; margin:4mm 2mm; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Courier New',monospace; font-size:10pt; width:76mm; color:#000; background:#fff; }
  .org-name { font-size:14pt; font-weight:bold; text-align:center; }
  .org-sub  { font-size:9pt; text-align:center; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; }
  .info     { font-size:9pt; text-align:center; margin-bottom:4px; }
  hr { border:none; border-top:1px dashed #000; margin:4px 0; }
  .row { display:flex; justify-content:space-between; margin:2px 0; }
  .total { font-size:12pt; font-weight:bold; text-align:right; margin:4px 0; }
  .footer { text-align:center; font-style:italic; margin-top:6px; }
  .rules-title { font-weight:bold; margin:4px 0 2px; font-size:9pt; }
  .rules-text { font-size:8.5pt; white-space:pre-wrap; line-height:1.3; }
</style></head><body>
  <div class="org-name">${escHtml(AppConfig.ORG_NAME)}</div>
  <div class="org-sub">${escHtml(AppConfig.ORG_SUBTITLE || '')}</div>
  <div class="info">${dateStr} &nbsp; Билет №${orderId}</div>
  ${phoneLine}
  <hr>
  ${itemsHtml}
  ${discLine}
  <hr>
  <div class="total">ИТОГО: ${total.toFixed(2)} ₽</div>
  ${rulesHtml}
  <hr>
  <div class="footer">${escHtml(AppConfig.FOOTER_TEXT)}</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=420,height=640');
    w.document.write(html);
    w.document.close();
    w.onload = () => { w.print(); w.onafterprint = () => setTimeout(() => w.close(), 300); };
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
