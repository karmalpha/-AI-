/* AI酒馆 smoke test: minimal DOM stub, run all inline scripts, exercise main flows */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'AI酒馆.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

/* ---------- DOM stubs ---------- */
function makeEl(sel) {
  const listeners = {};
  const el = {
    sel, dataset: {}, style: {}, classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    value: '', textContent: '', title: '', disabled: false, size: 2,
    innerHTML: '', className: '', type: '', placeholder: '', checked: false,
    selectedOptions: [], files: [],
    offsetWidth: 0, scrollTop: 0, scrollHeight: 0,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    appendChild(c) { return c; },
    remove() {},
    click() { (listeners['click'] || []).forEach(f => f({ target: el, preventDefault(){} })); },
    focus() {}, scrollIntoView() {}, closest() { return null; },
    querySelector(s) { return qs('inner:' + s); },
    querySelectorAll() { return []; },
  };
  return el;
}
const cache = new Map();
function qs(sel) { if (!cache.has(sel)) cache.set(sel, makeEl(sel)); return cache.get(sel); }
function qsa(sel) { return []; }

global.document = {
  querySelector: qs, querySelectorAll: qsa,
  documentElement: { setAttribute() {} },
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') global.__domReady = fn; },
  createElement() { return makeEl('created'); },
  body: { appendChild() {}, setAttribute() {} },
};
global.window = { __tavern: null, scrollTo() {}, addEventListener() {} };
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; },
};
global.confirm = () => true;
global.prompt = () => '测试';
global.alert = () => {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.setTimeout = (fn) => { fn(); return 0; };
global.navigator = { clipboard: null };

/* 模拟 API 响应：SSE 流式 或 非流式 JSON */
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  const msg = (body.messages || []).map(m => m.content).join(' ');
  const replyText = '这是AI的测试回复。';
  const enc = new TextEncoder();
  if (msg.includes('__nostream__')) {
    return { ok: true, body: null, headers: { get: () => '' },
      text: async () => JSON.stringify({ choices: [{ message: { content: '非流式回复内容' } }] }) };
  }
  const chunks = [
    'data: {"choices":[{"delta":{"content":"这是AI"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"的测试回复。"}}]}\n\n',
    'data: [DONE]\n\n'
  ];
  return {
    ok: true, headers: { get: () => 'text/event-stream' },
    body: { getReader() { let i = 0; return { read() { if (i < chunks.length) return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) }); return Promise.resolve({ done: true }); } }; } },
  };
};

const errors = [];
process.on('uncaughtException', e => { errors.push('uncaught: ' + e.message); });

