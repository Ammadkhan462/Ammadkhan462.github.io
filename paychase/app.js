/* PayChase website - small vanilla JS: nav toggle, copy buttons, late payment calculators.
   No tracking, no network requests. Pure functions are exported for Node testing at the bottom. */
(function (root) {
  'use strict';

  var MS_PER_DAY = 86400000;

  /* ---------- Pure helpers (testable) ---------- */

  // Parse "YYYY-MM-DD" into a UTC day number (avoids timezone / DST off-by-one errors).
  function parseISODate(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d);
    var check = new Date(t);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return Math.round(t / MS_PER_DAY);
  }

  // Whole days from dueDate to asOfDate; 0 if not yet late.
  function daysLate(dueISO, asOfISO) {
    var a = parseISODate(dueISO), b = parseISODate(asOfISO);
    if (a === null || b === null) return null;
    return Math.max(0, b - a);
  }

  // Simple (non-compounding) daily interest: debt x annual rate / 365 x days.
  function simpleInterest(debt, annualRatePct, days) {
    return debt * (annualRatePct / 100) / 365 * days;
  }

  // UK fixed compensation under the Late Payment of Commercial Debts (Interest) Act 1998.
  function ukCompensation(debt) {
    if (!(debt > 0)) return 0;
    if (debt < 1000) return 40;
    if (debt < 10000) return 70;
    return 100;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function calcUK(input) {
    var debt = Number(input.debt), base = Number(input.baseRate);
    if (!(debt > 0)) return { error: 'Enter the unpaid invoice amount.' };
    if (!isFinite(base) || base < 0) return { error: 'Enter the Bank of England base rate (0 or more).' };
    var days = daysLate(input.dueDate, input.asOfDate);
    if (days === null) return { error: 'Enter a valid due date and calculation date.' };
    var rate = 8 + base;
    var interest = round2(simpleInterest(debt, rate, days));
    var comp = days > 0 ? ukCompensation(debt) : 0;
    return {
      days: days, rate: round2(rate),
      dailyInterest: round2(simpleInterest(debt, rate, 1)),
      interest: interest, compensation: comp,
      total: round2(debt + interest + comp),
      claimable: round2(interest + comp)
    };
  }

  function calcEU(input) {
    var debt = Number(input.debt), ref = Number(input.refRate), margin = Number(input.margin);
    var comp = Number(input.compensation);
    if (!(debt > 0)) return { error: 'Enter the unpaid invoice amount.' };
    if (!isFinite(ref)) return { error: 'Enter the ECB reference rate.' };
    if (!isFinite(margin) || margin < 8) return { error: 'The Directive margin is at least 8 percentage points.' };
    if (!isFinite(comp) || comp < 40) return { error: 'Fixed compensation is at least €40.' };
    var days = daysLate(input.dueDate, input.asOfDate);
    if (days === null) return { error: 'Enter a valid due date and calculation date.' };
    var rate = Math.max(0, ref + margin);
    var interest = round2(simpleInterest(debt, rate, days));
    var c = days > 0 ? comp : 0;
    return {
      days: days, rate: round2(rate),
      dailyInterest: round2(simpleInterest(debt, rate, 1)),
      interest: interest, compensation: c,
      total: round2(debt + interest + c),
      claimable: round2(interest + c)
    };
  }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function money(n, symbol) {
    var s = Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return symbol + s;
  }

  var api = {
    parseISODate: parseISODate, daysLate: daysLate, simpleInterest: simpleInterest,
    ukCompensation: ukCompensation, calcUK: calcUK, calcEU: calcEU, round2: round2
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof document === 'undefined') return;

  /* ---------- Browser behaviour ---------- */

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      // Fall back to the legacy method if the async API is blocked (permissions, embedded views).
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function announce(msg) {
    var live = document.getElementById('live-region');
    if (live) { live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); }
  }

  function initCopyButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.copy-btn') : null;
      if (!btn) return;
      var target = btn.getAttribute('data-copy-target');
      var el = target ? document.querySelector(target)
        : (btn.closest('.tpl') && btn.closest('.tpl').querySelector('.tpl-text'));
      if (!el) return;
      var text = (el.value !== undefined && el.tagName === 'TEXTAREA') ? el.value : el.innerText.trim();
      var original = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', original);
      clearTimeout(btn._t);
      copyText(text).then(function () {
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        announce('Copied to clipboard');
        btn._t = setTimeout(function () { btn.textContent = original; btn.classList.remove('copied'); }, 1800);
      }, function () {
        btn.textContent = 'Copy failed - select the text';
        announce('Copy failed. Please select the text and copy it manually.');
        btn._t = setTimeout(function () { btn.textContent = original; }, 3000);
      });
    });
  }

  /* Header: glassy background + shrink once the page scrolls. */
  function initHeader() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var ticking = false, last = null;
    function update() {
      ticking = false;
      var s = window.scrollY > 12;
      if (s !== last) { header.classList.toggle('scrolled', s); last = s; }
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    var header = document.querySelector('.site-header');
    if (!toggle || !nav) return;
    function set(open) {
      nav.classList.toggle('open', open);
      if (header) header.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () { set(!nav.classList.contains('open')); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); toggle.focus(); }
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !e.target.closest('.site-header')) set(false);
    });
    window.addEventListener('resize', function () { if (window.innerWidth >= 900) set(false); });
  }

  /* Scroll reveal: fade + rise, staggered with --i. */
  function initReveal() {
    var els = [].slice.call(document.querySelectorAll('.reveal'));
    if (!els.length) return;
    function done(el) {
      el.classList.add('in');
      // After the entrance finishes, hand transitions back to hover effects.
      setTimeout(function () { el.classList.add('done'); }, 900 + (parseInt(el.style.getPropertyValue('--i'), 10) || 0) * 80);
    }
    if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(done); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { done(en.target); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* Count-up for numbers. Element text is the final value, so no-JS and reduced motion stay correct. */
  function countTo(el, to, opts) {
    opts = opts || {};
    var from = opts.from || 0, dur = opts.duration || 1200, dec = opts.decimals || 0;
    var fmt = opts.format || function (n) {
      return n.toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    };
    if (el._raf) cancelAnimationFrame(el._raf);
    if (el._done) clearTimeout(el._done);
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    // Browsers pause animation frames in background tabs; this guarantees the
    // final, correct value is always shown.
    el._done = setTimeout(function () {
      if (el._raf) cancelAnimationFrame(el._raf);
      el.textContent = fmt(to);
    }, dur + 120);
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(step);
    }
    el._raf = requestAnimationFrame(step);
  }

  function initCountUps() {
    [].forEach.call(document.querySelectorAll('[data-countup]'), function (el) {
      var to = parseFloat(el.getAttribute('data-countup'));
      setTimeout(function () { countTo(el, to, { duration: 1600 }); }, 350);
    });
  }

  /* Landing page: live language / tone demo. Text comes from the app's stage 1 templates. */
  var DEMO = {
    en: { dir: 'ltr', lang: 'en', name: 'Sara',
      friendly: 'Hi Sara,\n\nJust a friendly heads-up that invoice INV-1042 for $1,200 is due on 15 Nov.\n\nThanks so much!\nAli',
      professional: 'Hello Sara,\n\nThis is a quick reminder that invoice INV-1042 for the website redesign, totalling $1,200, is due on 15 Nov.\n\nPlease let me know if you need anything from my side.\n\nBest regards,\nAli',
      firm: 'Hello Sara,\n\nInvoice INV-1042 for $1,200 is due on 15 Nov. Please make sure the payment is made on or before this date.\n\nRegards,\nAli' },
    ru: { dir: 'ltr', lang: 'ur-Latn', name: 'Sara',
      friendly: 'Assalam o Alaikum Sara,\n\nUmeed hai aap khairiyat se honge. Bas yaad dilana tha ke invoice INV-1042 ($1,200) ki payment 15 Nov ko due hai.\n\nBohat shukriya!\nAli',
      professional: 'Assalam o Alaikum Sara,\n\nAap ko yaad dilana maqsood hai ke website redesign ki invoice INV-1042, raqam $1,200, ki due date 15 Nov hai.\n\nKisi bhi maloomat ke liye bila jhijhak rabta kijiye.\n\nShukriya,\nAli',
      firm: 'Assalam o Alaikum Sara,\n\nInvoice INV-1042 ki raqam $1,200 15 Nov ko due hai. Meharbani kar ke payment is tareekh tak ya is se pehle kar dein.\n\nShukriya,\nAli' },
    ur: { dir: 'rtl', lang: 'ur', name: 'سارہ',
      friendly: 'السلام علیکم سارہ،\n\nامید ہے آپ خیریت سے ہوں گے۔ بس یاد دلانا تھا کہ انوائس INV-1042 ($1,200) کی ادائیگی کی تاریخ 15 نومبر ہے۔\n\nبہت شکریہ!\nعلی',
      professional: 'السلام علیکم سارہ،\n\nآپ کو یاد دلانا مقصود ہے کہ ویب سائٹ ری ڈیزائن کی انوائس INV-1042، رقم $1,200، کی ادائیگی کی آخری تاریخ 15 نومبر ہے۔\n\nکسی بھی معلومات کے لیے بلا جھجھک رابطہ کیجیے۔\n\nشکریہ،\nعلی',
      firm: 'السلام علیکم سارہ،\n\nانوائس INV-1042 کی رقم $1,200 کی ادائیگی 15 نومبر کو واجب ہے۔ براہِ کرم ادائیگی اس تاریخ تک یا اس سے پہلے یقینی بنائیں۔\n\nشکریہ،\nعلی' },
    hi: { dir: 'ltr', lang: 'hi', name: 'सारा',
      friendly: 'नमस्ते सारा,\n\nउम्मीद है आप ठीक होंगे। बस याद दिलाना था कि इनवॉइस INV-1042 ($1,200) की पेमेंट 15 नवंबर को ड्यू है।\n\nबहुत शुक्रिया!\nअली',
      professional: 'नमस्ते सारा,\n\nयह याद दिलाने के लिए है कि वेबसाइट रीडिज़ाइन की इनवॉइस INV-1042, राशि $1,200, की भुगतान तिथि 15 नवंबर है।\n\nकोई जानकारी चाहिए हो तो बेझिझक बताइए।\n\nधन्यवाद,\nअली',
      firm: 'नमस्ते सारा,\n\nइनवॉइस INV-1042 की राशि $1,200 का भुगतान 15 नवंबर तक होना है। कृपया पक्का करें कि भुगतान इस तारीख़ तक या उससे पहले हो जाए।\n\nधन्यवाद,\nअली' },
    ar: { dir: 'rtl', lang: 'ar', name: 'سارة',
      friendly: 'مرحباً سارة،\n\nأتمنى أن تكونوا بخير. تذكير بسيط بأن الفاتورة INV-1042 بمبلغ $1,200 مستحقة في 15 نوفمبر.\n\nشكراً جزيلاً!\nعلي',
      professional: 'السلام عليكم سارة،\n\nأود تذكيركم بأن الفاتورة INV-1042 الخاصة بمشروع إعادة تصميم الموقع، بمبلغ $1,200، تستحق السداد في 15 نوفمبر.\n\nيسعدني الرد على أي استفسار.\n\nمع خالص التحية،\nعلي',
      firm: 'السلام عليكم سارة،\n\nتستحق الفاتورة INV-1042 بمبلغ $1,200 السداد في 15 نوفمبر. يرجى التأكد من إتمام الدفع في هذا الموعد أو قبله.\n\nمع التحية،\nعلي' }
  };

  function initDemo() {
    var root = document.querySelector('[data-demo]');
    if (!root) return;
    var msg = root.querySelector('[data-msg]');
    var nameEl = root.querySelector('.chat-head b');
    var state = { lang: 'en', tone: 'friendly' };
    var ticks = '<span class="wa-meta" aria-hidden="true">10:24 <svg viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5.5l3 3L10.5 1.5M6.5 8.5L14.5 1.5"/></svg></span>';
    function render(animate) {
      var d = DEMO[state.lang];
      function apply() {
        msg.textContent = d[state.tone];
        msg.insertAdjacentHTML('beforeend', ticks);
        msg.setAttribute('dir', d.dir);
        msg.setAttribute('lang', d.lang);
        if (nameEl) nameEl.textContent = d.name;
        msg.classList.remove('swap');
      }
      if (!animate || reduceMotion) { apply(); return; }
      msg.classList.add('swap');
      setTimeout(apply, 160);
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      var group = b.closest('[data-group]');
      var key = group.getAttribute('data-group');
      if (state[key] === b.getAttribute('data-v')) return;
      [].forEach.call(group.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      state[key] = b.getAttribute('data-v');
      render(true);
    });
    render(false);
  }

  /* Templates page: language tabs + stage / tone filters. Without JS every template simply shows. */
  function initTemplates() {
    var bar = document.querySelector('.tpl-toolbar');
    if (!bar) return;
    bar.hidden = false;
    var tabs = [].slice.call(bar.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) {
      var p = document.getElementById(t.getAttribute('aria-controls'));
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', t.id);
      return p;
    });
    var count = document.getElementById('tpl-count');
    var filter = { stage: 'all', tone: 'all' };

    // Tag every template card with its stage and tone (derived from the existing markup).
    panels.forEach(function (p) {
      [].forEach.call(p.querySelectorAll('.stage'), function (st, i) {
        st.setAttribute('data-stage', String(i + 1));
        [].forEach.call(st.querySelectorAll('.tpl'), function (c) {
          var tone = (c.querySelector('.tpl-tone') || {}).textContent || '';
          c.setAttribute('data-tone', tone.trim().toLowerCase());
        });
      });
    });

    function apply() {
      var shown = 0;
      panels.forEach(function (p) {
        if (p.hidden) return;
        [].forEach.call(p.querySelectorAll('.stage'), function (st) {
          var okStage = filter.stage === 'all' || st.getAttribute('data-stage') === filter.stage;
          var any = 0;
          [].forEach.call(st.querySelectorAll('.tpl'), function (c) {
            var ok = okStage && (filter.tone === 'all' || c.getAttribute('data-tone') === filter.tone);
            c.hidden = !ok; if (ok) any++;
          });
          st.hidden = !any; shown += any;
        });
      });
      if (count) count.textContent = 'Showing ' + shown + (shown === 1 ? ' template' : ' templates');
    }

    function select(tab, focus) {
      tabs.forEach(function (t, i) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
        if (on && !reduceMotion) { panels[i].classList.remove('panel-in'); void panels[i].offsetWidth; panels[i].classList.add('panel-in'); }
      });
      if (focus) tab.focus();
      apply();
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') n = tabs[0];
        else if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });

    [].forEach.call(bar.querySelectorAll('.chips'), function (group) {
      var key = group.getAttribute('data-filter');
      group.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        [].forEach.call(group.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        filter[key] = b.getAttribute('data-v');
        apply();
      });
    });

    // Deep links such as #roman-urdu or #en-final open the right tab.
    function fromHash() {
      var id = location.hash.slice(1);
      if (!id) return false;
      var target = document.getElementById(id);
      if (!target) return false;
      for (var i = 0; i < panels.length; i++) {
        if (panels[i] === target || panels[i].contains(target)) {
          select(tabs[i]);
          if (panels[i] !== target) target.scrollIntoView();
          return true;
        }
      }
      return false;
    }
    window.addEventListener('hashchange', fromHash);
    if (!fromHash()) select(tabs[0]);
  }

  function val(form, name) { var el = form.elements[name]; return el ? el.value : ''; }

  function setOut(form, key, text) {
    var scope = form.parentNode;
    var els = scope.querySelectorAll('[data-out="' + key + '"]');
    if (!els.length) els = document.querySelectorAll('[data-out="' + key + '"]');
    [].forEach.call(els, function (el) { el.textContent = text; });
  }

  function initCalculator(formId, kind) {
    var form = document.getElementById(formId);
    if (!form) return;
    var symbol = kind === 'uk' ? '£' : '€';
    var asOf = form.elements['asOfDate'];
    var useToday = form.elements['useToday'];
    var hero = form.parentNode.querySelector('[data-hero]');
    var lastHero = 0;
    if (asOf && !asOf.value) asOf.value = todayISO();

    function syncToday() {
      if (!useToday || !asOf) return;
      if (useToday.checked) { asOf.value = todayISO(); asOf.disabled = true; }
      else { asOf.disabled = false; }
    }

    function showHero(n) {
      if (!hero) return;
      if (n === null) { if (hero._raf) cancelAnimationFrame(hero._raf); if (hero._done) clearTimeout(hero._done); hero.textContent = '—'; lastHero = 0; return; }
      countTo(hero, n, { from: lastHero, duration: 700, decimals: 2, format: function (v) { return money(v, symbol); } });
      lastHero = n;
    }

    function run() {
      syncToday();
      var input = {
        debt: val(form, 'debt'), dueDate: val(form, 'dueDate'),
        asOfDate: useToday && useToday.checked ? todayISO() : val(form, 'asOfDate')
      };
      var r;
      if (kind === 'uk') { input.baseRate = val(form, 'baseRate'); r = calcUK(input); }
      else {
        input.refRate = val(form, 'refRate'); input.margin = val(form, 'margin');
        input.compensation = val(form, 'compensation'); r = calcEU(input);
      }
      var err = document.getElementById(formId + '-error');
      var msgBox = document.getElementById(formId + '-message');
      if (r.error) {
        if (err) err.textContent = r.error;
        ['days', 'rate', 'daily', 'interest', 'compensation', 'claimable', 'total'].forEach(function (k) { setOut(form, k, '—'); });
        showHero(null);
        if (msgBox) msgBox.value = '';
        return;
      }
      if (err) err.textContent = '';
      setOut(form, 'days', r.days + (r.days === 1 ? ' day' : ' days'));
      setOut(form, 'rate', r.rate.toFixed(2) + '% a year');
      setOut(form, 'daily', money(r.dailyInterest, symbol));
      setOut(form, 'interest', money(r.interest, symbol));
      setOut(form, 'compensation', money(r.compensation, symbol));
      setOut(form, 'claimable', money(r.claimable, symbol));
      setOut(form, 'total', money(r.total, symbol));
      showHero(r.claimable);

      if (msgBox) {
        var ref = val(form, 'invoiceRef').trim() || '[invoice number]';
        var debtStr = money(Number(input.debt), symbol);
        var msg;
        if (r.days === 0) {
          msg = 'Invoice ' + ref + ' (' + debtStr + ') is not overdue yet, so no late payment interest applies.';
        } else if (kind === 'uk') {
          msg = 'Invoice ' + ref + ' for ' + debtStr + ' is now ' + r.days + ' days overdue. Under the Late Payment of Commercial Debts (Interest) Act 1998, statutory interest of ' +
            money(r.interest, symbol) + ' (' + r.rate.toFixed(2) + '% a year) and fixed compensation of ' + money(r.compensation, symbol) +
            ' can be added, bringing the total due to ' + money(r.total, symbol) + '. Please let me know when payment will be made.';
        } else {
          msg = 'Invoice ' + ref + ' for ' + debtStr + ' is now ' + r.days + ' days overdue. Under the EU Late Payment Directive (2011/7/EU) as applied by national law, late payment interest of ' +
            money(r.interest, symbol) + ' (' + r.rate.toFixed(2) + '% a year) and fixed compensation of ' + money(r.compensation, symbol) +
            ' can be added, bringing the total due to ' + money(r.total, symbol) + '. Please let me know when payment will be made.';
        }
        msgBox.value = msg;
      }
    }

    form.addEventListener('input', run);
    form.addEventListener('change', run);
    form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    run();
  }

  function init() {
    initHeader();
    initNav();
    initCopyButtons();
    initReveal();
    initCountUps();
    initDemo();
    initTemplates();
    initCalculator('uk-calc', 'uk');
    initCalculator('eu-calc', 'eu');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(this);
