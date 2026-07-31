// Api 介面（mock/cloud 同介面）：auth/getAll/submitAudit/markRest —— 全部回 Promise
// MODE 讀 Config.MODE：'local' 用 mock 實作（種子＋localStorage overlay）；'cloud' 打 GAS_URL
// 同時支援瀏覽器（掛 window.Api）與 node（module.exports，node 下用記憶體 shim 取代 localStorage）

(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;

  var Format = isNode ? require('./format.js') : root.Format;
  var MockData = isNode ? require('./mock-data.js') : root.MockData;

  // ---- localStorage：瀏覽器用原生，node 下用記憶體 shim（測試才跑得動）----
  var memoryStore = {};
  var storage;
  if (typeof localStorage !== 'undefined') {
    storage = localStorage;
  } else {
    storage = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
      },
      setItem: function (key, value) {
        memoryStore[key] = String(value);
      },
      removeItem: function (key) {
        delete memoryStore[key];
      }
    };
  }

  var DB_KEY = 'mockdb_v1';

  function loadOverlay() {
    var raw = storage.getItem(DB_KEY);
    if (!raw) return { records: {}, details: {} };
    try {
      var parsed = JSON.parse(raw);
      return {
        records: parsed.records || {},
        details: parsed.details || {}
      };
    } catch (e) {
      return { records: {}, details: {} };
    }
  }

  function saveOverlay(overlay) {
    storage.setItem(DB_KEY, JSON.stringify(overlay));
  }

  function getMode() {
    if (typeof root !== 'undefined' && root.Config && root.Config.MODE) {
      return root.Config.MODE;
    }
    return 'local';
  }

  function getGasUrl() {
    return (typeof root !== 'undefined' && root.Config && root.Config.GAS_URL) || '';
  }

  function checkCode(code) {
    if (code === MockData.passcodes.accountant) return 'accountant';
    if (code === MockData.passcodes.viewer) return 'viewer';
    return null;
  }

  // ---- mock 實作 ----

  function mockAuth(code) {
    var role = checkCode(code);
    if (!role) return { ok: false };
    return { ok: true, role: role };
  }

  function mockGetAll(code) {
    var role = checkCode(code);
    if (!role) return { ok: false };

    var overlay = loadOverlay();

    // records：種子 map + overlay 覆蓋同 key（覆蓋語意＝取代該筆）
    var recordMap = {};
    MockData.records.forEach(function (r) { recordMap[r.record_key] = r; });
    Object.keys(overlay.records).forEach(function (k) { recordMap[k] = overlay.records[k]; });
    var records = Object.keys(recordMap).map(function (k) { return recordMap[k]; });

    // details：overlay 有的 record_key 整組取代種子該 key 的舊列（先刪後寫）
    var overlayKeys = Object.keys(overlay.details);
    var seedDetails = MockData.details.filter(function (d) {
      return overlayKeys.indexOf(d.record_key) === -1;
    });
    var overlayDetails = [];
    overlayKeys.forEach(function (k) {
      overlayDetails = overlayDetails.concat(overlay.details[k]);
    });
    var details = seedDetails.concat(overlayDetails);

    return {
      ok: true,
      config: MockData.config,
      items: MockData.items,
      records: records,
      details: details
    };
  }

  function mockSubmitAudit(code, record, details) {
    if (code !== MockData.passcodes.accountant) return { ok: false };
    var overlay = loadOverlay();
    var key = (record && record.record_key) || Format.recordKey(record.store, record.month);
    record.record_key = key;
    overlay.records[key] = record;
    overlay.details[key] = (details || []).map(function (d) {
      d.record_key = key;
      return d;
    });
    saveOverlay(overlay);
    return { ok: true, record_key: key };
  }

  function mockMarkRest(code, store, month) {
    if (code !== MockData.passcodes.accountant) return { ok: false };
    var overlay = loadOverlay();
    var key = Format.recordKey(store, month);
    var day = month + '-05';
    var record = {
      record_key: key,
      store: store,
      month: month,
      status: '輪休',
      audit_date: day,
      sample_count: '',
      correct_count: '',
      correct_rate: '',
      change_fund: '',
      petty_cash: '',
      tip_amount: '',
      tip_match: '',
      anomaly_text: '',
      note: '',
      submitted_at: day + 'T10:00:00+08:00'
    };
    overlay.records[key] = record;
    overlay.details[key] = [];
    saveOverlay(overlay);
    return { ok: true };
  }

  // ---- cloud 實作：同介面打 GAS_URL ----

  function cloudCall(action, payload) {
    var url = getGasUrl();
    var body = { action: action };
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  var Api = {
    auth: function (code) {
      return new Promise(function (resolve) {
        if (getMode() === 'cloud') {
          resolve(cloudCall('auth', { code: code }));
        } else {
          resolve(mockAuth(code));
        }
      });
    },
    getAll: function (code) {
      return new Promise(function (resolve) {
        if (getMode() === 'cloud') {
          resolve(cloudCall('getAll', { code: code }));
        } else {
          resolve(mockGetAll(code));
        }
      });
    },
    submitAudit: function (code, record, details) {
      return new Promise(function (resolve) {
        if (getMode() === 'cloud') {
          resolve(cloudCall('submitAudit', { code: code, record: record, details: details }));
        } else {
          resolve(mockSubmitAudit(code, record, details));
        }
      });
    },
    markRest: function (code, store, month) {
      return new Promise(function (resolve) {
        if (getMode() === 'cloud') {
          resolve(cloudCall('markRest', { code: code, store: store, month: month }));
        } else {
          resolve(mockMarkRest(code, store, month));
        }
      });
    }
  };

  if (isNode) {
    module.exports = Api;
  } else {
    root.Api = Api;
  }
})(typeof window !== 'undefined' ? window : this);