(async () => {
  // 预置 v1 旧版数据（键前缀 tavern_），验证自动迁移
  global.localStorage._d['tavern_characters'] = JSON.stringify([
    { id: 'v1c1', name: '旧版战士', system: 'dnd5e', status: 'alive', race: '人类', class: '战士', level: 2, stats: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 8 } },
    { id: 'v1c2', name: '旧版调查员', system: 'coc7', status: 'alive', race: '', class: '侦探', level: 1, stats: { coc_str: 50, coc_siz: 60 } },
  ]);
  global.localStorage._d['tavern_adventures'] = JSON.stringify([
    { id: 'v1adv', name: '旧版自建团', desc: '迁移测试', system: 'dnd5e', players: 3, scenes: [], monsters: [] },
  ]);
  global.localStorage._d['tavern_apiKey'] = 'sk-legacy-test-key';

  try { eval(scripts.join('\n')); }
  catch (e) { errors.push(`脚本执行异常: ${e.message}`); }
  try { global.__domReady(); } catch (e) { errors.push('init 异常: ' + e.message); }

  const T = global.window.__tavern;
  if (!T) { errors.push('window.__tavern 未暴露'); }
  else {
    const S = T.S;
    try {
      // ===== v1 迁移（旧版存档遗留问题）=====
      if (!S.characters.some(c => c.id === 'v1c1')) errors.push('v1 角色未迁移');
      if (!S.adventures.some(a => a.id === 'v1adv')) errors.push('v1 团本未迁移');
      if (S.api.key !== 'sk-legacy-test-key') errors.push('v1 API Key 未迁移: ' + S.api.key);
      // 保证后续测试有预设团本
      if (!S.adventures.some(a => a.id === 'adv_yysl')) S.adventures.push(...T.PRESET_ADVENTURES.map(x => JSON.parse(JSON.stringify(x))));
      // ===== 属性/计算算法 =====
      const d = T.dndCalc({ class: '法师', level: 3, stats: { str: 10, dex: 14, con: 12, int: 16, wis: 13, cha: 8 }, skills: ['奥秘'], spells: ['魔法飞弹'] });
      if (d.pb !== 2) errors.push('dndCalc pb 错误: ' + d.pb);
      if (d.spellDC !== 13) errors.push('dndCalc spellDC 错误: ' + d.spellDC);
      if (d.skills['奥秘'] !== 5) errors.push('dndCalc skill 错误: ' + d.skills['奥秘']);
      if (d.slots[2] !== 2) errors.push('dndCalc slots 错误: ' + JSON.stringify(d.slots));
      const c = T.cocCalc({ class: '私家侦探', age: 20, stats: { str: 50, con: 50, siz: 60, dex: 55, app: 60, int: 65, pow: 70, edu: 70 } });
      if (c.hp !== 11) errors.push('cocCalc hp 错误: ' + c.hp);
      if (c.mp !== 70) errors.push('cocCalc mp 错误: ' + c.mp);
      // 官方职业点公式：私家侦探 = 教育×2 + 取高(外貌/敏捷)×2 = 140+120 = 260
      if (c.occPts !== 260) errors.push('cocCalc occPts 错误: ' + c.occPts + ' (应为260)');
      if (c.intPts !== 130) errors.push('cocCalc intPts 错误: ' + c.intPts);
      if (T.occPtsCalc('EDU*4', { edu: 70 }) !== 280) errors.push('occPtsCalc EDU*4 错误');
      if (T.occPtsCalc('EDU*2+MAX(STR|DEX)*2', { edu: 70, str: 50, dex: 55 }) !== 250) errors.push('occPtsCalc MAX 公式错误');
      if (!T.occPtsDisplay('EDU*2+MAX(STR|DEX)*2').includes('取高(力量/敏捷)')) errors.push('occPtsDisplay 错误');
      if (c.credit !== '9-30' && c.credit !== undefined) {} // 信用范围在数据里，由向导显示
      if (!T.COC_OCCUPATIONS['会计师'] || T.COC_OCCUPATIONS['会计师'].credit !== '30-70') errors.push('官方职业表未生效');
      if (Object.keys(T.COC_OCCUPATIONS).length < 100) errors.push('官方职业表数量过少: ' + Object.keys(T.COC_OCCUPATIONS).length);
      const r = T.parseDice('2d6+3');
      if (!r || r.total < 5 || r.total > 15 || r.rolls.length !== 2) errors.push('parseDice 错误');
      const md = T.mdRender('# 标题\n**粗体**');
      if (!md.includes('<h1>') || !md.includes('<b>')) errors.push('mdRender 错误');

      // ===== 向导同步（bug#1: 选法师Lv5 不应显示"战士Lv1 不施法"）=====
      qs('#cf_system').value = 'dnd5e';
      T.openWizard(null);
      qs('#cf_class').value = '法师';
      qs('#cf_level').value = '5';
      qs('#cf_race').value = '精灵';
      T.wizRender(3);
      const slotInfo = qs('#spellSlotInfo').innerHTML;
      if (!slotInfo.includes('法师') || slotInfo.includes('不施法')) errors.push('向导职业同步错误: ' + slotInfo.slice(0,60));
      // 自定义系统
      qs('#cf_system').value = 'custom';
      T.wizRender(3);
      if (qs('#wzCustomClass').classList.contains('hidden')) errors.push('自定义系统第3步未显示自定义栏');
      T.wizRender(1);

      // ===== 法术上限：戏法与 1环+ 分开计数（bug: 4级法师被限制为总共4个）=====
      const w4 = T.dndCalc({ class: '法师', level: 4, stats: { str:10, dex:10, con:10, int:16, wis:10, cha:10 }, spells: [] });
      if (w4.known !== 7) errors.push('4级法师(INT16) 可准备法术应为7: ' + w4.known);
      if (w4.cantripMax !== 4) errors.push('4级法师戏法上限应为4: ' + w4.cantripMax);
      qs('#cf_system').value = 'dnd5e';
      T.openWizard(null);
      qs('#cf_class').value = '法师';
      qs('#cf_level').value = '4';
      qs('#cf_race').value = '精灵';
      T.wizRender(3);
      const si = qs('#spellSlotInfo').innerHTML;
      if (!si.includes('戏法上限 4') || !si.includes('可准备/已知 4')) errors.push('法术上限文案错误: ' + si.slice(0,90));
      // 自定义职业：可填写 + 施法者开关
      qs('#cf_class').value = '自定义';
      qs('#cf_class_custom_dnd').value = '魔剑士';
      T.wizRender(3);
      if (qs('#customCasterBox').classList.contains('hidden')) errors.push('自定义职业未显示施法者开关');
      qs('#cf_custom_caster').checked = true;
      if (typeof qs('#cf_custom_caster').onchange === 'function') qs('#cf_custom_caster').onchange();
      const calcBox = qs('#dndClassCalc').innerHTML;
      if (!calcBox.includes('法术DC')) errors.push('自定义施法者未生效: ' + calcBox.slice(0,80));
      // 自定义种族 / 自定义头像
      qs('#cf_race').value = '自定义';
      qs('#cf_race_custom_dnd').value = '猫人族';
      qs('#cf_avatar').value = '自定义';
      qs('#cf_avatar_custom').value = '🐉';
      T.wizRender(5);
      const prev = qs('#wizardPreview').innerHTML;
      if (!prev.includes('猫人族')) errors.push('自定义种族未生效');
      if (!prev.includes('🐉')) errors.push('自定义头像未生效');
      // 子职业选择
      qs('#cf_class').value = '法师';
      T.wizRender(3);
      qs('#cf_subclass').value = '防护学派';
      if (typeof qs('#cf_subclass').onchange === 'function') qs('#cf_subclass').onchange();
      T.wizRender(5);
      const prev2 = qs('#wizardPreview').innerHTML;
      if (!prev2.includes('防护学派')) errors.push('子职业未生效');
      // 性别
      qs('#cf_gender').value = '女';
      T.wizRender(5);
      if (!qs('#wizardPreview').innerHTML.includes('性别 女')) errors.push('性别未生效');
      // 头像锁定修复：自定义输入清空后不应回退成 🧙
      qs('#cf_avatar').value = '自定义';
      qs('#cf_avatar_custom').value = '🐉';
      T.wizRender(5);
      if (!qs('#wizardPreview').innerHTML.includes('🐉')) errors.push('自定义头像未生效');
      qs('#cf_avatar_custom').value = '';
      T.wizRender(1);
      if (qs('#cf_avatar').value !== '自定义') errors.push('头像模式被重置: ' + qs('#cf_avatar').value);
      T.wizRender(5);
      if (!qs('#wizardPreview').innerHTML.includes('🐉')) errors.push('自定义头像被锁回默认');
      // 自定义性别
      qs('#cf_gender').value = '自定义';
      qs('#cf_gender_custom').value = '无性别（灵体）';
      T.wizRender(5);
      if (!qs('#wizardPreview').innerHTML.includes('无性别')) errors.push('自定义性别未生效');

      // ===== 角色与团本 =====
      S.characters.push({ id: 'c1', name: '测试法师卡尔', system: 'dnd5e', status: 'alive', avatar: '🧙', race: '精灵', class: '法师', level: 5, xp: 0,
        stats: { str: 10, dex: 14, con: 12, int: 16, wis: 13, cha: 8 }, statsBase: { str: 10, dex: 14, con: 12, int: 16, wis: 13, cha: 8 },
        skills: ['奥秘'], spells: ['魔法飞弹', '护盾术'], weapons: [{ n: '法师杖', dice: '1d6', prop: '钝击' }], hpMax: 20, hpCur: 20 });
      qs('#tableAdventure').value = 'adv_yysl';
      qs('#tableChars').selectedOptions = [{ value: 'c1' }];
      T.startTable();
      if (!S.table) errors.push('startTable 未创建会话');
      else {
        // 本地模式回复
        const before = S.table.messages.length;
        S.api.key = '';
        await T.askAI('我推开石门走进去', 'send');
        if (S.table.messages.length <= before) errors.push('askAI 本地模式未回复');
        // 掷骰：默认本地不自动发送 → 骰点插入输入框光标处；开启自动后直接发送
        S.prefs.autoSendDice = false;
        qs('#chatInput').value = '我攻击';
        T.rollAndSend('d20', {});
        let last = S.table.messages[S.table.messages.length - 1];
        if (last && last.dice) errors.push('自动发送关闭时不应直接发骰');
        if (!qs('#chatInput').value.includes('[🎲 d20=')) errors.push('本地掷骰未插入输入框: ' + qs('#chatInput').value);
        T.sendDiceToAi();
        last = S.table.messages[S.table.messages.length - 1];
        if (!last || !last.dice) errors.push('sendDiceToAi 未发送骰点');
      }
      // 世界书命中
      const wb = T.buildSystemPrompt('我靠近腐化树灵');
      if (!wb.includes('腐化树灵')) errors.push('世界书关键词未命中');

      // ===== 切换团本（bug#4：开团前弹选卡，不自动带角色）=====
      qs('#tableAdventure').value = 'adv_goblin';
      T.startAdventure('adv_goblin');
      if (qs('#tableAdventure').value !== 'adv_goblin') errors.push('startAdventure 未选中团本');
      if (!qs('#modalCharPick').classList.contains('open')) errors.push('TRPG 开团未弹出选卡弹窗');
      S.charPickSel = new Set(['c1']);
      if (typeof qs('#btnCharPickStart').onclick === 'function') qs('#btnCharPickStart').onclick();
      if (!S.table || S.table.advId !== 'adv_goblin') errors.push('切换团本后会话未更新: ' + (S.table && S.table.advId));
      if (!S.table.charIds || S.table.charIds.length !== 1 || S.table.charIds[0] !== 'c1') errors.push('选卡结果未生效: ' + JSON.stringify(S.table.charIds));
      // 下拉框 onchange 只更新提示，不得重置用户选择（bug: 首次使用无法选团本）
      qs('#tableAdventure').value = 'adv_yysl';
      T.renderTableSetup('adv_yysl');
      if (qs('#tableAdventure').value !== 'adv_yysl') errors.push('renderTableSetup(preferId) 未保留选择: ' + qs('#tableAdventure').value);
      // 模拟用户手动改下拉框 → 触发 onchange（仅更新提示）
      const hintBefore = qs('#tableSetupHint').innerHTML;
      qs('#tableAdventure').value = 'script_inn';
      if (typeof qs('#tableAdventure').onchange === 'function') qs('#tableAdventure').onchange();
      if (qs('#tableAdventure').value !== 'script_inn') errors.push('onchange 重置了下拉框选择');
      if (!qs('#tableSetupHint').innerHTML.includes('剧本杀')) errors.push('onchange 未更新模式提示');
      qs('#tableAdventure').value = 'adv_yysl';
      if (typeof qs('#tableAdventure').onchange === 'function') qs('#tableAdventure').onchange();

      // ===== 系统匹配（bug: COC 角色不能跑 DND 团）=====
      S.characters.push({ id: 'cocOnly', name: '纯COC调查员', system: 'coc7', status: 'alive', avatar: '🕯️', class: '侦探', age: 20,
        stats: { str: 50, con: 50, siz: 60, dex: 55, app: 60, int: 65, pow: 70, edu: 70 }, hpMax: 0, hpCur: null });
      qs('#tableAdventure').value = 'adv_yysl';            // DND 团
      qs('#tableChars').selectedOptions = [{ value: 'cocOnly' }];
      const advBefore = S.table ? S.table.advId : null;
      T.startTable();
      if (!advBefore || S.table.advId !== advBefore) errors.push('系统不符时不应允许开团（会话被错误切换）');
      // 正确匹配：DND 团 + DND 角色
      qs('#tableAdventure').value = 'adv_yysl';
      qs('#tableChars').selectedOptions = [{ value: 'c1' }];
      T.startTable();
      if (S.table.advId !== 'adv_yysl') errors.push('合法开团失败');

      // ===== 切换团本：冒险小队下拉按「新选中的团本」系统重算（bug: 跑DND后换COC团，COC角色仍被旧系统置灰）=====
      qs('#tableAdventure').value = 'adv_yysl';            // 当前跑的是 DND 团
      T.renderTableSetup('adv_yysl');
      const optOf = id => { const h = qs('#tableChars').innerHTML; const i = h.indexOf('<option value="'+id+'"'); if(i<0) return ''; const j = h.indexOf('</option>', i); return h.slice(i, j); };
      if(!optOf('cocOnly').includes('disabled')) errors.push('DND 团下 COC 角色未被置灰');
      if(!optOf('c1').includes('selected')) errors.push('当前会话 DND 角色未保持选中');
      qs('#tableAdventure').value = 'adv_coc_mist';        // 下拉改选 COC 团（只重绘角色列表，不重置团本选择）
      if (typeof qs('#tableAdventure').onchange === 'function') qs('#tableAdventure').onchange();
      if (qs('#tableAdventure').value !== 'adv_coc_mist') errors.push('切换团本时下拉框选择被重置');
      if (qs('#tableChars').innerHTML.indexOf('<option value="cocOnly"') < 0) errors.push('切换团本后角色列表未重绘');
      if (optOf('cocOnly').includes('disabled')) errors.push('切到COC团后 COC 角色仍被旧系统置灰');
      if (!optOf('c1').includes('disabled')) errors.push('切到COC团后 DND 角色未按新系统置灰');
      if (optOf('c1').includes('selected')) errors.push('切到COC团后旧 DND 选择未清除');
      // 端到端：COC 团 + COC 角色可正常开团
      qs('#tableChars').selectedOptions = [{ value: 'cocOnly' }];
      T.startTable();
      if (!S.table || S.table.advId !== 'adv_coc_mist') errors.push('切到COC团后用COC角色开团失败');
      if (S.table.charIds[0] !== 'cocOnly') errors.push('COC 角色未加入小队');

      // ===== 角色背景/性别/外貌必须发给 AI + 开场白是任务简报（bug: 附身灵被地精发现）=====
      S.characters.push({ id: 'fsl', name: '附身灵', system: 'custom', status: 'alive', avatar: '👻', gender: '非二元',
        race: '附身灵', class: '灵体', level: 1, hpMax: null, hpCur: null,
        bio: '附身灵拥有附身的能力，没有肉体，无法被常规手段观测。',
        appearance: '半透明灵体，常规肉眼不可见' });
      qs('#tableAdventure').value = 'adv_goblin';
      qs('#tableChars').selectedOptions = [{ value: 'fsl' }];
      T.startTable();
      const w0 = S.table.messages[0].content;
      if (!w0.includes('任务：') || !w0.includes('黑风洞')) errors.push('欢迎语缺少任务简报: ' + w0.slice(0,80));
      const p3 = T.buildSystemPrompt('我附身到一个村民身上');
      if (!p3.includes('无法被常规手段观测')) errors.push('角色背景未发给AI');
      if (!p3.includes('非二元')) errors.push('角色性别未发给AI');
      if (!p3.includes('肉眼不可见')) errors.push('角色外貌未发给AI');

      // ===== 剧本杀：选角 + 发本（bug#3/#4）=====
      qs('#tableAdventure').value = 'script_inn';
      qs('#tableChars').selectedOptions = [];
      T.startTable();
      if (!qs('#modalRolePick').classList.contains('open')) errors.push('剧本杀未弹出选角弹窗');
      // 随机分配应只选 1 个可扮演角色
      if (typeof qs('#btnRoleRandom').onclick === 'function') qs('#btnRoleRandom').onclick();
      if (S.rolePickSel.size !== 1) errors.push('剧本杀随机分配应只选1个: ' + S.rolePickSel.size);
      if (typeof qs('#btnRoleStart').onclick === 'function') qs('#btnRoleStart').onclick();
      if (!S.table || S.table.participants.length !== 6) errors.push('剧本杀未生成6个剧本角色');
      if (S.table.scriptAct !== -1) errors.push('剧本杀未进入发本阶段: ' + S.table.scriptAct);
      const w1 = S.table.messages.find(m => m.content.includes('剧本分发'));
      if (!w1) errors.push('剧本杀欢迎语未提及剧本分发');
      T.renderTableAll();
      if (!qs('#tabScript').innerHTML.includes('发本阶段')) errors.push('发本阶段界面缺失');
      qs('inner:#btnStartDiscuss').click();
      if (S.table.scriptAct !== 0) errors.push('进入第一幕后 scriptAct 应为0');
      // Galgame：内置主角 + 仅自定义角色卡可用
      qs('#tableAdventure').value = 'gal_moon';
      qs('#tableChars').selectedOptions = [{ value: 'c1' }];   // 故意选 DND 角色卡
      T.startTable();
      if (S.table.participants[0].id !== '__you') errors.push('Galgame 不应使用 DND 角色卡');
      if (!S.table.participants[0].bio.includes('转学')) errors.push('Galgame 内置主角设定缺失: ' + S.table.participants[0].bio);
      if (!S.table.aff || !S.table.aff['夏目樱']) errors.push('Galgame 好感度未初始化');
      S.characters.push({ id: 'galChar', name: 'gal女主', system: 'custom', status: 'alive', avatar: '🌙',
        race: '月之民', class: '魔法少女', level: 1, hpMax: null, hpCur: null, bio: '来自月亮的魔法少女' });
      qs('#tableChars').selectedOptions = [{ value: 'galChar' }];
      T.startTable();
      if (S.table.participants[0].id !== 'galChar') errors.push('Galgame 自定义角色卡未生效');
      const p4 = T.buildSystemPrompt('今天放学后做什么？');
      if (!p4.includes('月之民') || !p4.includes('魔法少女')) errors.push('Galgame 主角设定未入提示词');

      // ===== 提示词编辑器 =====
      T.openPromptEditor();
      T.rebuildPromptPreview();
      T.applyPromptEditor();
      if (!S.table.pmFinal || S.table.pmFinal.length < 100) errors.push('提示词编辑器未生效');

      // ===== streamAI：SSE 流式 + 非流式回退（bug#5）=====
      S.api.key = 'test-key';
      let acc = '';
      const ok1 = await T.streamAI([{ role: 'user', content: 'hi' }], d => { acc += d; });
      if (!ok1 || !acc.includes('测试回复')) errors.push('streamAI 流式解析失败: ' + acc);
      let acc2 = '';
      const ok2 = await T.streamAI([{ role: 'user', content: '__nostream__' }], d => { acc2 += d; });
      if (!ok2 || !acc2.includes('非流式回复')) errors.push('streamAI 非流式回退失败: ' + acc2);
      S.api.key = '';

      // ===== 年龄系统（COC 儿童/自定义/忘了/掷骰；DND 按种族寿命）=====
      if (T.ageToNum('30-50') !== 40) errors.push('ageToNum 区间解析错误');
      if (T.ageToNum('忘了') !== null) errors.push('ageToNum 忘了解析错误');
      if (T.ageToNum('25') !== 25) errors.push('ageToNum 数字解析错误');
      const ra = T.rollAgeInBand([6,11]);
      if (ra < 6 || ra > 11) errors.push('rollAgeInBand 越界: ' + ra);
      qs('#cf_system').value = 'coc7';
      if (typeof qs('#cf_system').onchange === 'function') qs('#cf_system').onchange();
      T.wizRender(1);
      if (qs('#cocAgeBox').classList.contains('hidden')) errors.push('COC 年龄框未显示');
      qs('#cf_age').value = '6-11';
      if (typeof qs('#cf_age').onchange === 'function') qs('#cf_age').onchange();
      if (typeof qs('#btnAgeRoll').onclick === 'function') qs('#btnAgeRoll').onclick();
      if (!qs('#ageHint').textContent.includes('当前年龄')) errors.push('年龄掷骰后提示未更新: ' + qs('#ageHint').textContent);
      // DND：精灵寿命提示
      qs('#cf_system').value = 'dnd5e';
      if (typeof qs('#cf_system').onchange === 'function') qs('#cf_system').onchange();
      qs('#cf_race').value = '精灵';
      if (typeof qs('#cf_race').onchange === 'function') qs('#cf_race').onchange();
      T.wizRender(1);
      if (qs('#dndAgeBox').classList.contains('hidden')) errors.push('DND 年龄框未显示');
      if (!qs('#ageHint').textContent.includes('750')) errors.push('精灵寿命提示缺失: ' + qs('#ageHint').textContent);

      // ===== 外貌描写（捏脸）=====
      qs('#cf_appearance').value = '银发紫瞳，身高168，气质清冷';
      if (typeof qs('#cf_appearance').oninput === 'function') qs('#cf_appearance').oninput();
      if (!qs('#wizardPreview').innerHTML.includes('银发紫瞳')) errors.push('外貌描写未生效');

      // ===== 自定义生成：extractJson + 导入 =====
      const js = T.extractJson('好的，这是你要的：```json\n{"name":"生成测试团","type":"trpg","scenes":[{"id":"a","desc":"x"}]}\n```');
      if (!js) errors.push('extractJson 未提取到 JSON');
      else {
        S.genLastReply = '```json\n' + js + '\n```';
        const n0 = S.adventures.length;
        T.genImportAs('adv');
        if (S.adventures.length !== n0 + 1 || !S.adventures.some(a => a.name === '生成测试团')) errors.push('genImportAs 导入失败');
      }
      const jc = T.extractJson('{"name":"生成角色","system":"custom","stats":{"魅力":9}}');
      if (jc) {
        S.genLastReply = jc;
        const n0 = S.characters.length;
        T.genImportAs('char');
        if (S.characters.length !== n0 + 1 || !S.characters.some(c => c.name === '生成角色')) errors.push('genImportAs 角色导入失败');
      } else errors.push('extractJson 裸JSON失败');

      // ===== 资料库 / 风格 =====
      ['dnd','coc','spells','weapons','monsters','notes'].forEach(tab => { S.libTab = tab; T.renderLib(); });
      T.renderStyleLab();

      // ===== MOD 系统 =====
      const modData = { id:'mody', name:'测试规则', version:'1.0', icon:'🧩',
        systems:[{ id:'myrule', name:'我的规则', icon:'⚙️', desc:'测试', attrs:[{key:'power',name:'力量'},{key:'magic',name:'魔力'}] }],
        adventures:[{ name:'MOD测试团', type:'trpg', system:'mody:myrule', players:2, emoji:'📜', level:'任意', desc:'d', intro:'i',
          scenes:[{id:'start',desc:'s',choices:[]}], monsters:[], worldbook:[] }] };
      T.installModFromData(JSON.parse(JSON.stringify(modData)), 'mody.html');
      if (!S.mods.some(m=>m.id==='mody')) errors.push('MOD 未安装');
      if (!S.modSystems.some(ms=>ms.id==='mod:myrule')) errors.push('MOD 规则系统未注入');
      if (!S.adventures.some(a=>a.id==='mod_mody_MOD测试团')) errors.push('MOD 团本未注入');
      const modAdv = S.adventures.find(a=>a.id==='mod_mody_MOD测试团');
      if (modAdv && modAdv.system !== 'mod:myrule') errors.push('MOD 团本系统未规范化: ' + modAdv.system);
      T.openWizard(null);
      T.renderWizPick();
      if (!qs('#wizPickGrid').innerHTML.includes('我的规则')) errors.push('卡种选择未包含 MOD 系统');
      T.uninstallMod('mody');
      if (S.mods.some(m=>m.id==='mody')) errors.push('MOD 未卸载');
      if (S.adventures.some(a=>String(a.id).startsWith('mod_mody_'))) errors.push('MOD 团本未随卸载移除');

      // ===== COC 技能直接输入 + 偏向随机分配 =====
      T.openWizard(null);
      const W2 = T.getW();
      qs('#cf_system').value = 'coc7';
      qs('#cf_coc_occ').value = '私家侦探';
      W2.system = 'coc7';
      W2.class = '私家侦探';
      W2.stats = { str:50, con:50, siz:60, dex:55, app:60, int:65, pow:70, edu:70 };
      W2.ageNum = 20; W2.age = '20';
      T.wizRender(3);
      T.cocSetSkillValue('侦查', 90);          // 基础25，单技能上限50点 → 钳制到 75：投入50
      const spD = W2.cocSpent['侦查'];
      if (!spD || (spD.occ||0)+(spD.int||0) !== 50) errors.push('cocSetSkillValue 错误: ' + JSON.stringify(spD));
      T.cocSetSkillValue('侦查', 999);          // 越界 → 钳制到 25+50=75
      if ((W2.cocSpent['侦查'].occ + W2.cocSpent['侦查'].int) !== 50) errors.push('cocSetSkillValue 上限钳制错误');
      T.cocSetSkillValue('侦查', 10);           // 低于基础 → 钳制回基础 25
      if ((W2.cocSpent['侦查'].occ + W2.cocSpent['侦查'].int) !== 0) errors.push('cocSetSkillValue 下限钳制错误');
      W2.cocBias = 0;
      T.cocRandomRoll();
      const usedTotal = Object.values(W2.cocSpent).reduce((t,x)=>t+(x.occ||0)+(x.int||0),0);
      const pool = T.cocCalc(W2).occPts + T.cocCalc(W2).intPts;
      if (usedTotal > pool) errors.push('cocRandomRoll 超池: ' + usedTotal + ' > ' + pool);
      const skv = T.cocCalc(W2);
      if (!T.COC_SKILLS.some(s=>s.n==='侦查')) errors.push('COC_SKILLS 缺失');

      // ===== MOD 独立车卡模板 + MOD 团本按名称匹配系统（bug#5/#6）=====
      const mod2 = { id:'mlp', name:'小马宝莉：友谊的魔法', version:'1.0', icon:'🦄',
        systems:[{ id:'mlp', name:'小马宝莉：友谊的魔法', icon:'🦄', desc:'测试',
          attrs:[{key:'friendship', name:'友谊', roll:'3d6*5', min:1, max:99, default:30}],
          derived:[{name:'魔法力', expr:'friendship/10'}],
          skills:[{name:'歌唱', base:20}] }],
        adventures:[{ name:'小马谷日常', type:'trpg', system:'小马宝莉：友谊的魔法', players:2, emoji:'🦄', level:'任意', desc:'d', intro:'i',
          scenes:[{id:'start',desc:'s',choices:[]}], monsters:[], worldbook:[] }] };
      T.installModFromData(JSON.parse(JSON.stringify(mod2)), 'mlp.html');
      const mlpAdv = S.adventures.find(a=>a.id==='mod_mlp_小马谷日常');
      if (!mlpAdv || mlpAdv.system !== 'mod:mlp') errors.push('MOD 团本按名称匹配系统失败: ' + (mlpAdv && mlpAdv.system));
      // MOD 车卡模板
      qs('#cf_system').value = 'mod:mlp';
      W2.system = 'mod:mlp';
      T.wizRender(2);
      if (qs('#wzModAttrs').classList.contains('hidden')) errors.push('MOD 属性模板未显示');
      if (!qs('#wzModAttrs').innerHTML.includes('友谊')) errors.push('MOD 属性未渲染');
      const ra2 = T.rollAttrExpr('3d6*5');
      if (ra2 < 3 || ra2 > 90) errors.push('rollAttrExpr 错误: ' + ra2);
      T.wizRender(3);
      if (qs('#wzModSkills').classList.contains('hidden')) errors.push('MOD 技能表未显示');
      if (!qs('#wzModSkills').innerHTML.includes('歌唱')) errors.push('MOD 技能未渲染');
      // MOD 角色可参加 MOD 团（bug#6：不再误报"COC 7th"）
      S.characters.push({ id:'mlpChar', name:'暮光闪闪', system:'mod:mlp', status:'alive', avatar:'🦄',
        race:'独角兽', class:'魔法师', level:1, hpMax:null, hpCur:null, stats:{friendship:50} });
      qs('#tableAdventure').value = 'mod_mlp_小马谷日常';
      qs('#tableChars').selectedOptions = [{ value:'mlpChar' }];
      T.startTable();
      if (!S.table || S.table.participants[0]?.id !== 'mlpChar') errors.push('MOD 角色未能参团');
      const p5 = T.buildSystemPrompt('我要唱歌');
      if (!p5.includes('暮光闪闪')) errors.push('MOD 角色未入提示词');
      if (p5.includes('COC 7th')) errors.push('MOD 角色被误标为 COC');

      // ===== Galgame 开团弹选卡：内置主角可选中（bug#4）=====
      T.startAdventure('gal_moon');
      if (!qs('#modalCharPick').classList.contains('open')) errors.push('Galgame 开团未弹出选卡弹窗');
      S.charPickSel = new Set(['__builtin']);
      if (typeof qs('#btnCharPickStart').onclick === 'function') qs('#btnCharPickStart').onclick();
      if (!S.table || S.table.advId !== 'gal_moon') errors.push('Galgame 内置主角开团失败');
      if (S.table.participants[0]?.id !== '__you') errors.push('Galgame 内置主角未生效');

      // ===== 存档 =====
      const sv0 = S.saves.length;
      T.saveTableProgress(true);
      if (S.saves.length <= sv0) errors.push('saveTableProgress 未保存');
      T.loadSave(S.saves[S.saves.length - 1].id);
      if (!S.table || !S.table.messages.length) errors.push('loadSave 后无会话');
    } catch (e) { errors.push('主流程异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); }
  }

  console.log('==== 冒烟测试结果 ====');
  if (!html.includes('by Karma')) errors.push('署名 by Karma 缺失');
  if (!html.includes('作者：<b>Karma</b>')) errors.push('设置页署名缺失');
  if (errors.length) { console.log('发现 ' + errors.length + ' 个问题:\n' + errors.join('\n---\n')); process.exit(1); }
  console.log('全部通过 ✓ (init/向导同步/属性算法/骰子开关/开始团本/切换团本/剧本杀免卡/Galgame/提示词/流式API/非流式回退/生成导入/资料库/存档)');
})();
