// 稽核系統共用格式化純函式（spec.md §5 逐字元契約）
// 同時支援瀏覽器（掛 window.Format）與 node（module.exports）

(function (root) {
  'use strict';

  var MONTH_LABELS = {
    '01': '一月', '02': '二月', '03': '三月', '04': '四月',
    '05': '五月', '06': '六月', '07': '七月', '08': '八月',
    '09': '九月', '10': '十月', '11': '十一月', '12': '十二月'
  };

  // recordKey('sxl-gf', '2026-08') → 'sxl-gf_2026-08'
  function recordKey(store, month) {
    return store + '_' + month;
  }

  // monthLabel('2026-08') → '八月'
  function monthLabel(month) {
    var mm = String(month).split('-')[1];
    return MONTH_LABELS[mm] || '';
  }

  // correctRate(19, 20) → 95（四捨五入整數）
  function correctRate(correct, total) {
    if (!total) return 0;
    return Math.round((correct / total) * 100);
  }

  // buildAnomalyText(details) → 只取 verdict==='異常' 的項，依傳入順序編號
  // 格式：{序號}.{品項}:盤點{盤點數}{單位}，覆盤{複盤數}{單位}，多筆以 '\n' 連接
  function buildAnomalyText(details) {
    var list = (details || []).filter(function (d) {
      return d.verdict === '異常';
    });
    var lines = list.map(function (d, i) {
      return (i + 1) + '.' + d.item + ':盤點' + d.book_qty + d.unit +
        '，覆盤' + d.recount_qty + d.unit;
    });
    return lines.join('\n');
  }

  var Format = {
    recordKey: recordKey,
    monthLabel: monthLabel,
    correctRate: correctRate,
    buildAnomalyText: buildAnomalyText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Format;
  } else {
    root.Format = Format;
  }
})(typeof window !== 'undefined' ? window : this);
