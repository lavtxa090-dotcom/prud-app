'use strict';
// db.js — Оффлайн-клиент с фоновой синхронизацией
// Все данные хранятся локально (localStorage) и отправляются на сервер асинхронно

const AppConfig = {
    ORG_NAME: 'Чистый пруд',
    ORG_SUBTITLE: 'Территория отдыха',
    FOOTER_TEXT: 'Спасибо за посещение!',
};

const API_BASE = 'http://155.212.222.218:3000/api';

// ─── UUID Генератор для чеков ───
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const DB = {
    _data: null,

    // ─── Инициализация ───
    initDB() {
        if (this._data) return;
        const saved = localStorage.getItem('chisty_prud_db');
        if (saved) {
            try { this._data = JSON.parse(saved); } catch (e) { }
        }
        if (!this._data) this._data = this.emptyDb();

        // Миграция очередей
        if (!this._data._sync_queue) this._data._sync_queue = [];

        this.startSyncWorker();
    },

    emptyDb() {
        return {
            services: [],
            orders: [], // Теперь тут uuid вместо id
            order_items: [],
            _seq: { service: 0 },
            _settings: {},
            _clients: {},
            _sync_queue: [] // Очередь на отправку: [ {type: 'order', data: {...}}, {type: 'client', data: {...}} ]
        };
    },

    _save() {
        localStorage.setItem('chisty_prud_db', JSON.stringify(this._data));
    },

    // ─── Очередь Синхронизации ───
    addToSyncQueue(type, data) {
        this._data._sync_queue.push({ type, data, ts: Date.now() });
        this._save();
    },

    startSyncWorker() {
        // Каждые 10 секунд пытаемся отправить данные
        setInterval(async () => {
            if (this._data._sync_queue.length === 0) return;

            // Временно копируем очередь (пока отправляем, могли нападать новые чеки)
            const queue = [...this._data._sync_queue];
            try {
                const res = await fetch(API_BASE + '/sync/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: queue })
                });

                if (res.ok) {
                    // Успешно отправили! Удаляем отправленные элементы из реальной очереди
                    const sentTs = queue.map(q => q.ts);
                    this._data._sync_queue = this._data._sync_queue.filter(q => !sentTs.includes(q.ts));
                    this._save();

                    // Запрашиваем актуальные услуги и клиентов с сервера (pull)
                    this.pullFromServer();
                }
            } catch (e) {
                // Сервер недоступен или нет инета, ничего не делаем, попробуем позже
                console.log('[Sync] Ошибка синхронизации (оффлайн):', e.message);
            }
        }, 10000); // 10 сек

        // Запрашиваем при каждом старте
        this.pullFromServer();
    },

    async pullFromServer() {
        try {
            const res = await fetch(API_BASE + '/sync/pull');
            if (!res.ok) return;
            const data = await res.json();

            // Получаем эталонные Услуги, Настройки и Клиентов с сервера
            if (data.services) this._data.services = data.services;
            if (data.settings) Object.assign(this._data._settings, data.settings);
            // Клиентов смерджим (серверные главнее, если нет конфликтов)
            if (data.clients) {
                for (const phone in data.clients) {
                    this._data._clients[phone] = data.clients[phone];
                }
            }
            this._save();
        } catch (e) { }
    },

    // ── Услуги (только чтение на планшете, ред. на сервере, но пока оставим как есть) ──
    // Для простоты, услуги тоже можно изменять локально и отправлять
    getAllServices() { return [...this._data.services].sort((a, b) => a.name.localeCompare(b.name, 'ru')); },

    // Внимание! Добавление услуг переделаем под синхронизацию
    addService(name, price, rules) {
        this._data._seq.service += 1;
        const id = this._data._seq.service;
        const svc = { id, name, price, rules: rules || null };
        this._data.services.push(svc);
        this.addToSyncQueue('service_add', svc);
        this._save();
        return id;
    },
    updateService(id, name, price, rules) {
        const s = this._data.services.find(x => x.id === id);
        if (s) {
            s.name = name; s.price = price; s.rules = rules;
            this.addToSyncQueue('service_update', s);
            this._save();
        }
    },
    deleteService(id) {
        this._data.services = this._data.services.filter(s => s.id !== id);
        this.addToSyncQueue('service_delete', { id });
        this._save();
    },

    // ── Заказы (Оффлайн-совместимые счетчики) ──
    createOrder(items, phone, discountPct) {
        const subtotal = items.reduce((s, i) => s + i.service_price * i.quantity, 0);
        const discount = Math.min(100, Math.max(0, Number(discountPct) || 0));
        const total = +(subtotal * (1 - discount / 100)).toFixed(2);

        // Используем UUID вместо цифр (чтобы разные планшеты не сделали заказ с id=10 одновременно)
        const orderId = generateUUID();
        // Но для красоты чека сделаем короткий "Билет №" (последние 4 цифры+буквы)
        const shortId = orderId.split('-')[1];

        const order = { uuid: orderId, shortId: shortId, datetime: Date.now(), total, phone: (phone || '').trim(), discount };
        this._data.orders.push(order);

        // Позиции заказа
        const orderItems = [];
        for (const item of items) {
            const itm = {
                uuid: generateUUID(),
                order_uuid: orderId,
                service_id: item.service_id,
                service_name: item.service_name,
                service_price: item.service_price,
                quantity: item.quantity,
            };
            this._data.order_items.push(itm);
            orderItems.push(itm);
        }

        // Кладём в очередь на отправку на Сервер
        this.addToSyncQueue('order_create', { order, items: orderItems });
        this._save();

        return shortId;
    },

    deleteOrder(uuid) {
        this._data.orders = this._data.orders.filter(o => (o.uuid || o.id) !== uuid);
        this._data.order_items = this._data.order_items.filter(i => (i.order_uuid || i.order_id) !== uuid);
        this.addToSyncQueue('order_delete', { uuid });
        this._save();
    },

    updateOrder(uuid, items) {
        const order = this._data.orders.find(o => (o.uuid || o.id) === uuid);
        if (!order) return;

        this._data.order_items = this._data.order_items.filter(i => (i.order_uuid || i.order_id) !== uuid);
        const subtotal = items.reduce((s, i) => s + i.service_price * i.quantity, 0);
        order.total = +(subtotal * (1 - (order.discount || 0) / 100)).toFixed(2);

        const orderItems = [];
        for (const item of items) {
            const itm = {
                uuid: generateUUID(), order_uuid: uuid,
                service_id: item.service_id, service_name: item.service_name,
                service_price: item.service_price, quantity: item.quantity,
            };
            this._data.order_items.push(itm);
            orderItems.push(itm);
        }
        this.addToSyncQueue('order_update', { uuid, order, items: orderItems });
        this._save();
    },

    getAllOrders() { return this._data.orders; },
    getOrders(fromMs, toMs) {
        return this._data.orders.filter(o => o.datetime >= fromMs && o.datetime <= toMs).sort((a, b) => b.datetime - a.datetime);
    },
    getOrderItems(uuid) { return this._data.order_items.filter(i => (i.order_uuid || i.order_id) === uuid); },
    getOrderSummary(uuid) { return this.getOrderItems(uuid).map(i => `${i.service_name} ×${i.quantity}`).join(', '); },

    getStatsByPeriod(fromMs, toMs) {
        const orderIds = new Set(this.getOrders(fromMs, toMs).map(o => o.uuid || o.id));
        const stats = { revenue: 0, orderCount: orderIds.size, itemCount: 0, orders: this.getOrders(fromMs, toMs), byService: [] };
        const map = {};
        for (const item of this._data.order_items) {
            if (!orderIds.has(item.order_uuid || item.order_id)) continue;
            stats.revenue += item.service_price * item.quantity;
            stats.itemCount += item.quantity;
            if (!map[item.service_name]) map[item.service_name] = { service_name: item.service_name, total_qty: 0, total_revenue: 0 };
            map[item.service_name].total_qty += item.quantity;
            map[item.service_name].total_revenue += item.service_price * item.quantity;
        }
        stats.byService = Object.values(map).sort((a, b) => b.total_revenue - a.total_revenue);
        return stats;
    },

    // ── Настройки ──
    getSetting(key) { return this._data._settings[key] || null; },
    setSetting(key, value) {
        if (value === null) delete this._data._settings[key]; else this._data._settings[key] = value;
        this.addToSyncQueue('setting_set', { key, value });
        this._save();
    },

    // ── Клиенты ──
    getClientByPhone(phone) { if (!phone) return null; return this._data._clients[phone] || null; },
    setClientDiscount(phone, discount, notes) {
        if (!phone) return;
        this._data._clients[phone] = { discount: Math.min(100, Math.max(0, Number(discount) || 0)), notes: notes || '' };
        this.addToSyncQueue('client_set', { phone, data: this._data._clients[phone] });
        this._save();
    },
    deleteClient(phone) { if (!phone) return; delete this._data._clients[phone]; this.addToSyncQueue('client_delete', { phone }); this._save(); },

    getAllClients() {
        // Локальный подсчет статистики по клиентам (для админки)
        const stats = {};
        for (const o of this._data.orders) {
            if (!o.phone) continue;
            if (!stats[o.phone]) stats[o.phone] = { visits: 0, total_spend: 0, last_visit: 0 };
            stats[o.phone].visits++;
            stats[o.phone].total_spend += o.total;
            if (o.datetime > stats[o.phone].last_visit) stats[o.phone].last_visit = o.datetime;
        }
        const all = new Set([...Object.keys(this._data._clients), ...Object.keys(stats)]);
        return [...all].map(phone => ({
            phone,
            discount: (this._data._clients[phone] || {}).discount || 0,
            notes: (this._data._clients[phone] || {}).notes || '',
            visits: (stats[phone] || {}).visits || 0,
            total_spend: (stats[phone] || {}).total_spend || 0,
            last_visit: (stats[phone] || {}).last_visit || 0
        })).sort((a, b) => b.visits - a.visits);
    }
};

DB.initDB();

async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function printReceipt(orderShortId, datetime, items, phone, discountPct, globalRules) {
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
<title>Билет №${orderShortId}</title>
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
  <div class="info">${dateStr} &nbsp; Билет №${orderShortId}</div>
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
