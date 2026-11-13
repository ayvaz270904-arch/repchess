# Сборка certificate.html из образца (Figma PDF, 13.11.2026): фон лицевой (jpg), векторы заголовка,
# маскота, логотипа, значков и QR, шрифт Panama Regular — всё встраивается в файл; текст живой.
# Запуск: python3 build.py <путь к certificate.html>   (рядом: assets.json, front_bg.jpg, panama-regular.ttf)
# Позиции строк подогнаны наложением на образец 1:1 (расхождение ≤ 3 px из 2500).
import json, base64, sys
a = json.load(open('assets.json'))
bg = base64.b64encode(open('front_bg.jpg', 'rb').read()).decode()
font = base64.b64encode(open('panama-regular.ttf', 'rb').read()).decode()   # Panama Regular (The Temporary State) — шрифт макета
q = a['qr']
mods = []
for r, row in enumerate(a['grid']):
    for c, v in enumerate(row):
        if v:
            x, y = c + 0.5, r + 0.5
            mods.append('M%g %gL%g %gL%g %gL%g %gZ' % (x, round(y - .51, 2), round(x - .51, 2), y, x, round(y + .51, 2), round(x + .51, 2), y))
qr_style = 'left:%.2fpx;top:%.2fpx;width:%.2fpx;height:%.2fpx' % (q['x'], q['y'], 33 * q['pitch'], 33 * q['pitch'])

html = r'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сертификат Rep Chess</title>
<!-- Сертификат Rep Chess Education по образцу из Figma (13.11.2026): на каждый код — лицевая и оборот, PDF 250×110 мм.
     Открывается из тренерки (промокоды → «📄») или сам по себе. Данные — из полей слева или из адреса:
       ?code=REP-ZZQP-Z6&n=4&kind=group&format=offline&until=2027-12-05&named=1&name=Имя%20Фамилия
       ?codes=REP-AAAA-11:2027-02-13,REP-BBBB-22:2027-02-13&n=4&kind=group&format=online&named=0   — пачка
     kind: group | indiv; format: online | offline; until — ГГГГ-ММ-ДД (пусто — по сроку пакета: 1 → 1 мес., 4 → 3, 10 → 6);
     named=0 — без строки «для кого». window.RepCert.render({…}) — перерисовать. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@font-face{font-family:'Panama';src:url(data:font/ttf;base64,__FONT__) format('truetype');font-weight:400;font-style:normal;font-display:block}
:root{--red:#cf4b4e;--ink:#151515;--paper:#f3f1ec;--k:.3}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:15px/1.4 Onest,system-ui,sans-serif}
.app{display:grid;grid-template-columns:300px minmax(0,1fr);gap:28px;padding:28px;max-width:1500px;margin:0 auto;align-items:start}
.panel,.sheets{min-width:0}
.panel{position:sticky;top:20px;background:#fff;border:1.5px solid var(--ink);border-radius:14px;padding:18px}
.panel h1{font-size:17px;margin:0 0 4px}
.panel .sub{font-size:12px;color:#666;margin:0 0 14px}
.panel .lbl{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#555;margin:12px 0 5px}
.panel input[type=text],.panel input[type=number],.panel input[type=date]{width:100%;padding:9px 11px;border:1px solid #bdbdbd;border-radius:9px;font:inherit;font-size:14px;background:#fff;color:var(--ink)}
.panel input:focus{outline:none;border-color:var(--ink)}
.chk{display:flex;align-items:center;gap:9px;margin:14px 0 4px;font-size:14px;font-weight:600;cursor:pointer;user-select:none}
.chk input{width:18px;height:18px;accent-color:var(--ink);margin:0}
.seg{display:flex;gap:6px;flex-wrap:wrap}
.seg button{flex:1;padding:8px 6px;border:1px solid #bdbdbd;border-radius:8px;background:#fff;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
.seg button.on{background:var(--ink);border-color:var(--ink);color:#fff;font-weight:600}
.hint{font-size:11px;color:#777;margin-top:4px}
.codes{font:12px/1.5 ui-monospace,Menlo,monospace;background:#f6f5f2;border-radius:8px;padding:8px 10px;max-height:150px;overflow:auto;word-break:break-all}
.go{display:block;width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:var(--red);color:#fff;font:600 15px Onest,sans-serif;cursor:pointer}
.ghost{display:block;width:100%;margin-top:8px;padding:9px;border:1px solid var(--ink);border-radius:10px;background:#fff;font:inherit;font-size:13px;cursor:pointer}
.sheets{display:flex;flex-direction:column;gap:22px}
.pair{display:flex;flex-direction:column;gap:10px}
.cap{font-size:12px;color:#666;margin:0}
.sheet{position:relative;width:100%;aspect-ratio:25/11;overflow:hidden;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.18)}
.canvas{position:absolute;left:0;top:0;width:2500px;height:1100px;zoom:var(--k);overflow:hidden;
  font-family:'Panama',Georgia,serif;font-weight:400;color:#fff}
/* текст — Panama Regular (The Temporary State, Р. Горницкий), как в макете Figma; файл вшит выше */
.front .canvas,.online .canvas{background:#e8622c url(data:image/jpeg;base64,__BG__) center/100% 100% no-repeat}
.back .canvas{background:var(--red)}
.layer{position:absolute;left:0;top:0;width:2500px;height:1100px}
.t{position:absolute;white-space:nowrap;line-height:1}
.f-note{right:11px;text-align:right;font-size:48px}
.b48{font-size:48px}
.code{font-size:40px}
.code-line{position:absolute;left:220px;top:714px;height:3px;background:#fff}
.right{right:68px;text-align:right;font-size:52px;letter-spacing:-.04em}
.qr{position:absolute;overflow:visible}
.ph{opacity:.5}
/* онлайн-сертификат (вариант A, 13.11.2026): одна сторона, всё на градиенте, QR на красной плашке */
.o-abs{position:absolute;white-space:nowrap}
.o-who{font-size:52px}
.o-code{font-size:60px;border-bottom:4px solid #fff;padding:0 40px 2px 30px;margin-left:30px}
.o-list{position:absolute;left:56px;top:760px;font-size:42px;line-height:1.45}
.o-list .li{white-space:nowrap}
.o-list a,.o-qr-a{color:#fff;text-decoration:none}
.bul{width:.62em;height:.62em;margin-right:.35em;vertical-align:.05em}
.o-qrbox{position:absolute;right:40px;bottom:40px;width:400px;padding:30px 0 40px;background:var(--red);border-radius:28px;display:flex;flex-direction:column;align-items:center;gap:22px}
.o-qrcap{font-size:42px;line-height:1.05;text-align:center;letter-spacing:-.03em}
@media (max-width:860px){.app{grid-template-columns:minmax(0,1fr);padding:14px;gap:16px}.panel{position:static}}
@page{size:250mm 110mm;margin:0}
@media print{
  body{background:none}
  .app{display:block;padding:0;max-width:none}
  .panel,.cap{display:none}
  .sheets,.pair{display:block}
  .sheet{width:250mm;height:110mm;aspect-ratio:auto;border-radius:0;box-shadow:none;break-after:page;page-break-after:always}
  .pair:last-child .back{break-after:auto;page-break-after:auto}
  .canvas{zoom:.377953}   /* 250 мм = 944,88 px → 944,88 / 2500 */
  .sheet,.canvas{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<!-- Векторы образца — один раз; листы ссылаются на них (<use>), чтобы пачка из 50 кодов не тормозила -->
<svg id="defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="s-title" viewBox="0 0 2500 1100">__TITLE__</symbol>
  <symbol id="s-layer" viewBox="0 0 2500 1100">__LAYER__</symbol>
  <symbol id="s-qr" viewBox="0 0 33 33"><path fill="#fff" d="__MODS__"/>__FINDER__</symbol>
</defs></svg>

<template id="tpl">
  <div class="pair">
    <p class="cap x-cap1">Лицевая сторона</p>
    <div class="sheet front"><div class="canvas">
      <svg class="layer" viewBox="0 0 2500 1100" aria-label="Сертификат"><use href="#s-title" fill="#fff"/></svg>
      <div class="t f-note x-f1" style="top:922px"></div>
      <div class="t f-note x-f2" style="top:970px"></div>
      <div class="t f-note" style="top:1016px">в Rep Chess Education</div>
    </div></div>
    <p class="cap x-cap2">Оборот</p>
    <div class="sheet back"><div class="canvas">
      <svg class="layer" viewBox="0 0 2500 1100"><use href="#s-layer"/></svg>
      <div class="t b48 x-who" style="left:82px;top:593px"></div>
      <div class="t b48" style="left:82px;top:675px">код</div>
      <div class="t code x-code" style="left:249px;top:675px"></div>
      <div class="code-line x-line"></div>
      <div class="t b48" style="left:80px;top:750px">условия использования сертификата:</div>
      <div class="t b48 x-l1" style="left:109px;top:854px"></div>
      <div class="t b48 x-l2" style="left:109px;top:905px">записаться на занятие можно по QR на сертификате, введя в боте код сертификата</div>
      <div class="t b48 x-l3" style="left:109px;top:958px">по вопросам писать: tg @RepChess_Edu_Helper</div>
      <div class="t b48 x-l4" style="left:109px;top:1010px"></div>
      <div class="t right" style="top:629px">бот в тг</div>
      <div class="t right" style="top:668px">rep chess edu</div>
      <svg class="qr" viewBox="0 0 33 33" style="__QRSTYLE__" aria-label="QR: бот Rep Chess в Telegram"><use href="#s-qr"/></svg>
    </div></div>
  </div>
</template>

<template id="tpl-online">
  <div class="pair">
    <p class="cap x-cap1">Онлайн-сертификат</p>
    <div class="sheet online"><div class="canvas">
      <svg class="o-abs" viewBox="22 22 252 252" style="left:40px;top:40px;width:150px;height:150px"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg>
      <svg class="o-abs" viewBox="2195 52 290 140" style="right:50px;top:52px;width:250px;height:121px"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg>
      <svg class="o-abs" viewBox="0 598 2500 332" style="left:40px;top:215px;width:1800px;height:239px" aria-label="Сертификат"><use href="#s-title" x="0" y="0" width="2500" height="1100" fill="#fff"/></svg>
      <div class="o-abs x-of" style="left:1880px;top:330px;font-size:44px;line-height:1.1"></div>
      <div class="o-abs o-who x-who" style="left:56px;top:560px"></div>
      <div class="o-abs" style="left:56px;top:640px;font-size:52px">код <span class="o-code x-code"></span></div>
      <div class="o-list">
        <div class="li"><svg class="bul" viewBox="62 858 38 36"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg><span class="x-l1"></span></div>
        <div class="li x-l2"><svg class="bul" viewBox="62 858 38 36"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg>записаться на занятие: QR или <a href="https://t.me/RepChessEducation_bot" target="_blank">t.me/RepChessEducation_bot</a>, введя в боте код</div>
        <div class="li x-l3"><svg class="bul" viewBox="62 858 38 36"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg>по вопросам: tg @RepChess_Edu_Helper</div>
        <div class="li"><svg class="bul" viewBox="62 858 38 36"><use href="#s-layer" x="0" y="0" width="2500" height="1100"/></svg><span class="x-l4"></span></div>
      </div>
      <div class="o-qrbox">
        <div class="o-qrcap">бот в тг<br>rep chess edu</div>
        <a class="o-qr-a" href="https://t.me/RepChessEducation_bot" target="_blank" style="display:block;width:320px;height:320px"><svg viewBox="-.6 -.6 34.2 34.2" style="width:320px;height:320px;display:block" aria-label="QR: бот Rep Chess в Telegram"><use href="#s-qr" x="0" y="0" width="33" height="33"/></svg></a>
      </div>
    </div></div>
  </div>
</template>

<div class="app">
  <form class="panel" onsubmit="return false">
    <h1 id="f-title">Сертификат</h1>
    <p class="sub" id="f-sub"></p>
    <span class="lbl">Вручение</span>
    <div class="seg" id="f-delivery"><button type="button" data-v="offline">офлайн · печать</button><button type="button" data-v="online">онлайн · картинка</button></div>
    <label class="chk"><input type="checkbox" id="f-named"> Именной сертификат</label>
    <div id="f-name-box"><input type="text" id="f-name" maxlength="60" placeholder="Имя и фамилия"></div>
    <div class="hint" id="f-named-hint"></div>
    <div id="f-code-box"><span class="lbl">Код (промокод)</span>
      <input type="text" id="f-code" maxlength="24" placeholder="REP-XXXX-XX" style="text-transform:uppercase">
      <div class="hint" id="f-code-hint">Нового кода нет в базе — после скачивания он создастся сам (одноразовый, номинал — как ниже).</div></div>
    <div id="f-codes-box" style="display:none"><span class="lbl" id="f-codes-lbl">Коды</span><div class="codes" id="f-codes"></div>
      <div class="hint">На каждый код — свой сертификат, срок — как у промокода.</div></div>
    <div id="f-locked" style="display:none"><span class="lbl">Из промокода</span>
      <div class="codes" id="f-locked-text" style="font-family:inherit;font-size:13px"></div>
      <div class="hint">Номинал и срок заданы промокодом — так их проверит бот. Свободный шаблон — кнопка «Пустой шаблон» в тренерке.</div></div>
    <div id="f-free">
    <span class="lbl">Занятий</span>
    <div class="seg" id="f-nq"><button type="button" data-n="1">1</button><button type="button" data-n="4">4</button><button type="button" data-n="10">10</button><button type="button" data-n="">другое</button></div>
    <input type="number" id="f-n" min="1" max="99" style="margin-top:6px;display:none">
    <span class="lbl">Вид</span>
    <div class="seg" id="f-kind"><button type="button" data-v="group">групповые</button><button type="button" data-v="indiv">индивидуальные</button></div>
    <span class="lbl">Формат</span>
    <div class="seg" id="f-format"><button type="button" data-v="online">онлайн</button><button type="button" data-v="offline">офлайн</button></div>
    <div id="f-until-box"><span class="lbl">Срок действия до</span>
      <input type="date" id="f-until"><div class="hint" id="f-until-hint"></div></div>
    </div>
    <button class="go" type="button" id="b-png" onclick="RepCert.png()">Скачать картинку PNG</button>
    <button class="go" type="button" id="b-pdf" onclick="RepCert.print()">Скачать PDF</button>
    <button class="ghost" type="button" onclick="RepCert.copyLink()">Скопировать ссылку с этими данными</button>
    <div class="hint" id="f-msg"></div>
  </form>
  <div class="sheets" id="sheets"></div>
</div>

<script>
(function () {
  'use strict'
  // Срок пакета по числу занятий — как у промокодов (_certExpiry в trainer.html, redeemCert в bot.gs)
  const PACK_MONTHS = n => (n <= 1 ? 1 : n <= 4 ? 3 : 6)
  const MAX_TEXT_RIGHT = 2075            // правее — колонка с QR
  const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,23}$/
  // как _certNormJs в trainer.html: похожие русские буквы → латиница, остальное лишнее — убрать
  const HOMO = { А: 'A', В: 'B', Е: 'E', Ё: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' }
  const normCode = v => String(v || '').toUpperCase().replace(/[А-ЯЁ]/g, ch => HOMO[ch] || ch).replace(/[^A-Z0-9-]/g, '').slice(0, 24)
  const st = { name: '', code: '', n: 4, kind: 'group', format: 'offline', until: '', named: true, codes: [], nOther: false, delivery: 'offline', locked: false }
  const $ = id => document.getElementById(id)
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const ru = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '')
  function defUntil(n) {
    const t = new Date(); t.setMonth(t.getMonth() + PACK_MONTHS(n))
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
  }
  // «на посещение 4 групповых / онлайн-занятия» (лицевая) и «4 групповых офлайн-занятия» (оборот)
  function phrases(d) {
    const a = d.n % 10, b = d.n % 100
    const one = a === 1 && b !== 11, few = a >= 2 && a <= 4 && (b < 12 || b > 14)
    const g = d.kind === 'indiv', fmt = d.format === 'online' ? 'онлайн' : 'офлайн'
    return {
      f1: 'на посещение ' + d.n + ' ' + (one ? (g ? 'индивидуального' : 'группового') : (g ? 'индивидуальных' : 'групповых')),
      f2: fmt + '-' + (one || few ? 'занятия' : 'занятий'),
      l1: d.n + ' ' + (one ? (g ? 'индивидуальное' : 'групповое') : (g ? 'индивидуальных' : 'групповых')) + ' ' + fmt + '-'
        + (one ? 'занятие' : few ? 'занятия' : 'занятий') + ' в rep chess education',
    }
  }
  // Длинная строка не должна залезть на QR: сжимаем разрядку, потом кегль
  function fit(el, right) {
    el.style.letterSpacing = ''; el.style.fontSize = ''
    const max = right - (parseFloat(el.style.left) || 0)
    if (el.scrollWidth <= max) return
    el.style.letterSpacing = '-0.01em'
    let fs = parseFloat(getComputedStyle(el).fontSize)
    while (el.scrollWidth > max && fs > 24) { fs -= 1; el.style.fontSize = fs + 'px' }
  }
  const ONLINE_TEXT_RIGHT = 2020        // онлайн: правее — плашка с QR
  function fitW(el, max) {
    el.style.letterSpacing = ''; el.style.fontSize = ''
    if (el.scrollWidth <= max) return
    el.style.letterSpacing = '-0.01em'
    let fs = parseFloat(getComputedStyle(el).fontSize)
    while (el.scrollWidth > max && fs > 22) { fs -= 1; el.style.fontSize = fs + 'px' }
  }
  const items = () => (st.codes.length ? st.codes : [{ code: st.code, until: st.until }])
  function scale() {
    document.querySelectorAll('.sheet').forEach(s => s.style.setProperty('--k', s.clientWidth / 2500))
  }
  function build(n) {
    const box = $('sheets'), tpl = st.delivery === 'online' ? 'tpl-online' : 'tpl'
    if (box.dataset.tpl !== tpl) { box.innerHTML = ''; box.dataset.tpl = tpl }
    while (box.children.length > n) box.lastElementChild.remove()
    while (box.children.length < n) box.appendChild($(tpl).content.firstElementChild.cloneNode(true))
  }

  function render(d) {
    Object.assign(st, d || {})
    st.n = Math.max(1, Math.min(99, parseInt(st.n, 10) || 1))
    st.code = normCode(st.code)
    const list = items(), p = phrases(st), nm = (st.name || '').trim()
    build(list.length)
    scale()
    ;[...$('sheets').children].forEach((pair, i) => {
      const it = list[i], q = s => pair.querySelector(s)
      const until = (list.length > 1 ? it.until : st.until) || defUntil(st.n)
      if (st.delivery === 'online') {
        q('.x-cap1').textContent = list.length > 1 ? (i + 1) + ' из ' + list.length + ' · ' + it.code : 'Онлайн-сертификат'
        q('.x-of').innerHTML = esc(p.f1) + '<br>' + esc(p.f2) + '<br>в Rep Chess Education'
        const w = q('.x-who')
        w.style.display = st.named ? '' : 'none'
        w.innerHTML = 'для кого: ' + (nm ? esc(nm) : '<span class="ph">Имя Фамилия</span>')
        q('.x-code').innerHTML = it.code ? esc(it.code) : '<span class="ph">REP-XXXX-XX</span>'
        q('.x-l1').textContent = p.l1
        q('.x-l4').textContent = 'срок действия до ' + ru(until)
        ;[w, q('.x-l1').parentNode, q('.x-l2'), q('.x-l3'), q('.x-l4').parentNode].forEach(el => fitW(el, ONLINE_TEXT_RIGHT - 56))
        return
      }
      q('.x-cap1').textContent = list.length > 1 ? (i + 1) + ' из ' + list.length + ' · ' + it.code + ' — лицевая' : 'Лицевая сторона'
      q('.x-cap2').textContent = list.length > 1 ? it.code + ' — оборот' : 'Оборот'
      q('.x-f1').textContent = p.f1
      q('.x-f2').textContent = p.f2
      // пустые поля — бледная подсказка, чтобы на печати было видно, что не заполнено
      const who = q('.x-who')
      who.style.display = st.named ? '' : 'none'
      who.innerHTML = 'для кого: ' + (nm ? esc(nm) : '<span class="ph">Имя Фамилия</span>')
      q('.x-code').innerHTML = it.code ? esc(it.code) : '<span class="ph">REP-XXXX-XX</span>'
      q('.x-l1').textContent = p.l1
      q('.x-l4').textContent = 'срок действия до ' + ru(until)
      ;['.x-who', '.x-l1', '.x-l2', '.x-l3', '.x-l4', '.x-code'].forEach(s => fit(q(s), MAX_TEXT_RIGHT))
      // линия под кодом — как в образце (от x=220 до 656), длиннее, если код длинный
      q('.x-line').style.width = Math.min(Math.max(436, q('.x-code').scrollWidth + 60), MAX_TEXT_RIGHT - 220) + 'px'
    })
    syncPanel()
  }

  function syncPanel() {
    const batch = st.codes.length > 0
    const on = st.delivery === 'online'
    $('f-title').textContent = (on ? 'Онлайн-сертификат' : 'Сертификат') + (batch ? 'ы · ' + st.codes.length + ' шт.' : '')
    $('f-sub').textContent = on ? 'Одна сторона. Картинку PNG удобно отправить в Telegram; в PDF ссылка на бота кликабельная.'
      : 'Печать: лицевая и оборот на каждый код, PDF 250 × 110 мм.'
    document.querySelectorAll('#f-delivery button').forEach(b => b.classList.toggle('on', b.dataset.v === st.delivery))
    $('b-png').style.display = on ? '' : 'none'
    $('b-pdf').className = on ? 'ghost' : 'go'
    $('b-pdf').textContent = on ? 'Скачать PDF (1 страница' + (batch ? ' на код' : '') + ')' : 'Скачать PDF'
    $('f-named').checked = st.named
    $('f-name-box').style.display = st.named ? '' : 'none'
    $('f-named-hint').textContent = st.named ? (batch ? 'Одно имя — на всех сертификатах пачки' : '') : 'Без строки «для кого» — сертификат на предъявителя'
    if (document.activeElement !== $('f-name')) $('f-name').value = st.name
    // открыт по промокоду — номинал, срок и код закреплены
    $('f-free').style.display = st.locked ? 'none' : ''
    $('f-locked').style.display = st.locked ? '' : 'none'
    if (st.locked) {
      const p = phrases(st)
      $('f-locked-text').innerHTML = esc(p.l1.replace(' в rep chess education', ''))
        + (batch ? '' : '<br>срок до ' + esc(ru(st.until || defUntil(st.n))) )
    }
    $('f-code').readOnly = st.locked
    $('f-code-hint').style.display = st.locked ? 'none' : ''
    $('f-code-box').style.display = batch ? 'none' : ''
    $('f-codes-box').style.display = batch ? '' : 'none'
    if (batch) {
      $('f-codes-lbl').textContent = 'Коды · ' + st.codes.length
      $('f-codes').innerHTML = st.codes.map(c => esc(c.code) + (c.until ? ' <span style="color:#999">до ' + ru(c.until) + '</span>' : '')).join('<br>')
    } else if (document.activeElement !== $('f-code')) $('f-code').value = st.code
    // «другое»: поле ввода остаётся, пока не выбрали 1 / 4 / 10 — даже если число стёрли или ввели 4
    const other = st.nOther || ![1, 4, 10].includes(st.n)
    document.querySelectorAll('#f-nq button').forEach(b => b.classList.toggle('on', other ? b.dataset.n === '' : b.dataset.n === String(st.n)))
    $('f-n').style.display = other ? '' : 'none'
    if (document.activeElement !== $('f-n')) $('f-n').value = st.n
    document.querySelectorAll('#f-kind button').forEach(b => b.classList.toggle('on', b.dataset.v === st.kind))
    document.querySelectorAll('#f-format button').forEach(b => b.classList.toggle('on', b.dataset.v === st.format))
    $('f-until-box').style.display = batch ? 'none' : ''
    $('f-until').value = st.until || defUntil(st.n)
    $('f-until-hint').textContent = st.until ? 'срок задан' : 'по сроку пакета: ' + PACK_MONTHS(st.n) + ' мес. от сегодня'
  }

  function fromUrl() {
    const q = new URLSearchParams(location.search), d = {}
    const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '')
    if (q.has('name')) d.name = q.get('name').slice(0, 60)
    if (q.has('code')) d.code = q.get('code').slice(0, 24)
    if (q.has('n')) d.n = q.get('n')
    if (['group', 'indiv'].includes(q.get('kind'))) d.kind = q.get('kind')
    if (['online', 'offline'].includes(q.get('format'))) d.format = q.get('format')
    if (date(q.get('until'))) d.until = q.get('until')
    if (q.get('named') === '0') d.named = false
    if (q.get('delivery') === 'online') d.delivery = 'online'
    if (q.has('code') || q.has('codes')) d.locked = true   // из тренерки по промокоду
    if (q.get('codes')) {
      d.codes = q.get('codes').split(',').slice(0, 200).map(s => {
        const [c, u] = s.trim().toUpperCase().split(':')
        return { code: c, until: date(u) }
      }).filter(x => CODE_RE.test(x.code))
    }
    return d
  }
  function link() {
    const q = new URLSearchParams({ n: st.n, kind: st.kind, format: st.format })
    if (st.delivery === 'online') q.set('delivery', 'online')
    if (!st.named) q.set('named', '0'); else if (st.name) q.set('name', st.name)
    if (st.codes.length) q.set('codes', st.codes.map(c => c.code + (c.until ? ':' + c.until : '')).join(','))
    else { if (st.code) q.set('code', st.code); if (st.until) q.set('until', st.until) }
    return location.origin + location.pathname + '?' + q.toString()
  }

  // Пустой шаблон: вписанного кода нет в базе — после скачивания создаём его через вкладку тренерки,
  // из которой открыт шаблон (у самого шаблона входа нет). Существующий код не трогаем.
  async function ensureCode() {
    if (st.locked || st.codes.length || !st.code) return
    const op = window.opener
    let fn = null
    try { fn = op && !op.closed && typeof op.rcCertEnsureCode === 'function' ? op.rcCertEnsureCode : null } catch (e) {}
    if (!fn) { $('f-msg').textContent = 'Код ' + st.code + ' в базе не проверен: шаблон открыт не из тренерки. Откройте «📄 Пустой шаблон» в тренерке.'; return }
    $('f-msg').textContent = 'Проверяю код ' + st.code + '…'
    try {
      const r = await fn({ code: st.code, n: st.n, kind: st.kind, format: st.format })
      if (r.status === 'created') {
        $('f-msg').textContent = '✓ Промокод ' + r.code + ' создан: ' + r.nominal + ', срок — по пакету от сегодня.'
          + (st.until && st.until !== defUntil(st.n) ? ' Внимание: на сертификате другой срок (' + ru(st.until) + ').' : '')
      } else if (r.status === 'exists') {
        $('f-msg').textContent = r.same
          ? 'Промокод ' + r.code + ' уже есть в базе — не меняли.' + (r.used ? ' Он уже активирован!' : r.archived ? ' Он в архиве!' : '')
          : '⚠ Промокод ' + r.code + ' уже есть с другим номиналом (' + r.nominal + ') — сертификат с ним не совпадает. В базе ничего не меняли.'
      } else $('f-msg').textContent = 'Код не создан: ' + (r.message || 'ошибка')
    } catch (e) { $('f-msg').textContent = 'Код не создан: ' + (e.message || e) }
  }

  window.RepCert = {
    render,
    data: () => JSON.parse(JSON.stringify(st)),
    print: async () => {
      try { await document.fonts.ready } catch (e) {}
      const t = document.title
      const list = items()
      const kind = st.delivery === 'online' ? 'Онлайн-сертификат' : 'Сертификат'
      document.title = list.length > 1 ? kind + 'ы ' + list.length + ' шт — ' + list[0].code + '…'
        : kind + ' ' + (list[0].code || '') + (st.named && st.name ? ' — ' + st.name : '')   // имя PDF-файла
      window.print()
      setTimeout(() => { document.title = t }, 1000)
      await ensureCode()
    },
    // PNG онлайн-листа: лист со стилями, шрифтом и векторами — в SVG (foreignObject) → canvas → файл.
    // Всё уже вшито в страницу, сторонние библиотеки не нужны. Пачка — по картинке на код.
    _pngBlob: async i => {
      try { await document.fonts.ready } catch (e) {}
      const src = document.querySelectorAll('#sheets .sheet.online .canvas')[i]
      if (!src) return null
      const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
      const wrap = document.createElement('div')
      wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
      wrap.style.cssText = 'position:relative;width:2500px;height:1100px;margin:0'
      wrap.innerHTML = '<style>' + css + '\n.canvas{zoom:1 !important}</style>' + $('defs').outerHTML
      const sh = document.createElement('div')
      sh.className = 'sheet online'
      sh.style.cssText = 'position:relative;width:2500px;height:1100px;border-radius:0;box-shadow:none;aspect-ratio:auto'
      sh.appendChild(src.cloneNode(true))
      wrap.appendChild(sh)
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1100"><foreignObject x="0" y="0" width="2500" height="1100">'
        + new XMLSerializer().serializeToString(wrap) + '</foreignObject></svg>'
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      await new Promise(r => setTimeout(r, 200))   // шрифт внутри картинки
      const cv = document.createElement('canvas')
      cv.width = 2500; cv.height = 1100
      cv.getContext('2d').drawImage(img, 0, 0)
      return await new Promise(r => cv.toBlob(r, 'image/png'))
    },
    png: async () => {
      const list = items(), btn = $('b-png'), was = btn.textContent
      btn.disabled = true; btn.textContent = 'Готовлю картинку…'
      try {
        for (let i = 0; i < list.length; i++) {
          const blob = await window.RepCert._pngBlob(i)
          if (!blob) break
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'Сертификат ' + (list[i].code || 'Rep Chess') + (st.named && st.name && list.length === 1 ? ' — ' + st.name : '') + '.png'
          document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
          if (list.length > 1) await new Promise(r => setTimeout(r, 500))
        }
        $('f-msg').textContent = list.length > 1 ? 'Картинок: ' + list.length + ' — браузер может спросить разрешение на несколько загрузок' : ''
        await ensureCode()
      } catch (e) {
        $('f-msg').textContent = 'Картинка не получилась: ' + (e.message || e) + '. Скачайте PDF.'
      } finally { btn.disabled = false; btn.textContent = was }
    },
    copyLink: () => {
      const u = link()
      ;(navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(
        () => { $('f-msg').textContent = 'Ссылка скопирована' },
        () => { prompt('Ссылка на сертификат:', u) })
    },
  }

  $('f-named').addEventListener('change', e => render({ named: e.target.checked }))
  document.querySelectorAll('#f-delivery button').forEach(b => b.addEventListener('click', () => render({ delivery: b.dataset.v })))
  $('f-name').addEventListener('input', e => render({ name: e.target.value }))
  $('f-code').addEventListener('input', e => render({ code: e.target.value }))
  // пустое или неверное число — макет не трогаем, поле остаётся как есть
  $('f-n').addEventListener('input', e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 99) render({ n: v, nOther: true }) })
  $('f-until').addEventListener('change', e => render({ until: e.target.value }))
  document.querySelectorAll('#f-nq button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.n) render({ n: +b.dataset.n, nOther: false })
    else { render({ nOther: true }); $('f-n').focus(); $('f-n').select() }
  }))
  document.querySelectorAll('#f-kind button').forEach(b => b.addEventListener('click', () => render({ kind: b.dataset.v })))
  document.querySelectorAll('#f-format button').forEach(b => b.addEventListener('click', () => render({ format: b.dataset.v })))
  window.addEventListener('resize', scale)
  render(fromUrl())
  // ширина строк зависит от шрифта — пересчитать, когда он догрузится
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render({}))
})()
</script>
</body>
</html>
'''
html = (html.replace('__FONT__', font).replace('__BG__', bg).replace('__TITLE__', a['title'])
        .replace('__LAYER__', a['layer']).replace('__MODS__', ''.join(mods)).replace('__FINDER__', a['finder'])
        .replace('__QRSTYLE__', qr_style))
out = sys.argv[1]
open(out, 'w', encoding='utf-8').write(html)
print(out, len(html) // 1024, 'KB')
