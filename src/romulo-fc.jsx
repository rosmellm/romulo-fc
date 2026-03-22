import { useState, useRef, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Meses activos: desde Ene hasta el mes actual inclusive.
// Si hoy es antes del día 16, el mes actual aún no se cobra (corte = día 16).
// Si hoy es día 16 o después, el mes actual ya es cobrable.
const _hoyPago   = new Date();
const _mesIdx    = _hoyPago.getDate() >= 16 ? _hoyPago.getMonth() : _hoyPago.getMonth() - 1;
const ACTIVE_MONTHS = MONTHS.slice(0, Math.max(1, _mesIdx + 1));
// Mes actual de cobro (el último mes activo)
const MES_COBRO = ACTIVE_MONTHS[ACTIVE_MONTHS.length - 1];
const CATS   = ["Sub-11","Sub-13","Sub-15","Sub-17","Sub-19"];

// Rangos de edad por categoría — se actualizan automáticamente cada año
// Base: 2026 → Sub-11: 2016-2017, Sub-13: 2014-2015, Sub-15: 2012-2013, Sub-17: 2010-2011, Sub-19: 2008-2009
const BASE_YEAR = 2026;
const BASE_RANGES = { "Sub-11":[2016,2017], "Sub-13":[2014,2015], "Sub-15":[2012,2013], "Sub-17":[2010,2011], "Sub-19":[2008,2009] };
function getCatRanges() {
  const diff = new Date().getFullYear() - BASE_YEAR;
  const ranges = {};
  Object.entries(BASE_RANGES).forEach(([cat,[min,max]]) => {
    ranges[cat] = [min+diff, max+diff];
  });
  return ranges;
}
const CAT_RANGES = getCatRanges(); // { "Sub-11": [2016,2017], ... }
function getCatByYear(anio) {
  for (const [cat,[min,max]] of Object.entries(CAT_RANGES)) {
    if (anio >= min && anio <= max) return cat;
  }
  return null;
}

const CAT_COLOR = {
  "Sub-11":"#1565C0","Sub-13":"#0D47A1","Sub-15":"#1976D2",
  "Sub-17":"#1E88E5","Sub-19":"#2196F3"
};

// Coaches — vienen 100% de Firebase, sin defaults hardcoded
const COACHES_DEFAULT = [];

// Datos iniciales vacíos — todo viene de Firebase
const INIT_PLAYERS = [];
const INIT_MATCHES = [];

// ─── HELPERS ──────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2,"0"); }

function calcAge(dob) {
  if (!dob) return "?";
  const b = new Date(dob);
  const n = new Date();
  const age = n.getFullYear() - b.getFullYear();
  const before = n < new Date(n.getFullYear(), b.getMonth(), b.getDate());
  return before ? age - 1 : age;
}

function timeAgo(iso) {
  if (!iso) return "";
  const fecha  = new Date(iso);
  const ahora  = new Date();
  const s      = Math.floor((ahora - fecha) / 1000);
  if (s < 60) return "Ahora mismo";
  const mismodia =
    fecha.getDate()     === ahora.getDate()   &&
    fecha.getMonth()    === ahora.getMonth()  &&
    fecha.getFullYear() === ahora.getFullYear();
  if (mismodia) return "Hoy " + pad2(fecha.getHours()) + ":" + pad2(fecha.getMinutes());
  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  const esAyer =
    fecha.getDate()     === ayer.getDate()   &&
    fecha.getMonth()    === ayer.getMonth()  &&
    fecha.getFullYear() === ayer.getFullYear();
  if (esAyer) return "Ayer";
  const DIAS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  if (s < 7 * 86400) return DIAS[fecha.getDay()];
  if (fecha.getFullYear() === ahora.getFullYear()) return fecha.getDate() + " " + MONTHS[fecha.getMonth()];
  return fecha.getDate() + " " + MONTHS[fecha.getMonth()] + " " + fecha.getFullYear();
}

// ── Demo guard: bloquea escrituras a Firebase en modo demo ──────
function isDemoSession() {
  try { const s = sessionStorage.getItem("rfc_session"); return s ? JSON.parse(s)?.isDemo : false; }
  catch { return false; }
}

// Carga jsPDF + html2canvas una sola vez
function loadPdfLibs() {
  function loadScript(src) {
    return new Promise(res => {
      if (document.querySelector('script[src="'+src+'"]')) { res(); return; }
      const s = document.createElement("script");
      s.src = src; s.onload = res;
      document.head.appendChild(s);
    });
  }
  return Promise.all([
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js")
  ]);
}

// Convierte un div a PDF A4 y lo descarga
function divToPdf(div, filename, cb) {
  window.html2canvas(div, {
    scale: 2, useCORS: true, backgroundColor: "#04060c", width: 794, height: 1123
  }).then(canvas => {
    document.body.removeChild(div);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
    pdf.save(filename);
    if (cb) cb();
  });
}

function generatePerfilPdf(p, pay, att, matches, attMatches, sanc) {
  loadPdfLibs().then(() => {
    // Stats del jugador
    const stats  = p.stats || { goles:0, asistencias:0, partidos:0 };
    const sancP  = sanc[p.id] || { yellows:0, reds:0 };
    const MONTHS_ALL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const hoy    = new Date(); const diaCorte = 16;
    const mesIdx = hoy.getDate()>=diaCorte ? hoy.getMonth() : hoy.getMonth()-1;
    const ACTIVE = MONTHS_ALL.slice(0, Math.max(1, mesIdx+1));
    const payP   = pay[p.id];
    const pagados = payP ? ACTIVE.filter(m=>payP.months[m]?.paid).length : 0;
    const alDia  = pagados === ACTIVE.length;

    // Asistencia entrenos
    const attP   = att[p.id] || {};
    const totalS = Object.keys(attP).length;
    const presS  = Object.values(attP).filter(v=>v?.present||v===true).length;
    const attPct = totalS>0 ? Math.round(presS/totalS*100) : 0;

    // Últimos 5 partidos
    const ultP = matches.filter(m=>m.status==="finalizado"&&m.cat===p.cat)
      .sort((a,b)=>b.id-a.id).slice(0,5);

    // Eval técnica
    const evalKeys = [
      ["velocidad","⚡ Velocidad"],["tecnica","🎯 Técnica"],["tactica","🧠 Táctica"],
      ["fisico","💪 Físico"],["actitud","❤️ Actitud"],["trabajo","🤝 Trabajo"]
    ];
    const evalData = evalKeys.map(([k,l])=>[l, p["eval_"+k]||p.eval?.[k]||0]).filter(([,v])=>v>0);

    // Fecha
    const fechaGen = hoy.toLocaleDateString("es",{day:"numeric",month:"long",year:"numeric"});

    // Iniciales para avatar
    const iniciales = (p.nombre[0]||"")+(p.apellido[0]||"");

    const div = document.createElement("div");
    div.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;background:#04060c;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;box-sizing:border-box;";

    div.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:16px;background:#d4b84a;"></div>
      <div style="position:absolute;bottom:0;left:0;right:0;height:16px;background:#d4b84a;"></div>
      <div style="position:absolute;top:0;left:0;width:14px;height:100%;background:#E53935;"></div>
      <div style="position:absolute;top:0;right:0;width:14px;height:100%;background:#1565C0;"></div>

      <div style="margin:24px 44px 0;display:flex;flex-direction:column;">

        <!-- Encabezado del club -->
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:42px;font-weight:900;color:#2196F3;letter-spacing:5px;line-height:1.1;">RÓMULO</div>
          <div style="font-size:32px;font-weight:900;color:#E53935;letter-spacing:7px;margin-top:-4px;">F.C</div>
          <div style="font-size:12px;color:#6a8aa8;margin-top:3px;letter-spacing:1.5px;">Academia de Fútbol Sala · Temporada ${hoy.getFullYear()}</div>
          <div style="height:2px;background:#d4b84a;margin:12px auto;width:75%;border-radius:1px;"></div>
          <div style="font-size:16px;font-weight:700;color:#d4b84a;letter-spacing:3px;">PERFIL DEL JUGADOR</div>
        </div>

        <!-- Foto + datos principales -->
        <div style="display:flex;align-items:center;gap:24px;background:rgba(21,101,192,.08);border-radius:14px;padding:20px 24px;border:1px solid rgba(33,150,243,.15);margin-bottom:16px;">
          ${p.foto ? `
            <div style="width:110px;height:110px;border-radius:50%;overflow:hidden;border:4px solid #d4b84a;flex-shrink:0;">
              <img src="${p.foto}" style="width:100%;height:100%;object-fit:cover;" crossorigin="anonymous"/>
            </div>
          ` : `
            <div style="width:110px;height:110px;border-radius:50%;background:rgba(33,150,243,.15);border:4px solid #d4b84a;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:900;color:#2196F3;">
              ${iniciales}
            </div>
          `}
          <div style="flex:1;">
            <div style="font-size:32px;font-weight:900;color:#ffffff;line-height:1.1;">${p.nombre} ${p.apellido}</div>
            <div style="font-size:15px;color:#7ab3e0;margin-top:5px;letter-spacing:.5px;">${p.cat} · Camiseta #${p.num}</div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
              <span style="background:rgba(33,150,243,.2);color:#7ab3e0;font-size:12px;padding:4px 12px;border-radius:20px;">✅ Activo</span>
              <span style="background:${alDia?"rgba(33,150,243,.2)":"rgba(229,57,53,.2)"};color:${alDia?"#7ab3e0":"#e8a0a0"};font-size:12px;padding:4px 12px;border-radius:20px;">
                ${alDia?"💳 Al día":"💳 "+pagados+"/"+ACTIVE.length+" meses"}
              </span>
              ${sancP.reds>0?`<span style="background:rgba(229,57,53,.2);color:#e8a0a0;font-size:12px;padding:4px 12px;border-radius:20px;">🟥 SUSPENDIDO</span>`:""}
            </div>
            <div style="font-size:13px;color:#6a8aa8;margin-top:8px;">CI: ${p.cedula||"—"}</div>
          </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
          ${[["⚽","Goles",stats.goles||0,"#2196F3"],["🎯","Asist.",stats.asistencias||0,"#7ab3e0"],["🏟️","Partidos",stats.partidos||0,"#afc4d8"],["✅","Asistencia",attPct+"%","#d4b84a"]].map(([ic,lb,val,col])=>`
            <div style="background:rgba(21,101,192,.1);border-radius:10px;padding:12px;text-align:center;border:1px solid rgba(33,150,243,.15);">
              <div style="font-size:20px;margin-bottom:4px;">${ic}</div>
              <div style="font-size:28px;font-weight:900;color:${col};">${val}</div>
              <div style="font-size:11px;color:#4e6a88;margin-top:2px;">${lb}</div>
            </div>
          `).join("")}
        </div>

        <!-- Evaluación técnica -->
        ${evalData.length>0?`
          <div style="background:rgba(212,184,74,.06);border-radius:12px;padding:14px 18px;border:1px solid rgba(212,184,74,.2);margin-bottom:16px;">
            <div style="font-size:13px;font-weight:700;color:#d4b84a;letter-spacing:2px;margin-bottom:12px;">⭐ EVALUACIÓN TÉCNICA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${evalData.map(([lb,val])=>`
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                    <span style="color:#afc4d8;">${lb}</span><span style="color:#d4b84a;font-weight:700;">${val}/10</span>
                  </div>
                  <div style="background:rgba(255,255,255,.06);border-radius:4px;height:6px;">
                    <div style="width:${val*10}%;height:6px;border-radius:4px;background:#d4b84a;"></div>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        `:""}

        <!-- Últimos partidos -->
        ${ultP.length>0?`
          <div style="background:rgba(255,255,255,.03);border-radius:12px;padding:14px 18px;border:1px solid rgba(255,255,255,.07);margin-bottom:16px;">
            <div style="font-size:13px;font-weight:700;color:#7ab3e0;letter-spacing:2px;margin-bottom:10px;">📋 ÚLTIMOS PARTIDOS</div>
            ${ultP.map(m=>{
              const esCasa=m.home==="Rómulo FC"||m.home?.includes("Rómulo");
              const gRFC=esCasa?m.scoreH:m.scoreA,gRiv=esCasa?m.scoreA:m.scoreH;
              const res=gRFC>gRiv?"V":gRFC<gRiv?"D":"E";
              const col=res==="V"?"#2196F3":res==="D"?"#E53935":"#d4b84a";
              const psM=m.playerStats?.[p.id]||{};
              return `
                <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                  <span style="font-size:18px;font-weight:900;color:${col};width:16px;">${res}</span>
                  <span style="font-size:12px;color:#afc4d8;flex:1;">${m.home} ${m.scoreH}–${m.scoreA} ${m.away}</span>
                  <span style="font-size:11px;color:#6a8aa8;">${m.date}</span>
                  ${(psM.goles||0)>0?`<span style="font-size:11px;color:#d4b84a;">⚽${psM.goles}</span>`:""}
                  ${m.mvp?.playerId===p.id?`<span style="font-size:11px;color:#d4b84a;">🏅</span>`:""}
                </div>`;
            }).join("")}
          </div>
        `:""}

        <!-- Representante -->
        <div style="background:rgba(255,255,255,.03);border-radius:12px;padding:14px 18px;border:1px solid rgba(255,255,255,.07);">
          <div style="font-size:13px;font-weight:700;color:#7ab3e0;letter-spacing:2px;margin-bottom:8px;">👨‍👦 REPRESENTANTE</div>
          <div style="font-size:15px;color:#c0cfe0;">${p.repNombre||""} ${p.repApellido||""}</div>
          <div style="font-size:13px;color:#6a8aa8;margin-top:4px;">📞 ${p.repTel||"—"} &nbsp;·&nbsp; CI: ${p.repCedula||"—"}</div>
        </div>

      </div>

      <!-- Pie de página -->
      <div style="position:absolute;bottom:26px;left:0;right:0;text-align:center;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;">
        <div style="font-size:12px;color:#6a8aa8;">Rómulo F.C · Generado el ${fechaGen}</div>
      </div>
    `;

    document.body.appendChild(div);
    divToPdf(div, "perfil_"+p.nombre+"_"+p.apellido+".pdf", null);
  });
}

function openWA(phone, msg) {
  const n = String(phone).replace(/\D/g,"");
  const num = n.startsWith("58") ? n : "58" + n.replace(/^0/,"");
  window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(msg), "_blank");
}

function initPay(players) {
  const s = {};
  players.forEach(p => {
    s[p.id] = {
      months: MONTHS.reduce((a,m) => ({ ...a, [m]: { paid: Math.random() > 0.45, date: null } }), {}),
      championships: {},   // { [champId]: { paid: bool, date: null } }
      arbitraje: [],
      history: []
    };
  });
  return s;
}

function initSanc(players) {
  const s = {};
  players.forEach(p => { s[p.id] = { yellows: 0, reds: 0, suspended: false, history: [] }; });
  return s;
}

function initAtt(players) {
  // att[playerId][trainingId] = { present: bool }
  const s = {};
  players.forEach(p => { s[p.id] = {}; });
  return s;
}

import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc,
  onSnapshot, setDoc, updateDoc, deleteDoc, getDoc,
  enableIndexedDbPersistence
} from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// ── Firebase config ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCsmzGN3-0K1kW9G1TLaApz-U",
  authDomain:        "romulo-fc.firebaseapp.com",
  projectId:         "romulo-fc",
  storageBucket:     "romulo-fc.firebasestorage.app",
  messagingSenderId: "849856996590",
  appId:             "1:849856996590:web:39b3900e7715",
  measurementId:     "G-WSM1G7GNN3"
};
const fbApp     = initializeApp(firebaseConfig);
const db        = getFirestore(fbApp);
const messaging = getMessaging(fbApp);

// ── Modo offline: persistencia local con IndexedDB ──
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("Offline: múltiples pestañas abiertas");
  } else if (err.code === "unimplemented") {
    console.warn("Offline: navegador no soportado");
  }
});

// VAPID key — la obtienes en Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = "BEbMBO0z6wJn_Go07XmMsZuujs7Y0n3cm-WmAPCkXubfzs3chUBJpwLCDw_fLY89MJ5Zzauq7-3ZS7zswC4z08s";


const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap&font-display=swap');
*{box-sizing:border-box;margin:0;padding:0;}

/* ── Variables modo oscuro (default) ── */
:root {
  --bg:        var(--bg);
  --bg2:       #06091a;
  --bg3:       #090d1a;
  --bg4:       #0a0f1e;
  --txt:       #afc4d8;
  --txt2:      #7ab3e0;
  --txt3:      #4e6a88;
  --txt4:      #3a5068;
  --brd:       rgba(33,150,243,.08);
  --brd2:      rgba(33,150,243,.15);
  --card:      #06091a;
  --hdr:       rgba(4,6,12,.97);
  --inp:       #090d1a;
  --shadow:    rgba(0,0,0,.5);
}

/* ── Variables modo claro ── */
body.light {
  --bg:        #f0f4f8;
  --bg2:       #ffffff;
  --bg3:       #e8eef5;
  --bg4:       #dde6f0;
  --txt:       #1a2a3a;
  --txt2:      #1565C0;
  --txt3:      #4a6080;
  --txt4:      #7a90a8;
  --brd:       rgba(21,101,192,.12);
  --brd2:      rgba(21,101,192,.25);
  --card:      #ffffff;
  --hdr:       rgba(240,244,248,.97);
  --inp:       #f8fafc;
  --shadow:    rgba(0,0,0,.1);
}

body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;font-size:13px;letter-spacing:.01em;transition:background .2s,color .2s;}
.app{max-width:430px;margin:0 auto;min-height:100vh;background:var(--bg);position:relative;}
.hdr{background:var(--hdr);padding:11px 15px 9px;border-bottom:1px solid var(--brd);position:sticky;top:0;z-index:100;backdrop-filter:blur(10px);}
.hdr-row{display:flex;justify-content:space-between;align-items:center;}
.logo{font-family:'Bebas Neue',sans-serif;font-size:22px;font-weight:400;letter-spacing:2px;}
.lb{color:#2196F3;}.lr{color:#E53935;}
.hdr-sub{font-size:7px;color:#3a5068;letter-spacing:2px;text-transform:uppercase;margin-top:1px;font-family:'DM Sans',sans-serif;}
.hdr-right{display:flex;gap:5px;align-items:center;}
.badge{font-size:7.5px;font-weight:500;padding:2px 8px;border-radius:4px;letter-spacing:.3px;font-family:'DM Sans',sans-serif;}
.badge-r{background:rgba(183,28,28,.12);color:#e8a0a0;border:1px solid rgba(229,57,53,.16);}
.badge-b{background:rgba(21,101,192,.12);color:#7ab3e0;border:1px solid rgba(33,150,243,.16);}
.ico-btn{width:29px;height:29px;border-radius:50%;border:1px solid var(--brd);background:var(--bg3);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;position:relative;}
.rdot{width:6px;height:6px;background:#E53935;border-radius:50%;position:absolute;top:2px;right:2px;}
.nav{display:flex;gap:4px;overflow-x:auto;padding:7px 13px;background:var(--bg2);border-bottom:1px solid var(--brd);scrollbar-width:none;}
.nav::-webkit-scrollbar{display:none;}
.nb{flex-shrink:0;padding:4px 11px;border-radius:14px;border:1px solid var(--brd);background:transparent;color:var(--txt3);font-family:'DM Sans',sans-serif;font-size:10px;font-weight:400;cursor:pointer;white-space:nowrap;}
.nb.ab{background:#1565C0;border-color:#1565C0;color:#fff;font-weight:500;}
.cnt{padding:12px 14px 100px;}
.card{background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:12px;margin-bottom:9px;}
.card-r{border-color:rgba(229,57,53,.12);}
.ch{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;}
.ct{font-family:'Bebas Neue',sans-serif;font-size:13px;font-weight:400;letter-spacing:.3px;}
.bg{padding:2px 8px;border-radius:10px;font-size:8px;font-weight:500;font-family:'DM Sans',sans-serif;}
.bg-b{background:rgba(33,150,243,.07);color:#7ab3e0;border:1px solid rgba(33,150,243,.12);}
.bg-r{background:rgba(229,57,53,.07);color:#e8a0a0;border:1px solid rgba(229,57,53,.12);}
.bg-g{background:rgba(21,101,192,.1);color:#7ab3e0;border:1px solid rgba(33,150,243,.15);}
.bg-y{background:rgba(255,214,0,.06);color:#d4b84a;border:1px solid rgba(255,214,0,.12);}
.bg-n{background:rgba(255,255,255,.03);color:#3a5068;border:1px solid rgba(255,255,255,.05);}
.sr3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;}
.sr4{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;}
.sb{background:var(--inp);border:1px solid var(--brd);border-radius:9px;padding:9px 5px;text-align:center;}
.sn{font-family:'Bebas Neue',sans-serif;font-size:24px;font-weight:400;line-height:1;}
.sl{font-size:7px;color:#3a5068;margin-top:1px;text-transform:uppercase;letter-spacing:.3px;font-family:'DM Sans',sans-serif;}
.pr{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd);}
.pr:last-child{border-bottom:none;}
.av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-weight:400;color:#fff;flex-shrink:0;overflow:hidden;}
.av img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
.pi{flex:1;min-width:0;}
.pn{font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ps{font-size:8px;color:#3a5068;}
.ck{width:23px;height:23px;border-radius:6px;border:1.5px solid rgba(33,150,243,.15);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}
.ck.on{background:#1565C0;border-color:#1565C0;}
.pb{height:3px;background:var(--inp);border-radius:2px;overflow:hidden;margin-top:3px;}
.pf{height:100%;border-radius:2px;}
.pf-b{background:linear-gradient(90deg,#0D47A1,#1976D2);}
.pf-r{background:linear-gradient(90deg,#B71C1C,#E53935);}
.mc{background:var(--inp);border-radius:9px;padding:10px;margin-bottom:7px;border:1px solid var(--brd);}
.mt{display:flex;justify-content:space-between;align-items:center;gap:4px;}
.tn{font-family:'Bebas Neue',sans-serif;font-size:13px;font-weight:400;flex:1;}
.tn-h{text-align:left;}.tn-a{text-align:right;}
.sc{background:var(--card);border:1px solid rgba(33,150,243,.1);border-radius:6px;padding:3px 9px;font-family:'Bebas Neue',sans-serif;font-size:17px;font-weight:400;color:#2196F3;flex-shrink:0;}
.mm{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px;}
.mi{font-size:8px;color:#3a5068;background:var(--card);border-radius:4px;padding:2px 5px;}
.dtabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:9px;}
.dt{padding:4px 9px;border-radius:7px;font-size:9px;cursor:pointer;border:1px solid var(--brd);background:transparent;color:#3a5068;font-family:'DM Sans',sans-serif;}
.dt.da{border-color:#1565C0;color:#7ab3e0;background:rgba(21,101,192,.08);}
.ptabs{display:flex;border-radius:8px;overflow:hidden;border:1px solid var(--brd);margin-bottom:10px;}
.pt{flex:1;padding:7px 3px;text-align:center;font-size:9px;font-weight:400;cursor:pointer;color:#3a5068;font-family:'DM Sans',sans-serif;}
.pt.pa{background:#1565C0;color:#fff;font-weight:500;}
.mgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-bottom:8px;}
.mcell{background:var(--inp);border:1px solid var(--brd);border-radius:5px;padding:4px 2px;text-align:center;cursor:pointer;}
.mcell.mp{background:rgba(21,101,192,.08);border-color:rgba(33,150,243,.18);}
.mcell.mup{background:rgba(229,57,53,.05);border-color:rgba(229,57,53,.12);}
.mcell.mex{background:rgba(212,184,74,.07);border-color:rgba(212,184,74,.25);}
.mclbl{font-size:7px;color:#3a5068;font-family:'DM Sans',sans-serif;}
.mcico{font-size:10px;margin-top:1px;}
.inp{width:100%;background:var(--inp);border:1px solid rgba(33,150,243,.1);border-radius:8px;padding:7px 10px;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:11px;outline:none;}
.inp:focus{border-color:#1565C0;}
.inp::placeholder{color:#3a5068;}
.inp-wrap{margin-bottom:7px;}
.inp-lbl{font-size:8px;color:#4e6a88;font-weight:500;letter-spacing:.3px;text-transform:uppercase;margin-bottom:3px;font-family:'DM Sans',sans-serif;}
.inp-2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}
.fsec{font-family:'Bebas Neue',sans-serif;font-size:12px;font-weight:400;color:#2196F3;margin:10px 0 6px;}
.div{height:1px;background:rgba(33,150,243,.07);margin:9px 0;}
.btn{width:100%;background:#1565C0;border:none;border-radius:8px;padding:10px;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;letter-spacing:.3px;cursor:pointer;}
.btn:disabled{opacity:.35;cursor:not-allowed;}
.btn-red{background:#C62828;}
.btn-sm{padding:4px 9px;border-radius:6px;border:1px solid rgba(33,150,243,.1);background:transparent;color:#3a5068;font-size:9px;cursor:pointer;font-family:'DM Sans',sans-serif;}
.btn-wa{background:rgba(33,150,243,.07);border:1px solid rgba(33,150,243,.15);color:#7ab3e0;border-radius:7px;padding:5px 10px;font-size:9px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-family:'DM Sans',sans-serif;}
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:430px;background:var(--hdr);border-top:1px solid var(--brd);display:flex;overflow-x:auto;overflow-y:hidden;padding:6px 8px 13px;z-index:100;scrollbar-width:none;gap:2px;}
.bnav::-webkit-scrollbar{display:none;}
.bn{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;color:#3a5068;font-size:7px;letter-spacing:.2px;text-transform:uppercase;font-weight:400;font-family:'DM Sans',sans-serif;padding:4px 10px;border-radius:8px;min-width:52px;transition:background .15s;}
.bn.ba{color:#2196F3;background:rgba(33,150,243,.07);}
.bi{font-size:18px;}
.st{font-family:'Bebas Neue',sans-serif;font-size:17px;font-weight:400;letter-spacing:.3px;margin-bottom:9px;display:flex;align-items:center;gap:5px;}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:500;display:flex;align-items:flex-end;justify-content:center;}
.modal{background:var(--card);border:1px solid var(--brd2);border-top:2px solid #1565C0;border-radius:14px 14px 0 0;padding:16px 14px 32px;width:100%;max-width:430px;max-height:92vh;overflow-y:auto;}
.mt2{font-family:'Bebas Neue',sans-serif;font-size:14px;font-weight:400;letter-spacing:.3px;margin-bottom:11px;display:flex;justify-content:space-between;align-items:center;}
.mx{font-size:16px;cursor:pointer;color:#3a5068;}
.aov{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:600;display:flex;align-items:center;justify-content:center;padding:18px;}
.abox{background:var(--card);border:1px solid rgba(33,150,243,.1);border-radius:12px;padding:18px 16px;width:100%;max-width:300px;}
.at{font-family:'Bebas Neue',sans-serif;font-size:14px;font-weight:400;letter-spacing:.3px;margin-bottom:6px;}
.am{font-size:10px;color:#3a5068;line-height:1.5;margin-bottom:14px;font-family:'DM Sans',sans-serif;}
.ab2{display:flex;gap:6px;}
.ac{flex:1;padding:8px;border-radius:7px;border:1px solid rgba(33,150,243,.1);background:transparent;color:#3a5068;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;}
.ao{flex:1;padding:8px;border-radius:7px;border:none;background:#1565C0;color:#fff;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500;}
.ao.red{background:#C62828;}
.ok{background:rgba(21,101,192,.07);border:1px solid rgba(33,150,243,.13);border-radius:7px;padding:7px 10px;font-size:9px;color:#7ab3e0;margin-top:6px;text-align:center;}
.err{font-size:9px;color:#e8a0a0;margin-top:3px;font-family:'DM Sans',sans-serif;}
.warn-box{background:rgba(255,214,0,.03);border:1px solid rgba(255,214,0,.1);border-radius:9px;padding:8px 10px;margin-bottom:9px;display:flex;align-items:flex-start;gap:7px;font-size:9px;color:#d4b84a;line-height:1.5;font-family:'DM Sans',sans-serif;}
.notif-row{display:flex;gap:7px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.02);cursor:pointer;}
.notif-row:last-child{border-bottom:none;}
.hist-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.02);font-size:9px;font-family:'DM Sans',sans-serif;}
.hist-row:last-child{border-bottom:none;}
.photo-up{width:52px;height:52px;border-radius:50%;background:var(--inp);border:2px dashed rgba(33,150,243,.15);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;position:relative;overflow:hidden;}
.photo-up img{width:100%;height:100%;object-fit:cover;position:absolute;border-radius:50%;}
.hero{background:var(--inp);border:1px solid var(--brd);border-radius:12px;padding:14px;margin-bottom:9px;text-align:center;}
.hero-av{width:52px;height:52px;border-radius:50%;margin:0 auto 7px;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px;font-weight:400;color:#fff;border:2px solid #1565C0;overflow:hidden;}
.hero-av img{width:100%;height:100%;object-fit:cover;}
.hero-name{font-family:'Bebas Neue',sans-serif;font-size:18px;font-weight:400;}
.hero-cat{font-size:9px;color:#3a5068;margin-top:2px;font-family:'DM Sans',sans-serif;}
.crow{display:flex;align-items:flex-start;gap:7px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.02);}
.crow:last-child{border-bottom:none;}
.perms{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;}
.perm{font-size:7px;padding:1px 5px;border-radius:3px;background:rgba(33,150,243,.06);color:#5a8ab0;border:1px solid rgba(33,150,243,.1);font-family:'DM Sans',sans-serif;}
.login{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px;background:radial-gradient(ellipse at 20% 25%,rgba(13,71,161,.15) 0%,transparent 50%),radial-gradient(ellipse at 80% 75%,rgba(183,28,28,.1) 0%,transparent 50%),var(--bg);}
.login-logo{font-family:'Bebas Neue',sans-serif;font-size:52px;font-weight:400;letter-spacing:6px;margin-bottom:3px;text-align:center;}
.login-sub{font-size:7.5px;color:#3a5068;letter-spacing:2px;text-transform:uppercase;margin-bottom:26px;text-align:center;font-family:'DM Sans',sans-serif;}
.lcard{width:100%;max-width:370px;background:var(--card);border:1px solid rgba(33,150,243,.1);border-radius:14px;padding:16px 14px;}
.ltitle{font-family:'Bebas Neue',sans-serif;font-size:20px;font-weight:400;letter-spacing:1px;margin-bottom:10px;}
.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.ropt{padding:10px 7px;background:var(--inp);border:1px solid var(--brd);border-radius:9px;cursor:pointer;text-align:center;}
.ropt:hover,.ropt.rsel{border-color:#1565C0;background:rgba(21,101,192,.07);}
.ro-ico{font-size:18px;margin-bottom:3px;}
.ro-lbl{font-size:9px;font-weight:500;font-family:'DM Sans',sans-serif;}
.ro-sub{font-size:7px;color:#3a5068;margin-top:1px;font-family:'DM Sans',sans-serif;}
.clist{display:flex;flex-direction:column;gap:4px;margin-bottom:9px;max-height:180px;overflow-y:auto;}
.citem{padding:7px 10px;background:var(--inp);border:1px solid var(--brd);border-radius:7px;cursor:pointer;font-size:10px;display:flex;justify-content:space-between;align-items:center;font-family:'DM Sans',sans-serif;}
.citem:hover,.citem.csel{border-color:#1565C0;color:#7ab3e0;}
.ci-role{font-size:7px;color:#3a5068;}
.linp{width:100%;background:var(--inp);border:1px solid rgba(33,150,243,.1);border-radius:8px;padding:8px 10px;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:11px;margin-bottom:6px;outline:none;}
.linp:focus{border-color:#1565C0;}
.linp::placeholder{color:#3a5068;}
.lbtn{width:100%;background:#1565C0;border:none;border-radius:8px;padding:10px;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;letter-spacing:.3px;cursor:pointer;}
.lerr{font-size:9px;color:#e8a0a0;margin-top:5px;text-align:center;font-family:'DM Sans',sans-serif;}
.back{font-size:9px;color:#3a5068;cursor:pointer;text-align:center;margin-top:7px;text-decoration:underline;font-family:'DM Sans',sans-serif;}
.hint{font-size:7.5px;color:#3a5068;margin-top:5px;text-align:center;font-family:'DM Sans',sans-serif;}
.live-hdr{background:rgba(4,6,12,.98);padding:8px 14px 6px;border-bottom:1px solid var(--brd);position:sticky;top:0;z-index:50;}
.scoreboard{padding:10px 14px 8px;background:linear-gradient(180deg,rgba(6,9,26,1),rgba(4,6,12,.97));border-bottom:1px solid var(--brd);}
.period-lbl{text-align:center;font-size:7px;font-weight:400;letter-spacing:2px;text-transform:uppercase;color:#3a5068;margin-bottom:5px;font-family:'DM Sans',sans-serif;}
.score-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}
.score-team{font-family:'Bebas Neue',sans-serif;font-size:12px;font-weight:400;flex:1;color:#5a7a94;}
.score-nums{display:flex;align-items:center;gap:5px;}
.score-n{font-family:'Bebas Neue',sans-serif;font-size:52px;font-weight:400;line-height:1;letter-spacing:2px;}
.score-sep{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#3a5068;}
.chrono{font-family:'Bebas Neue',sans-serif;font-size:36px;font-weight:400;text-align:center;letter-spacing:5px;}
.c-p1{color:#2196F3;}.c-p2{color:#E53935;}.c-et{color:#d4b84a;}
.c-off{color:#d4b84a;animation:blink .9s infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes liveBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}
.tm-row{display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;}
.tm-side{display:flex;align-items:center;gap:5px;}
.tm-lbl{font-size:7px;color:#3a5068;font-weight:400;text-transform:uppercase;font-family:'DM Sans',sans-serif;}
.tm-pill{font-size:8px;font-weight:500;padding:2px 7px;border-radius:9px;font-family:'DM Sans',sans-serif;}
.tm-ok{background:rgba(21,101,192,.08);color:#7ab3e0;border:1px solid rgba(33,150,243,.15);}
.tm-used{background:rgba(229,57,53,.06);color:#e8a0a0;border:1px solid rgba(229,57,53,.12);opacity:.6;}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px;}
.fcard{background:var(--inp);border:1px solid var(--brd);border-radius:9px;padding:8px 10px;}
.ftitle{font-size:7px;font-weight:400;text-transform:uppercase;letter-spacing:.5px;color:#3a5068;margin-bottom:4px;font-family:'DM Sans',sans-serif;}
.fcount{font-family:'Bebas Neue',sans-serif;font-size:21px;font-weight:400;line-height:1;margin-bottom:4px;}
.fdots{display:flex;gap:3px;}
.fdot{width:11px;height:11px;border-radius:50%;border:1px solid rgba(33,150,243,.12);background:transparent;}
.fdot.fon{background:#E53935;border-color:#E53935;}
.fdot.fwn{background:#d4b84a;border-color:#d4b84a;}
.fnote{font-size:7px;margin-top:3px;font-family:'DM Sans',sans-serif;}
.abgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 14px;margin-bottom:8px;}
.abtn{padding:9px 5px;border-radius:8px;border:1px solid var(--brd);background:var(--inp);color:var(--txt);font-size:9px;font-weight:400;cursor:pointer;font-family:'DM Sans',sans-serif;text-align:center;}
.abtn:active{transform:scale(.96);}
.abtn-b{background:rgba(21,101,192,.12);border-color:rgba(33,150,243,.2);color:#7ab3e0;}
.abtn-r{background:rgba(183,28,28,.12);border-color:rgba(229,57,53,.2);color:#e8a0a0;}
.abtn-y{background:rgba(255,214,0,.05);border-color:rgba(255,214,0,.14);color:#d4b84a;}
.abtn-o{background:rgba(183,28,28,.08);border-color:rgba(229,57,53,.15);color:#e0a880;}
.abtn-dim{opacity:.3;pointer-events:none;}
.abtn-full{grid-column:1/-1;}
.psgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;max-height:220px;overflow-y:auto;margin:6px 0;}
.psbtn{background:var(--inp);border:1px solid var(--brd);border-radius:8px;padding:8px 7px;cursor:pointer;display:flex;align-items:center;gap:6px;}
.psbtn.pssel{border-color:#1565C0;background:rgba(21,101,192,.1);}
.psbtn.psred{border-color:#C62828;background:rgba(183,28,28,.08);}
.psbtn-n{font-size:10px;font-weight:500;font-family:'DM Sans',sans-serif;}
.psbtn-s{font-size:7.5px;color:#3a5068;margin-top:1px;font-family:'DM Sans',sans-serif;}
.ftype-row{display:flex;gap:6px;margin-bottom:9px;}
.ftype-btn{flex:1;padding:9px 5px;border-radius:8px;border:1px solid var(--brd);background:var(--inp);color:#3a5068;font-size:9px;font-weight:400;cursor:pointer;text-align:center;font-family:'DM Sans',sans-serif;}
.ftype-btn.ftd{border-color:#C62828;background:rgba(183,28,28,.1);color:#e8a0a0;}
.ftype-btn.fti{border-color:rgba(255,214,0,.3);background:rgba(255,214,0,.05);color:#d4b84a;}
.ftype-note{font-size:8px;color:#3a5068;margin-bottom:8px;padding:6px 8px;background:var(--inp);border-radius:6px;line-height:1.5;font-family:'DM Sans',sans-serif;}
.riv-row{display:flex;align-items:center;gap:7px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.02);}
.riv-row:last-child{border-bottom:none;}
.riv-num{font-family:'Bebas Neue',sans-serif;font-size:18px;font-weight:400;color:#e8a0a0;width:30px;text-align:center;flex-shrink:0;}
.riv-name{flex:1;font-size:10px;font-family:'DM Sans',sans-serif;}
.riv-stats{font-size:7.5px;color:#3a5068;font-family:'DM Sans',sans-serif;}
.evlog{max-height:160px;overflow-y:auto;scrollbar-width:none;}
.evlog::-webkit-scrollbar{display:none;}
.ev{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.02);}
.ev:last-child{border-bottom:none;}
.ev-min{font-family:'Bebas Neue',sans-serif;font-size:13px;font-weight:400;color:#2196F3;width:22px;flex-shrink:0;}
.ev-ico{font-size:12px;width:15px;text-align:center;flex-shrink:0;}
.ev-txt{font-size:9px;flex:1;color:#5a7a94;font-family:'DM Sans',sans-serif;}
.ev-p{font-size:7px;color:#3a5068;flex-shrink:0;font-family:'DM Sans',sans-serif;}
.lu-slot{background:var(--inp);border:1px solid var(--brd);border-radius:7px;padding:7px;display:flex;align-items:center;gap:7px;margin-bottom:5px;}
.lu-idx{font-family:'Bebas Neue',sans-serif;font-size:15px;font-weight:400;color:#2196F3;width:17px;}
.sum-score{display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0;}
.sum-n{font-family:'Bebas Neue',sans-serif;font-size:60px;font-weight:400;line-height:1;letter-spacing:2px;}
`;

// ─── SHARED COMPONENTS ────────────────────────────────────────

function Avatar({ p, size }) {
  const sz = size || 32;
  const bg = p ? (p.col || "#1565C0") : "#1565C0";
  const letter = p ? p.nombre[0] : "?";
  return (
    <div className="av" style={{ background: bg, width: sz, height: sz, fontSize: sz * 0.38 }}>
      {p && p.foto ? <img src={p.foto} alt="" /> : letter}
    </div>
  );
}

function FoulDots({ count, max }) {
  const m = max || 5;
  return (
    <div className="fdots">
      {Array.from({ length: m }, (_, i) => {
        const filled = i < count;
        const warn   = filled && count >= 4;
        const cls    = "fdot" + (filled ? (warn ? " fwn" : " fon") : "");
        return <div key={i} className={cls} />;
      })}
    </div>
  );
}

function ConfirmDialog({ cfg, onClose }) {
  if (!cfg) return null;
  return (
    <div className="aov">
      <div className="abox">
        <div className="at">{cfg.title}</div>
        <div className="am">{cfg.msg}</div>
        <div className="ab2">
          {cfg.cancel !== false && (
            <button className="ac" onClick={onClose}>
              {cfg.cancelTxt || "Cancelar"}
            </button>
          )}
          <button
            className={"ao" + (cfg.danger ? " red" : "")}
            onClick={() => { cfg.ok && cfg.ok(); onClose(); }}
          >
            {cfg.okTxt || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Resultado Rápido — igual que live match ────────────────────────────
function QuickResultModal({ m, players, onClose, onSave }) {
  const catPls = players.filter(p => p.cat === m.cat);
  const [sH, setSH] = useState("");
  const [sA, setSA] = useState("");
  const [step, setStep] = useState("score"); // "score" | "players"
  // Stats por jugador: { [id]: { goles, asistencias, amarilla, roja } }
  const [ps, setPs] = useState(() => {
    const s = {}; catPls.forEach(p => { s[p.id]={goles:0,asistencias:0,amarilla:false,roja:false}; }); return s;
  });
  const [selPid, setSelPid] = useState(null); // jugador seleccionado para editar

  function bump(pid, field, max=99) {
    setPs(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: Math.min((prev[pid][field]||0)+1, max) } }));
  }
  function toggle(pid, field) {
    setPs(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: !prev[pid][field] } }));
  }
  function dec(pid, field) {
    setPs(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: Math.max(0,(prev[pid][field]||0)-1) } }));
  }

  function handleSave() {
    const scoreH = parseInt(sH)||0, scoreA = parseInt(sA)||0;
    // Armar events legibles
    const events = [];
    Object.entries(ps).forEach(([pid, stat]) => {
      const pl = catPls.find(x=>String(x.id)===String(pid));
      if (!pl) return;
      for (let i=0; i<(stat.goles||0); i++) events.push({ type:"goal_us", txt:"Gol: "+pl.nombre+" "+pl.apellido, ico:"⚽" });
      for (let i=0; i<(stat.asistencias||0); i++) events.push({ type:"assist", txt:"Asistencia: "+pl.nombre, ico:"🎯" });
      if (stat.amarilla) events.push({ type:"y_us", txt:pl.nombre+" tarjeta amarilla", ico:"🟨" });
      if (stat.roja)     events.push({ type:"r_us", txt:pl.nombre+" tarjeta roja", ico:"🟥" });
    });
    // Convertir ps a playerStats para Firebase
    const playerStats = {};
    Object.entries(ps).forEach(([pid, stat]) => {
      if (stat.goles||stat.asistencias||stat.amarilla||stat.roja)
        playerStats[pid] = { goles:stat.goles||0, asistencias:stat.asistencias||0 };
    });
    onSave(scoreH, scoreA, playerStats, events);
  }

  const selP = selPid ? catPls.find(x=>String(x.id)===String(selPid)) : null;

  return (
    <div className="ov" onClick={e=>{ if(e.target.className==="ov") onClose(); }}>
      <div className="modal" style={{ borderTop:"3px solid #d4b84a", maxHeight:"92vh", overflowY:"auto" }}>
        <div className="mt2" style={{ color:"#d4b84a" }}>
          📋 Registrar Resultado
          <span className="mx" onClick={onClose}>✕</span>
        </div>

        {/* Info partido */}
        <div style={{ background:"rgba(21,101,192,.07)", borderRadius:8, padding:"8px 12px",
          marginBottom:10, textAlign:"center" }}>
          <div style={{ fontSize:10, fontWeight:600 }}>{m.home} vs {m.away}</div>
          <div style={{ fontSize:8, color:"#4e6a88", marginTop:2 }}>{m.date} · {m.cat}</div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:5, marginBottom:12 }}>
          {[["score","⚽ Marcador"],["players","👥 Jugadores"]].map(([k,l])=>(
            <button key={k} className="btn-sm" style={{ flex:1, fontSize:9,
              background:step===k?"rgba(33,150,243,.2)":"rgba(255,255,255,.03)",
              color:step===k?"#7ab3e0":"#4e6a88",
              borderColor:step===k?"rgba(33,150,243,.4)":"rgba(255,255,255,.05)" }}
              onClick={()=>setStep(k)}>{l}</button>
          ))}
        </div>

        {/* PASO 1 — Marcador */}
        {step==="score" && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:8, color:"#4e6a88", marginBottom:4, textAlign:"center" }}>{m.home}</div>
                <input className="inp" type="number" min="0" value={sH} onChange={e=>setSH(e.target.value)}
                  style={{ textAlign:"center", fontSize:36, fontFamily:"'Bebas Neue',sans-serif",
                    color:"#7ab3e0", padding:"8px 0" }}/>
              </div>
              <div style={{ fontSize:22, color:"#4e6a88", fontFamily:"'Bebas Neue',sans-serif", paddingTop:20 }}>—</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:8, color:"#4e6a88", marginBottom:4, textAlign:"center" }}>{m.away}</div>
                <input className="inp" type="number" min="0" value={sA} onChange={e=>setSA(e.target.value)}
                  style={{ textAlign:"center", fontSize:36, fontFamily:"'Bebas Neue',sans-serif",
                    color:"#e8a0a0", padding:"8px 0" }}/>
              </div>
            </div>
            <button className="btn" style={{ width:"100%" }}
              onClick={()=>setStep("players")}>
              Siguiente → Jugadores
            </button>
          </>
        )}

        {/* PASO 2 — Stats por jugador */}
        {step==="players" && (
          <>
            <div style={{ fontSize:8.5, color:"#4e6a88", marginBottom:8 }}>
              Toca un jugador para registrar sus stats
            </div>
            {/* Lista compacta */}
            {catPls.map(pl => {
              const stat = ps[pl.id]||{};
              const hasData = stat.goles||stat.asistencias||stat.amarilla||stat.roja;
              const isSel = String(selPid)===String(pl.id);
              return (
                <div key={pl.id}>
                  <div onClick={()=>setSelPid(isSel?null:pl.id)}
                    style={{ display:"flex", alignItems:"center", gap:8,
                      padding:"8px 10px", borderRadius:8, cursor:"pointer", marginBottom:3,
                      background: isSel?"rgba(33,150,243,.12)":"rgba(255,255,255,.02)",
                      border:`1px solid ${isSel?"rgba(33,150,243,.3)":"rgba(255,255,255,.04)"}` }}>
                    <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(21,101,192,.2)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:10, fontWeight:700, color:"#7ab3e0", flexShrink:0 }}>
                      {pl.nombre[0]}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:9.5, fontWeight:600 }}>{pl.nombre} {pl.apellido}</div>
                      <div style={{ fontSize:7.5, color:"#4e6a88" }}>#{pl.num}</div>
                    </div>
                    {/* Resumen inline */}
                    <div style={{ display:"flex", gap:4, fontSize:9 }}>
                      {stat.goles>0 && <span style={{ color:"#d4b84a" }}>⚽{stat.goles}</span>}
                      {stat.asistencias>0 && <span style={{ color:"#7ab3e0" }}>🎯{stat.asistencias}</span>}
                      {stat.amarilla && <span>🟨</span>}
                      {stat.roja && <span>🟥</span>}
                      {!hasData && <span style={{ color:"#3a5068", fontSize:8 }}>—</span>}
                    </div>
                  </div>
                  {/* Panel de edición inline */}
                  {isSel && (
                    <div style={{ background:"rgba(21,101,192,.06)", border:"1px solid rgba(33,150,243,.15)",
                      borderRadius:8, padding:"10px", marginBottom:6 }}>
                      {/* Goles */}
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <span style={{ fontSize:9, color:"#7ab3e0", flex:1 }}>⚽ Goles</span>
                        <button className="btn-sm" style={{ padding:"2px 10px", fontSize:14 }}
                          onClick={()=>dec(pl.id,"goles")}>−</button>
                        <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                          color:"#d4b84a", minWidth:24, textAlign:"center" }}>{stat.goles||0}</span>
                        <button className="btn-sm" style={{ padding:"2px 10px", fontSize:14 }}
                          onClick={()=>bump(pl.id,"goles")}>+</button>
                      </div>
                      {/* Asistencias */}
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <span style={{ fontSize:9, color:"#7ab3e0", flex:1 }}>🎯 Asistencias</span>
                        <button className="btn-sm" style={{ padding:"2px 10px", fontSize:14 }}
                          onClick={()=>dec(pl.id,"asistencias")}>−</button>
                        <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                          color:"#d4b84a", minWidth:24, textAlign:"center" }}>{stat.asistencias||0}</span>
                        <button className="btn-sm" style={{ padding:"2px 10px", fontSize:14 }}
                          onClick={()=>bump(pl.id,"asistencias")}>+</button>
                      </div>
                      {/* Tarjetas */}
                      <div style={{ display:"flex", gap:8 }}>
                        <button className="btn-sm" style={{ flex:1, fontSize:9,
                          background: stat.amarilla?"rgba(212,184,74,.25)":"rgba(255,255,255,.03)",
                          borderColor: stat.amarilla?"rgba(212,184,74,.5)":"rgba(255,255,255,.05)",
                          color: stat.amarilla?"#d4b84a":"#4e6a88" }}
                          onClick={()=>toggle(pl.id,"amarilla")}>
                          🟨 Amarilla {stat.amarilla?"✓":""}
                        </button>
                        <button className="btn-sm" style={{ flex:1, fontSize:9,
                          background: stat.roja?"rgba(229,57,53,.2)":"rgba(255,255,255,.03)",
                          borderColor: stat.roja?"rgba(229,57,53,.4)":"rgba(255,255,255,.05)",
                          color: stat.roja?"#e8a0a0":"#4e6a88" }}
                          onClick={()=>toggle(pl.id,"roja")}>
                          🟥 Roja {stat.roja?"✓":""}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ display:"flex", gap:6, marginTop:8 }}>
              <button className="btn-sm" style={{ flex:1 }} onClick={()=>setStep("score")}>← Marcador</button>
              <button className="btn" style={{ flex:2,
                opacity:(sH===""||sA==="")?.4:1 }}
                onClick={handleSave}>
                💾 GUARDAR RESULTADO
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal para agregar jugador en pleno partido ──────────────────────────────
function AddPlayerModal({ match, rivals, myPlayers, curMin, onClose, onAddUs, onAddThem }) {
  const [team,    setTeam]    = useState("us");
  const [nombre,  setNombre]  = useState("");
  const [num,     setNum]     = useState("");
  const [err,     setErr]     = useState("");

  function confirmar() {
    const n = nombre.trim();
    const nm = parseInt(num)||0;
    if (!n) { setErr("Ingresa el nombre"); return; }
    if (team === "us") {
      onAddUs(n, nm);
    } else {
      if (rivals.find(r => r.num === nm)) { setErr("Ya existe ese número en el rival"); return; }
      onAddThem(n, nm);
    }
  }

  return (
    <>
      <div className="mt2">
        👤 Agregar Jugador · {curMin}'
        <span className="mx" onClick={onClose}>✕</span>
      </div>

      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        {[["us","🔵 " + (match.home||"RFC")],["them","🔴 " + (match.away||"Rival")]].map(([k,l])=>(
          <button key={k} className="btn-sm"
            style={{ flex:1, fontSize:9,
              background: team===k ? (k==="us"?"rgba(21,101,192,.25)":"rgba(229,57,53,.25)") : "rgba(255,255,255,.03)",
              color: team===k ? (k==="us"?"#7ab3e0":"#e8a0a0") : "#4e6a88",
              borderColor: team===k ? (k==="us"?"rgba(33,150,243,.4)":"rgba(229,57,53,.4)") : "rgba(255,255,255,.05)" }}
            onClick={()=>{ setTeam(k); setErr(""); }}>
            {l}
          </button>
        ))}
      </div>

      <div className="inp-2" style={{ marginBottom:8 }}>
        <div className="inp-wrap">
          <div className="inp-lbl">Nombre *</div>
          <input className="inp" placeholder="Nombre del jugador" value={nombre}
            onChange={e=>{ setNombre(e.target.value); setErr(""); }}/>
        </div>
        <div className="inp-wrap">
          <div className="inp-lbl">N° Camiseta</div>
          <input className="inp" type="number" min="1" max="99" placeholder="10"
            value={num} onChange={e=>{ setNum(e.target.value); setErr(""); }}/>
        </div>
      </div>

      {err && <div className="err" style={{ marginBottom:8 }}>⚠️ {err}</div>}

      <button className="btn" style={{
        background:   team==="us" ? "rgba(21,101,192,.2)"  : "rgba(229,57,53,.2)",
        borderColor:  team==="us" ? "rgba(33,150,243,.4)"  : "rgba(229,57,53,.4)",
        color:        team==="us" ? "#7ab3e0"               : "#e8a0a0"
      }} onClick={confirmar}>
        ✅ AGREGAR {team==="us" ? "A RFC" : "AL RIVAL"}
      </button>
    </>
  );
}

// ── Componente tarjeta de partido del torneo rápido (necesita sus propios hooks) ──
function TrPartidoCard({ p, canEdit, onSave }) {
  const [editando,   setEditando]   = useState(false);
  const [sH,         setSH]         = useState(p.scoreH!==null?String(p.scoreH):"");
  const [sA,         setSA]         = useState(p.scoreA!==null?String(p.scoreA):"");
  const [goles,      setGoles]      = useState(p.goleadores||[]);
  const [golesInput, setGolesInput] = useState("");

  // Sync cuando cambia el partido externo
  React.useEffect(() => {
    setSH(p.scoreH!==null?String(p.scoreH):"");
    setSA(p.scoreA!==null?String(p.scoreA):"");
    setGoles(p.goleadores||[]);
  }, [p.scoreH, p.scoreA]);

  return (
    <div className="card" style={{ marginBottom:8,
      borderLeft: p.jugado?"3px solid rgba(33,150,243,.4)":"3px solid rgba(255,255,255,.06)" }}>
      {!editando ? (
        <>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: p.jugado?5:0 }}>
            <div style={{ flex:1, fontSize:9.5, fontWeight:600 }}>{p.home}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#7ab3e0", minWidth:40, textAlign:"center" }}>
              {p.jugado ? `${p.scoreH}–${p.scoreA}` : "vs"}
            </div>
            <div style={{ flex:1, fontSize:9.5, fontWeight:600, textAlign:"right" }}>{p.away}</div>
          </div>
          {p.jugado && p.goleadores?.length>0 && (
            <div style={{ fontSize:7.5, color:"#4e6a88", marginBottom:5 }}>⚽ {p.goleadores.join(", ")}</div>
          )}
          {canEdit && (
            <button className="btn-sm" style={{ width:"100%", textAlign:"center", fontSize:9 }}
              onClick={()=>{ setEditando(true); setSH(p.scoreH!==null?String(p.scoreH):""); setSA(p.scoreA!==null?String(p.scoreA):""); setGoles(p.goleadores||[]); }}>
              {p.jugado?"✏️ Editar resultado":"▸ Registrar resultado"}
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize:8.5, color:"#7ab3e0", fontWeight:600, marginBottom:7 }}>{p.home} vs {p.away}</div>
          <div className="inp-2" style={{ marginBottom:8 }}>
            <div className="inp-wrap">
              <div className="inp-lbl">{p.home}</div>
              <input className="inp" type="number" min="0" value={sH} onChange={e=>setSH(e.target.value)}
                style={{ textAlign:"center", fontSize:20, fontFamily:"'Bebas Neue',sans-serif" }}/>
            </div>
            <div className="inp-wrap">
              <div className="inp-lbl">{p.away}</div>
              <input className="inp" type="number" min="0" value={sA} onChange={e=>setSA(e.target.value)}
                style={{ textAlign:"center", fontSize:20, fontFamily:"'Bebas Neue',sans-serif" }}/>
            </div>
          </div>
          <div className="inp-wrap" style={{ marginBottom:8 }}>
            <div className="inp-lbl">Goleadores (opcional)</div>
            <div style={{ display:"flex", gap:5, marginBottom:5 }}>
              <input className="inp" style={{ flex:1 }} placeholder="Nombre del goleador"
                value={golesInput} onChange={e=>setGolesInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&golesInput.trim()){ setGoles(g=>[...g,golesInput.trim()]); setGolesInput(""); }}}/>
              <button className="btn-sm" onClick={()=>{ if(golesInput.trim()){ setGoles(g=>[...g,golesInput.trim()]); setGolesInput(""); }}}>+</button>
            </div>
            {goles.length>0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {goles.map((g,gi)=>(
                  <span key={gi} style={{ background:"rgba(33,150,243,.1)", border:"1px solid rgba(33,150,243,.2)",
                    borderRadius:12, padding:"2px 8px", fontSize:8, color:"#7ab3e0",
                    display:"flex", alignItems:"center", gap:4 }}>
                    ⚽ {g}
                    <span style={{ cursor:"pointer", color:"#e8a0a0", fontSize:10 }}
                      onClick={()=>setGoles(prev=>prev.filter((_,i)=>i!==gi))}>✕</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <button className="btn-sm" onClick={()=>setEditando(false)}>Cancelar</button>
            <button className="btn" style={{ flex:1 }} onClick={()=>{
              if(sH===""||sA==="") return;
              onSave(p.id, parseInt(sH)||0, parseInt(sA)||0, goles);
              setEditando(false);
            }}>💾 Guardar</button>
          </div>
        </>
      )}
    </div>
  );
}

function MatchCard({ m, champs }) {
  const champ = champs && m.champId ? champs.find(c => c.id === m.champId) : null;
  return (
    <div className="mc">
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span className="bg bg-b">{m.cat}</span>
        <span className={"bg " + (m.status === "finalizado" ? "bg-g" : "bg-y")}>{m.status}</span>
        {m.historico && <span className="bg" style={{ fontSize:7, background:"rgba(183,28,28,.12)", color:"#e8a0a0", borderColor:"rgba(229,57,53,.2)" }}>📋 Hist.</span>}
      </div>
      <div className="mt">
        <span className="tn tn-h">{m.home}</span>
        <div className="sc">
          {m.scoreH !== null ? m.scoreH + "–" + m.scoreA : "VS"}
        </div>
        <span className="tn tn-a">{m.away}</span>
      </div>
      <div className="mm">
        <span className="mi">📅 {m.date}</span>
        <span className="mi">⏰ {m.time}</span>
        <span className="mi">📍 {m.field}</span>
        {champ && <span className="mi" style={{ color:"#d4b84a", borderColor:"rgba(255,214,0,.15)" }}>🏆 {champ.nombre}</span>}
      </div>
      {m.status === "finalizado" && m.mvp && (
        <div style={{ marginTop:6, paddingTop:6, borderTop:"1px solid rgba(255,255,255,.04)",
          display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ fontSize:12 }}>🏅</span>
          <span style={{ fontSize:8, color:"#8a7040" }}>MVP:</span>
          <span style={{ fontSize:9, color:"#d4b84a", fontWeight:600 }}>{m.mvp.nombre} {m.mvp.apellido}</span>
        </div>
      )}
    </div>
  );
}

// ─── LIVE MATCH COMPONENT ─────────────────────────────────────

function LiveMatch({ match, myPlayers, sanctions, setSanctions, onClose, onSave, onMinimize, onStateChange, minET = 5 }) {

  const [phase,      setPhase]     = useState("rivals");
  const [rivals,     setRivals]    = useState([]);
  const [rNum,       setRNum]      = useState("");
  const [rName,      setRName]     = useState("");
  const [convocados, setConvocados]= useState([]);
  const [convSearch,  setConvSearch]  = useState("");
  const [convCatF,    setConvCatF]    = useState("Todas");
  const [convAnoF,    setConvAnoF]    = useState("");
  // Jugadores del equipo rival en live match
  const [rivalPlayers, setRivalPlayers] = useState([]); // [{id, nombre, num}]
  const [showRivalForm, setShowRivalForm] = useState(false);
  const [rivalInput, setRivalInput] = useState({ nombre:"", num:"" });
  const [titulares,  setTitulares] = useState([]);
  const [onField,    setOnField]   = useState([]);
  const [period,     setPeriod]    = useState(1);
  const [running,    setRunning]   = useState(false);
  const [secs,       setSecs]      = useState(0);
  const [scoreUs,    setUs]        = useState(0);
  const [scoreThem,  setThem]      = useState(0);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null); // timestamp real cuando arrancó el cronómetro
  const secsAtPause  = useRef(0);    // segundos acumulados al pausar
  const timerCdStartRef = useRef(null); // timestamp countdown
  const timerCdSecsRef  = useRef(0);    // secs countdown al pausar

  // Collective direct fouls per period
  const [cfUs,   setCfUs]   = useState({ 1:0, 2:0 });
  const [cfThem, setCfThem] = useState({ 1:0, 2:0 });

  // Individual fouls per player id
  const [myFouls, setMyFouls] = useState(() => {
    const s = {};
    myPlayers.forEach(p => { s[p.id] = { direct:0, indirect:0 }; });
    return s;
  });
  const [rivFouls, setRivFouls] = useState({});

  // Timeouts: 1 per side per period
  const [tm, setTm] = useState({ 1:{ us:false, them:false }, 2:{ us:false, them:false } });

  const [events, setEvents] = useState([]);
  const [modal,  setModal]  = useState(null);
  // Estadísticas individuales del partido
  const [pStats, setPStats] = useState(() => {
    const s = {};
    myPlayers.forEach(p => { s[p.id] = { goles:0, asistencias:0 }; });
    return s;
  });
  const [showAssist, setShowAssist] = useState(false);
  const [selP,   setSelP]   = useState(null);
  const [selOut, setSelOut] = useState(null);
  const [selR,   setSelR]   = useState(null);
  const [ftype,  setFtype]  = useState(null);
  const [arbPaid,   setArbPaid]   = useState({});  // { [playerId]: bool }
  const [arbAmount, setArbAmount] = useState("");

  // Temporizador countdown
  const [timerInput, setTimerInput] = useState("15");
  const [timerSecs,  setTimerSecs]  = useState(null);
  const timerCdRef = useRef(null);

  // Tiempo extra y penales
  const FASES_KO = ["Octavos","Cuartos","Semifinal","Final"];
  const esKO = FASES_KO.includes(match?.fase);
  const [extraTime,    setExtraTime]    = useState(false);  // estamos en tiempo extra
  const [extraPeriod,  setExtraperíodo] = useState(0);      // 0=no iniciado, 1=ET1, 2=ET2
  const [showExtraQ,   setShowExtraQ]   = useState(false);  // modal ¿tiempo extra?
  const [showPenalQ,   setShowPenalQ]   = useState(false);  // modal ¿penales?
  const [showPenales,  setShowPenales]  = useState(false);  // pantalla penales
  const [penUs,        setPenUs]        = useState([]);     // true/false por tiro
  const [penThem,      setPenThem]      = useState([]);

  const curMin = Math.floor(secs / 60);
  const curSec = secs % 60;
  const cfU    = cfUs[period]   || 0;
  const cfT    = cfThem[period] || 0;
  const tmUav  = !tm[period].us;
  const tmTav  = !tm[period].them;

  // ── CRONÓMETRO RESILIENTE basado en timestamps reales ──────────────────────
  useEffect(() => {
    if (running) {
      // Guardar el momento en que arrancó
      startedAtRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSecs(secsAtPause.current + elapsed);
      }, 500); // tick cada 500ms para más precisión
    } else {
      clearInterval(timerRef.current);
      // Guardar los segundos al pausar
      secsAtPause.current = secs;
      startedAtRef.current = null;
    }
    return () => clearInterval(timerRef.current);
  }, [running]);

  // ── Countdown resiliente ─────────────────────────────────────────────────
  useEffect(() => {
    if (running && timerSecs !== null && timerSecs > 0) {
      timerCdStartRef.current = Date.now();
      timerCdSecsRef.current  = timerSecs;
      timerCdRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerCdStartRef.current) / 1000);
        const remaining = timerCdSecsRef.current - elapsed;
        setTimerSecs(remaining > 0 ? remaining : 0);
      }, 500);
    } else {
      clearInterval(timerCdRef.current);
    }
    return () => clearInterval(timerCdRef.current);
  }, [running, timerSecs !== null]);

  // ── Recuperación al volver de otra app (visibilitychange) ───────────────
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible" && running && startedAtRef.current) {
        // Recalcular tiempo transcurrido desde que arrancó
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSecs(secsAtPause.current + elapsed);
        // Recalcular countdown si está activo
        if (timerSecs !== null && timerCdStartRef.current) {
          const cdElapsed = Math.floor((Date.now() - timerCdStartRef.current) / 1000);
          const remaining = timerCdSecsRef.current - cdElapsed;
          setTimerSecs(remaining > 0 ? remaining : 0);
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [running, timerSecs]);

  // Silbato cuando el cronómetro llega a 0
  useEffect(() => {
    if (timerSecs === 0) playWhistle();
  }, [timerSecs]);

  // Reportar estado al componente padre (para el banner minimizado)
  useEffect(() => {
    if (onStateChange) {
      onStateChange({ secs, scoreUs, scoreThem, running });
    }
  }, [secs, scoreUs, scoreThem, running]);

  // Silbato: tres pitidos usando Web Audio API
  function playWhistle() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const pitidos = [0, 0.35, 0.70]; // tiempos de inicio de cada pitido
      pitidos.forEach(t => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.setValueAtTime(880, ctx.currentTime + t);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + t + 0.05);
        gain.gain.setValueAtTime(0.5, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.28);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.3);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch(e) {
      console.warn("Audio no disponible:", e);
    }
  }

  function addLog(type, txt, ico) {
    setEvents(e => [{ id: Date.now(), min: curMin, sec: curSec, period, type, txt, ico }, ...e]);
    const LIVE_TYPES = ["goal_us","goal_them","fd_us","fi_us","fd_them","fi_them","y_us","r_us","y_them","r_them","tm","half","end"];
    if (LIVE_TYPES.includes(type)) {
      const id = "live_" + String(Date.now());
      const matchLabel = match?.home + " vs " + match?.away;
      const fullTxt = ico + " " + pad2(curMin) + "' — " + txt + " · " + matchLabel;
      if (!isDemoSession()) setDoc(doc(db, "notifs", id), {
        id, txt: fullTxt, ts: new Date().toISOString(),
        link: "calendario", live: true,
        matchId: match?.id || "",
        para: match?.cat ? "cat:" + match.cat : "all",
        tipo: (type==="goal_us"||type==="goal_them") ? "gol" : "live",
        readBy: {}
      });
    }
  }

  function closeModal() {
    setModal(null); setSelP(null); setSelOut(null); setSelR(null); setFtype(null); setShowAssist(false);
  }

  function addRival() {
    const n = parseInt(rNum);
    if (!rNum || isNaN(n)) return;
    if (rivals.find(r => r.num === n)) { setRNum(""); return; }
    setRivals(prev => [...prev, { num: n, name: rName.trim() }].sort((a,b) => a.num - b.num));
    setRivFouls(prev => ({ ...prev, [n]: { direct:0, indirect:0, yellows:0, reds:0 } }));
    setRNum(""); setRName("");
  }

  function doGoalUs(pid) {
    const p = myPlayers.find(x => x.id === pid);
    setUs(s => s + 1);
    setPStats(s => ({ ...s, [pid]: { ...s[pid], goles: (s[pid]?.goles||0)+1 } }));
    addLog("goal_us", "Gol: " + p.nombre + " " + p.apellido, "⚽");
    closeModal();
  }

  function doGoalThem(rnum) {
    const r = rnum !== null ? rivals.find(x => x.num === rnum) : null;
    setThem(s => s + 1);
    addLog("goal_them", "Gol rival" + (r ? ": #" + r.num + " " + r.name : ""), "⚽");
    closeModal();
  }

  // Autogol RFC → suma al rival
  function doOwnGoalUs(pid) {
    const p = myPlayers.find(x => x.id === pid);
    setThem(s => s + 1); // suma al rival
    addLog("goal_them", "Autogol RFC: " + (p ? p.nombre + " " + p.apellido : ""), "🙈");
    closeModal();
  }

  // Autogol rival → suma a RFC
  function doOwnGoalThem(rnum) {
    const r = rnum !== null ? rivals.find(x => x.num === rnum) : null;
    setUs(s => s + 1); // suma a RFC
    addLog("goal_us", "Autogol rival" + (r ? ": #" + r.num + " " + r.name : ""), "🙈");
    closeModal();
  }

  function doFoulUs(pid, type) {
    const p = myPlayers.find(x => x.id === pid);
    setMyFouls(f => ({ ...f, [pid]: { ...f[pid], [type]: (f[pid][type] || 0) + 1 } }));
    if (type === "direct") {
      setCfUs(f => ({ ...f, [period]: (f[period] || 0) + 1 }));
      addLog("fd_us", "Falta directa: " + p.nombre, "⚠️");
    } else {
      addLog("fi_us", "Falta indirecta: " + p.nombre, "↩️");
    }
    closeModal();
  }

  function doFoulThem(rnum, type) {
    const r = rivals.find(x => x.num === rnum) || {};
    setRivFouls(f => ({
      ...f,
      [rnum]: { ...(f[rnum] || {}), [type]: ((f[rnum] || {})[type] || 0) + 1 }
    }));
    if (type === "direct") {
      setCfThem(f => ({ ...f, [period]: (f[period] || 0) + 1 }));
      addLog("fd_them", "Falta directa rival: #" + rnum + " " + (r.name || ""), "⚠️");
    } else {
      addLog("fi_them", "Falta indirecta rival: #" + rnum + " " + (r.name || ""), "↩️");
    }
    closeModal();
  }

  function doCardUs(pid, color) {
    const p   = myPlayers.find(x => x.id === pid);
    const now = new Date().toLocaleDateString("es");
    if (color === "yellow") {
      setSanctions(s => ({
        ...s,
        [pid]: { ...s[pid], yellows: (s[pid].yellows || 0) + 1,
          history: [...(s[pid].history || []), { type:"yellow", date:now }] }
      }));
      addLog("y_us", "Amarilla: " + p.nombre + " " + p.apellido, "🟨");
    } else {
      setSanctions(s => ({
        ...s,
        [pid]: { ...s[pid], reds: (s[pid].reds || 0) + 1, suspended: true,
          history: [...(s[pid].history || []), { type:"red", date:now }] }
      }));
      setOnField(f => f.filter(x => x !== pid));
      addLog("r_us", "Roja: " + p.nombre + " " + p.apellido, "🟥");
    }
    closeModal();
  }

  function doCardThem(rnum, color) {
    const r   = rivals.find(x => x.num === rnum) || {};
    const key = color === "yellow" ? "yellows" : "reds";
    setRivFouls(f => ({
      ...f,
      [rnum]: { ...(f[rnum] || {}), [key]: ((f[rnum] || {})[key] || 0) + 1 }
    }));
    addLog(
      color === "yellow" ? "y_them" : "r_them",
      (color === "yellow" ? "Amarilla" : "Roja") + " rival: #" + rnum + " " + (r.name || ""),
      color === "yellow" ? "🟨" : "🟥"
    );
    closeModal();
  }

  function doTimeout(side) {
    setTm(t => ({ ...t, [period]: { ...t[period], [side]: true } }));
    setRunning(false);
    addLog("tm", "Tiempo muerto " + (side === "us" ? "RFC" : "Rival") + " (" + period + "T)", "⏸️");
    closeModal();
  }

  function doSub() {
    const pIn  = myPlayers.find(x => x.id === selP);
    const pOut = myPlayers.find(x => x.id === selOut);
    setOnField(f => f.map(x => x === selOut ? selP : x));
    addLog("sub", "Cambio ↑" + pIn.nombre + " ↓" + pOut.nombre, "🔄");
    closeModal();
  }

  function resetClock() {
    setRunning(false);
    setSecs(0);
    secsAtPause.current      = 0;
    startedAtRef.current     = null;
    timerCdStartRef.current  = null;
    timerCdSecsRef.current   = 0;
    setTimerSecs(null);
    setTimerInput("15");
    clearInterval(timerCdRef.current);
  }

  function resetFouls() {
    setCfUs(f => ({ ...f, [period]: 0 }));
    setCfThem(f => ({ ...f, [period]: 0 }));
  }

  function endPeriod() {
    resetClock();
    const empate = scoreUs === scoreThem;

    if (!extraTime) {
      // Tiempos reglamentarios
      if (period === 1) {
        setPeriod(2);
        addLog("half", "Fin del Primer Tiempo", "🔔");
      } else {
        // Fin del 2do tiempo
        if (esKO && empate) {
          addLog("half", "Fin del Segundo Tiempo — Empate, definiendo...", "🔔");
          setShowExtraQ(true); // preguntar tiempo extra
        } else {
          addLog("end", "Fin del Partido", "🏁");
          setPhase("summary");
        }
      }
    } else {
      // Estamos en tiempo extra
      if (extraPeriod === 1) {
        setExtraperíodo(2);
        setPeriod(4); // ET2
        addLog("half", "Fin del Tiempo Extra 1", "🔔");
        setTimerInput(String(minET));
      } else {
        // Fin del ET2
        if (empate) {
          addLog("half", "Fin del Tiempo Extra — Empate, definiendo penales...", "🔔");
          setShowPenalQ(true);
        } else {
          addLog("end", "Fin del Tiempo Extra", "🏁");
          setPhase("summary");
        }
      }
    }
  }

  function startExtraTime() {
    setShowExtraQ(false);
    setExtraTime(true);
    setExtraperíodo(1);
    setPeriod(3);
    setCfUs(f => ({ ...f, 3:0, 4:0 }));
    setCfThem(f => ({ ...f, 3:0, 4:0 }));
    setTm(t => ({ ...t, 3:{ us:false, them:false }, 4:{ us:false, them:false } }));
    addLog("half", "Inicio del Tiempo Extra (" + minET + " min c/tiempo)", "⚡");
    setTimerInput(String(minET));
  }

  function startPenales() {
    setShowPenalQ(false);
    setShowPenales(true);
    addLog("half", "Tanda de Penales", "🥅");
  }

  // ── RIVALS PHASE ──────────────────────────
  if (phase === "rivals") {
    return (
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <div style={{ fontSize:9, color:"#4e6a88", cursor:"pointer", marginBottom:2 }} onClick={onClose}>← Volver</div>
              <div className="logo"><span className="lb">REGISTRO</span> <span className="lr">RIVAL</span></div>
            </div>
            <span className="bg bg-r">{match.cat}</span>
          </div>
        </div>
        <div className="cnt">
          <MatchCard m={match} champs={[]} />
          <div className="card">
            <div className="ch">
              <span className="ct">Jugadores de {match.away}</span>
              <span className="bg bg-r">{rivals.length}</span>
            </div>
            <p style={{ fontSize:9, color:"#4e6a88", marginBottom:9, lineHeight:1.5 }}>
              Registra número y nombre para asignar faltas y tarjetas.
              Puedes continuar sin registrarlos.
            </p>
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              <input
                className="inp" style={{ width:58 }} placeholder="#" type="number"
                value={rNum} onChange={e => setRNum(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addRival()}
              />
              <input
                className="inp" style={{ flex:1 }} placeholder="Nombre (opcional)"
                value={rName} onChange={e => setRName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addRival()}
              />
              <button className="btn" style={{ width:40, padding:"7px 4px", fontSize:19 }} onClick={addRival}>+</button>
            </div>
            {rivals.length === 0 && (
              <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"6px 0" }}>Sin jugadores aún</p>
            )}
            {rivals.map(r => (
              <div key={r.num} className="riv-row">
                <span className="riv-num">#{r.num}</span>
                <span className="riv-name">{r.name || <em style={{ color:"#4e6a88" }}>Sin nombre</em>}</span>
                <button className="btn-sm" onClick={() => {
                  setRivals(rv => rv.filter(x => x.num !== r.num));
                  setRivFouls(f => { const c = { ...f }; delete c[r.num]; return c; });
                }}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn" onClick={() => setPhase("convocados")}>
            CONTINUAR → CONVOCATORIA
          </button>
        </div>
      </div>
    );
  }

  // ── CONVOCADOS PHASE ──────────────────────
  if (phase === "convocados") {
    return (
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <div style={{ fontSize:9, color:"#4e6a88", cursor:"pointer", marginBottom:2 }} onClick={() => setPhase("rivals")}>← Rivales</div>
              <div className="logo"><span className="lb">CONVOCATORIA</span></div>
            </div>
            <span className="bg bg-b">{convocados.length} sel.</span>
          </div>
        </div>
        <div className="cnt">
          <div className="card">
            <div className="ch">
              <span className="ct">Seleccionar Convocados</span>
              <span className="bg bg-b">{convocados.length} sel.</span>
            </div>

            {/* ── Buscador ── */}
            <input className="inp" style={{ marginBottom:6 }}
              placeholder="🔍 Buscar por nombre..."
              value={convSearch} onChange={e => setConvSearch(e.target.value)} />

            {/* ── Filtro por categoría ── */}
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
              {["Todas","Sub-11","Sub-13","Sub-15","Sub-17","Sub-19"].map(cat => (
                <button key={cat}
                  onClick={() => setConvCatF(cat)}
                  className={"btn-sm"}
                  style={{ fontSize:7.5, padding:"3px 7px",
                    background: convCatF===cat ? "rgba(33,150,243,.25)" : "rgba(255,255,255,.03)",
                    color:      convCatF===cat ? "#7ab3e0" : "#4e6a88",
                    borderColor:convCatF===cat ? "rgba(33,150,243,.4)" : "rgba(255,255,255,.05)" }}>
                  {cat}
                </button>
              ))}
            </div>

            {/* ── Filtro por año de nacimiento ── */}
            {(() => {
              const anos = [...new Set(myPlayers.map(p => p.dob ? new Date(p.dob).getFullYear() : null).filter(Boolean))].sort((a,b)=>b-a);
              return anos.length > 0 ? (
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
                  <button onClick={() => setConvAnoF("")}
                    className="btn-sm"
                    style={{ fontSize:7.5, padding:"3px 7px",
                      background: !convAnoF ? "rgba(212,184,74,.2)" : "rgba(255,255,255,.03)",
                      color:      !convAnoF ? "#d4b84a" : "#4e6a88",
                      borderColor:!convAnoF ? "rgba(212,184,74,.4)" : "rgba(255,255,255,.05)" }}>
                    Todos los años
                  </button>
                  {anos.map(ano => (
                    <button key={ano}
                      onClick={() => setConvAnoF(convAnoF===String(ano) ? "" : String(ano))}
                      className="btn-sm"
                      style={{ fontSize:7.5, padding:"3px 7px",
                        background: convAnoF===String(ano) ? "rgba(212,184,74,.2)" : "rgba(255,255,255,.03)",
                        color:      convAnoF===String(ano) ? "#d4b84a" : "#4e6a88",
                        borderColor:convAnoF===String(ano) ? "rgba(212,184,74,.4)" : "rgba(255,255,255,.05)" }}>
                      {ano}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}

            {(() => {
              // Aplicar filtros
              const filtrados = myPlayers.filter(p => {
                const nombre = (p.nombre+" "+p.apellido).toLowerCase();
                const busq   = convSearch.toLowerCase().trim();
                if (busq && !nombre.includes(busq)) return false;
                if (convCatF !== "Todas" && p.cat !== convCatF) return false;
                if (convAnoF && p.dob && String(new Date(p.dob).getFullYear()) !== convAnoF) return false;
                return true;
              });

              // Separar: propios de la categoría del partido vs otras categorías
              const propios = filtrados.filter(p => p.cat === match.cat);
              const otros   = filtrados.filter(p => p.cat !== match.cat);

              function PlayerRow({ p }) {
                const sel  = convocados.includes(p.id);
                const susp = sanctions[p.id] && sanctions[p.id].suspended;
                const esFueraCat = p.cat !== match.cat;
                return (
                  <div className="pr" style={{ opacity: susp ? 0.35 : 1 }}>
                    <Avatar p={p} />
                    <div className="pi">
                      <div className="pn">
                        {p.nombre} {p.apellido}
                        {susp && <span style={{ fontSize:8, color:"#EF9A9A", marginLeft:5 }}>SUSP</span>}
                        {esFueraCat && (
                          <span style={{ fontSize:7, color:"#d4b84a", marginLeft:5,
                            background:"rgba(212,184,74,.12)", padding:"1px 5px", borderRadius:3 }}>
                            {p.cat}
                          </span>
                        )}
                      </div>
                      <div className="ps">#{p.num}{p.subequipo ? " · "+p.subequipo : ""}</div>
                    </div>
                    <button className={"ck" + (sel ? " on" : "")} disabled={!!susp}
                      onClick={() => !susp && setConvocados(c => sel ? c.filter(x => x !== p.id) : [...c, p.id])}>
                      {sel ? "✓" : ""}
                    </button>
                  </div>
                );
              }

              return (
                <>
                  {filtrados.length === 0 && (
                    <div style={{ textAlign:"center", padding:"16px 0", fontSize:9, color:"#3a5068" }}>
                      Sin jugadores con ese filtro
                    </div>
                  )}
                  {/* Jugadores de la categoría del partido */}
                  {propios.map(p => <PlayerRow key={p.id} p={p} />)}

                  {/* Separador y jugadores de otras categorías */}
                  {otros.length > 0 && (
                    <>
                      <div style={{ fontSize:7.5, color:"#3a5068", textTransform:"uppercase",
                        letterSpacing:.5, padding:"8px 0 5px", borderTop:"1px solid rgba(255,255,255,.04)",
                        marginTop:4 }}>
                        Otras categorías — disponibles para convocar
                      </div>
                      {otros.map(p => <PlayerRow key={p.id} p={p} />)}
                    </>
                  )}
                </>
              );
            })()}
          </div>
          {convocados.length > 0 && (
            <div className="card">
              <div className="ch"><span className="ct">📲 Enviar Convocatoria</span></div>
              {convocados.map(cid => {
                const p = myPlayers.find(x => x.id === cid);
                if (!p) return null;
                const msgJ = "🔵 RÓMULO F.C — Hola " + p.nombre + ", fuiste convocado para " + match.home + " vs " + match.away + " el " + match.date + " a las " + match.time + " en " + match.field + ". Preséntate 30 min antes.";
                const msgR = "🔵 RÓMULO F.C — Hola " + p.repNombre + ", " + p.nombre + " " + p.apellido + " fue convocado para " + match.home + " vs " + match.away + " el " + match.date + " a las " + match.time + " en " + match.field + ".";
                return (
                  <div key={cid} className="pr">
                    <Avatar p={p} size={25} />
                    <div className="pi"><div className="pn">{p.nombre} {p.apellido}</div></div>
                    <div style={{ display:"flex", gap:4 }}>
                      <button className="btn-wa" onClick={() => openWA(p.tel, msgJ)}>📲 Jugador</button>
                      <button className="btn-wa" onClick={() => openWA(p.repTel, msgR)}>📲 Rep.</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* ── Sección jugadores del rival ── */}
          <div className="card" style={{ marginTop:8 }}>
            <div className="ch">
              <span className="ct" style={{ color:"#e8a0a0" }}>🔴 {match.away} — Jugadores rival</span>
              <span className="bg bg-r">{rivalPlayers.length}</span>
            </div>
            <p style={{ fontSize:8.5, color:"#4e6a88", marginBottom:8 }}>
              Registra los jugadores del equipo rival para poder asignarles goles y tarjetas durante el partido.
            </p>

            {/* Lista de jugadores rival ya agregados — usa el mismo estado rivals del live match */}
            {rivals.map(r => (
              <div key={r.num} style={{ display:"flex", alignItems:"center", gap:8,
                padding:"7px 8px", marginBottom:5, borderRadius:8,
                background:"rgba(229,57,53,.06)", border:"1px solid rgba(229,57,53,.15)" }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(229,57,53,.2)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:11, fontWeight:700, color:"#e8a0a0", flexShrink:0 }}>
                  {r.num}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, fontWeight:600, color:"#e8a0a0" }}>{r.name || "Sin nombre"}</div>
                  <div style={{ fontSize:7.5, color:"#4e6a88" }}>#{r.num} · {match.away}</div>
                </div>
                <button className="btn-sm" style={{ color:"#e8a0a0", padding:"2px 8px", fontSize:8 }}
                  onClick={() => { setRivals(rv => rv.filter(x => x.num !== r.num)); setRivFouls(f => { const cf={...f}; delete cf[r.num]; return cf; }); }}>
                  ✕
                </button>
              </div>
            ))}

            {/* Formulario inline para agregar jugador rival */}
            {showRivalForm ? (
              <div style={{ background:"rgba(229,57,53,.05)", borderRadius:8,
                padding:"10px", border:"1px solid rgba(229,57,53,.12)" }}>
                <div className="inp-2" style={{ marginBottom:8 }}>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Nombre *</div>
                    <input className="inp" placeholder="Nombre del jugador"
                      value={rivalInput.nombre}
                      onChange={e => setRivalInput(v => ({ ...v, nombre:e.target.value }))}/>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">N° Camiseta *</div>
                    <input className="inp" type="number" min="1" max="99" placeholder="10"
                      value={rivalInput.num}
                      onChange={e => setRivalInput(v => ({ ...v, num:e.target.value }))}/>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button className="btn-sm" onClick={() => { setShowRivalForm(false); setRivalInput({ nombre:"", num:"" }); }}>
                    Cancelar
                  </button>
                  <button className="btn" style={{ flex:1, background:"rgba(229,57,53,.15)",
                    border:"1px solid rgba(229,57,53,.3)", color:"#e8a0a0" }}
                    onClick={() => {
                      if (!rivalInput.nombre.trim()) return;
                      const nNum = parseInt(rivalInput.num)||0;
                      if (rivals.find(r => r.num === nNum)) { setRivalInput(v=>({...v,num:""})); return; }
                      setRivals(rv => [...rv, { num:nNum, name:rivalInput.nombre.trim() }]);
                      setRivalInput({ nombre:"", num:"" });
                      setShowRivalForm(false);
                    }}>
                    ✅ Agregar
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-sm" style={{ width:"100%", textAlign:"center",
                background:"rgba(229,57,53,.08)", color:"#e8a0a0",
                borderColor:"rgba(229,57,53,.2)", fontSize:9 }}
                onClick={() => setShowRivalForm(true)}>
                + Agregar jugador rival
              </button>
            )}
          </div>

          <button className="btn" disabled={convocados.length < 5} onClick={() => setPhase("lineup")}>
            CONTINUAR → FORMACIÓN
          </button>
          {convocados.length < 5 && (
            <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", marginTop:5 }}>Mínimo 5 jugadores</p>
          )}
        </div>
      </div>
    );
  }

  // ── LINEUP PHASE ──────────────────────────
  if (phase === "lineup") {
    return (
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <div style={{ fontSize:9, color:"#4e6a88", cursor:"pointer", marginBottom:2 }} onClick={() => setPhase("convocados")}>← Convocatoria</div>
              <div className="logo"><span className="lb">FORMACIÓN</span> <span className="lr">INICIAL</span></div>
            </div>
            <span className="bg bg-b">{titulares.length}/5</span>
          </div>
        </div>
        <div className="cnt">
          <div className="card">
            <div className="ch"><span className="ct">Seleccionar 5 Titulares</span></div>
            <div className="psgrid">
              {convocados.map(cid => {
                const p   = myPlayers.find(x => x.id === cid);
                if (!p) return null;
                const sel = titulares.includes(cid);
                return (
                  <div
                    key={cid}
                    className={"psbtn" + (sel ? " pssel" : "")}
                    onClick={() => sel
                      ? setTitulares(t => t.filter(x => x !== cid))
                      : titulares.length < 5 && setTitulares(t => [...t, cid])
                    }
                  >
                    <Avatar p={p} size={25} />
                    <div>
                      <div className="psbtn-n">#{p.num} {p.nombre}</div>
                      <div className="psbtn-s">{p.apellido}{p.subequipo ? <span style={{ color:"#d4b84a", marginLeft:4 }}>{p.subequipo}</span> : null}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {titulares.length === 5 && (
            <div className="card">
              <div className="ch"><span className="ct">Formación Confirmada</span></div>
              {titulares.map((tid, i) => {
                const p = myPlayers.find(x => x.id === tid);
                if (!p) return null;
                return (
                  <div key={tid} className="lu-slot">
                    <span className="lu-idx">{i + 1}</span>
                    <Avatar p={p} size={25} />
                    <div>
                      <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                      <div style={{ fontSize:8, color:"#4e6a88" }}>#{p.num}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button
            className="btn"
            disabled={titulares.length !== 5}
            onClick={() => { setOnField([...titulares]); setPhase("live"); }}
          >
            ▶ INICIAR PARTIDO
          </button>
        </div>
      </div>
    );
  }

  // ── SUMMARY PHASE ─────────────────────────
  if (phase === "summary") {
    const result = scoreUs > scoreThem ? "VICTORIA" : scoreUs < scoreThem ? "DERROTA" : "EMPATE";
    const rCol   = scoreUs > scoreThem ? "#2196F3" : scoreUs < scoreThem ? "#E53935" : "#FFD600";
    return (
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div className="logo"><span className="lb">RESUMEN</span> <span className="lr">FINAL</span></div>
            <span className="bg bg-g">Finalizado</span>
          </div>
        </div>
        <div className="cnt">
          <div className="card" style={{ textAlign:"center", padding:18 }}>
            <div style={{ fontSize:9, color:"#4e6a88", marginBottom:5 }}>{match.cat} · {match.date}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:11, fontWeight:400, color:"#4e6a88", letterSpacing:1, marginBottom:2, }}>
              {result}
            </div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, fontWeight:400, color:"#8fa8c8", }}>{match.home}</div>
            <div className="sum-score">
              <span className="sum-n" style={{ color: rCol }}>{scoreUs}</span>
              <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#4e6a88" }}>–</span>
              <span className="sum-n" style={{ color: scoreThem > scoreUs ? "#E53935" : "#4e6a88" }}>{scoreThem}</span>
            </div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, fontWeight:400, color:"#8fa8c8", }}>{match.away}</div>
          </div>
          <div className="sr4">
            <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{cfUs[1]||0}</div><div className="sl">FD 1T RFC</div></div>
            <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{cfUs[2]||0}</div><div className="sl">FD 2T RFC</div></div>
            <div className="sb"><div className="sn" style={{ color:"#FFD600" }}>{events.filter(e => e.type==="y_us").length}</div><div className="sl">🟨 RFC</div></div>
            <div className="sb"><div className="sn" style={{ color:"#EF9A9A" }}>{events.filter(e => e.type==="r_us").length}</div><div className="sl">🟥 RFC</div></div>
          </div>
          {rivals.length > 0 && (
            <div className="card">
              <div className="ch"><span className="ct">Faltas Rival</span></div>
              {rivals.map(r => {
                const f = rivFouls[r.num] || {};
                return (
                  <div key={r.num} className="riv-row">
                    <span className="riv-num">#{r.num}</span>
                    <div style={{ flex:1 }}>
                      <div className="riv-name">{r.name || "–"}</div>
                      <div className="riv-stats">
                        ⚠️{f.direct||0} ↩️{f.indirect||0}
                        {f.yellows ? " 🟨×" + f.yellows : ""}
                        {f.reds    ? " 🟥×" + f.reds    : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            <div className="ch">
              <span className="ct">Bitácora</span>
              <span className="bg bg-b">{events.length}</span>
            </div>
            <div className="evlog">
              {events.map(e => (
                <div key={e.id} className="ev">
                  <span className="ev-min">{e.min}'</span>
                  <span className="ev-ico">{e.ico}</span>
                  <span className="ev-txt">{e.txt}</span>
                  <span className="ev-p">{e.period === 1 ? "1T" : e.period === 2 ? "2T" : e.period === 3 ? "ET1" : "ET2"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="ch">
              <span className="ct">🏁 Arbitraje</span>
              <span className="bg bg-b">{convocados.length} convocados</span>
            </div>
            <p style={{ fontSize:8.5, color:"#4e6a88", lineHeight:1.6, marginBottom:8 }}>
              Ingresa el monto total y marca quién ya canceló su parte.
            </p>
            <div className="inp-wrap" style={{ marginBottom:10 }}>
              <div className="inp-lbl">Monto total del arbitraje (Bs.)</div>
              <input className="inp" type="number" placeholder="0.00" value={arbAmount}
                onChange={e => setArbAmount(e.target.value)} />
            </div>
            {arbAmount > 0 && (
              <div style={{ fontSize:8, color:"#4e6a88", marginBottom:8, textAlign:"center" }}>
                Bs. <strong style={{ color:"#7ab3e0" }}>
                  {(parseFloat(arbAmount) / convocados.length).toFixed(2)}
                </strong> por jugador ({convocados.length} convocados)
              </div>
            )}
            {convocados.map(cid => {
              const p = myPlayers.find(x => x.id === cid);
              if (!p) return null;
              const paid = arbPaid && arbPaid[cid];
              return (
                <div key={cid} className="pr" style={{ paddingBottom:5, marginBottom:5, borderBottom:"1px solid rgba(255,255,255,.03)" }}>
                  <Avatar p={p} size={26} />
                  <div className="pi">
                    <div className="pn" style={{ fontSize:10 }}>{p.nombre} {p.apellido}</div>
                    <div className="ps">#{p.num}</div>
                  </div>
                  <button
                    className={"ck" + (paid ? " on" : "")}
                    onClick={() => setArbPaid(prev => ({ ...(prev||{}), [cid]: !paid }))}
                  >{paid ? "✓" : ""}</button>
                </div>
              );
            })}
          </div>
          <button className="btn" onClick={() => {
            const amount = parseFloat(arbAmount) || 0;
            const perPlayer = convocados.length ? amount / convocados.length : 0;
            onSave({
              scoreH: scoreUs, scoreA: scoreThem,
              events,
              playerStats: pStats,
              convocados,
              titulares: onField,
              arbitraje: {
                rival: match.away, date: match.date,
                amount, perPlayer,
                jugadores: convocados.map(cid => ({
                  playerId: cid,
                  paid: !!(arbPaid && arbPaid[cid]),
                  amount: perPlayer
                }))
              }
            });
            onClose();
          }}>
            ✅ GUARDAR Y CERRAR
          </button>
        </div>
      </div>
    );
  }

    // ── LIVE PHASE ────────────────────────────
  const bench = convocados.filter(cid => !onField.includes(cid));

  return (
    <div className="app">
      <div className="scoreboard">
        {/* Botón minimizar — ir al admin sin cerrar el partido */}
        {onMinimize && (
          <div style={{ display:"flex", justifyContent:"flex-end", padding:"4px 8px 0" }}>
            <button onClick={onMinimize}
              style={{ background:"rgba(212,184,74,.15)", border:"1px solid rgba(212,184,74,.3)",
                borderRadius:6, color:"#d4b84a", fontSize:8.5, fontWeight:600,
                padding:"3px 10px", cursor:"pointer" }}>
              ⬇ Minimizar
            </button>
          </div>
        )}
        <div className="period-lbl">
          {running ? "● EN VIVO · " : "⏸ PAUSADO · "}
          {!extraTime
            ? (period === 1 ? "PRIMER TIEMPO" : "SEGUNDO TIEMPO")
            : (extraPeriod === 1 ? "⚡ TIEMPO EXTRA 1" : "⚡ TIEMPO EXTRA 2")}
        </div>
        <div className="score-row">
          <div className="score-team" style={{ textAlign:"left" }}>{match.home}</div>
          <div className="score-nums">
            <span className="score-n" style={{ color:"#2196F3" }}>{scoreUs}</span>
            <span className="score-sep">–</span>
            <span className="score-n" style={{ color:"#E53935" }}>{scoreThem}</span>
          </div>
          <div className="score-team" style={{ textAlign:"right" }}>{match.away}</div>
        </div>
        <div className={"chrono " + (running ? (extraTime ? "c-et" : period === 1 ? "c-p1" : "c-p2") : "c-off")}>
          {pad2(curMin)}:{pad2(curSec)}
        </div>

        {/* ── Temporizador countdown ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, margin:"6px 0 2px" }}>
          {timerSecs === null ? (
            <>
              <input
                type="number" min="1" max="99"
                value={timerInput}
                onChange={e => setTimerInput(e.target.value)}
                style={{ width:52, textAlign:"center", background:"rgba(33,150,243,.08)",
                  border:"1px solid rgba(33,150,243,.2)", borderRadius:6, color:"#7ab3e0",
                  fontSize:13, fontFamily:"'Bebas Neue',sans-serif", padding:"3px 6px" }}
              />
              <span style={{ fontSize:9, color:"#4e6a88" }}>min</span>
              <button onClick={() => setTimerSecs(parseInt(timerInput||"15") * 60)}
                style={{ fontSize:9, padding:"4px 10px", background:"rgba(33,150,243,.12)",
                  border:"1px solid rgba(33,150,243,.25)", borderRadius:6, color:"#7ab3e0", cursor:"pointer" }}>
                ▶ Iniciar temporizador
              </button>
            </>
          ) : (
            <>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                color: timerSecs === 0 ? "#E53935" : timerSecs <= 60 ? "#d4b84a" : "#7ab3e0",
                letterSpacing:1, minWidth:60, textAlign:"center" }}>
                {timerSecs === 0 ? "⏰ 00:00" : pad2(Math.floor(timerSecs/60)) + ":" + pad2(timerSecs%60)}
              </div>
              <button onClick={() => { setTimerSecs(null); setTimerInput("15"); clearInterval(timerCdRef.current); }}
                style={{ fontSize:9, padding:"3px 8px", background:"rgba(229,57,53,.1)",
                  border:"1px solid rgba(229,57,53,.2)", borderRadius:6, color:"#ef9a9a", cursor:"pointer" }}>
                ✕ Reset
              </button>
            </>
          )}
        </div>
        <div className="tm-row">
          <div className="tm-side">
            <span className="tm-lbl">T.Muerto RFC</span>
            <span className={"tm-pill " + (tmUav ? "tm-ok" : "tm-used")}>
              {tmUav ? "⏸ Disponible" : "✓ Usado"}
            </span>
          </div>
          <div className="tm-side">
            <span className={"tm-pill " + (tmTav ? "tm-ok" : "tm-used")}>
              {tmTav ? "⏸ Disponible" : "✓ Usado"}
            </span>
            <span className="tm-lbl">T.Muerto Rival</span>
          </div>
        </div>
      </div>

      <div className="cnt" style={{ paddingTop:10 }}>
        <div className="fgrid">
          <div className="fcard">
            <div className="ftitle">F.Directas {period}T · RFC</div>
            <div className="fcount" style={{ color: cfU >= 4 ? "#FFD600" : "#2196F3" }}>
              {cfU}<span style={{ fontSize:11, color:"#4e6a88", marginLeft:2 }}>/5</span>
            </div>
            <FoulDots count={cfU} max={5} />
            {cfU >= 5 && <div className="fnote" style={{ color:"#FFD600" }}>⚡ Siguiente = tiro 10m rival</div>}
          </div>
          <div className="fcard">
            <div className="ftitle">F.Directas {period}T · Rival</div>
            <div className="fcount" style={{ color: cfT >= 4 ? "#FFD600" : "#EF9A9A" }}>
              {cfT}<span style={{ fontSize:11, color:"#4e6a88", marginLeft:2 }}>/5</span>
            </div>
            <FoulDots count={cfT} max={5} />
            {cfT >= 5 && <div className="fnote" style={{ color:"#FFD600" }}>⚡ Siguiente = tiro 10m RFC</div>}
          </div>
        </div>

        <div className="abgrid">
          <button className="abtn abtn-b" onClick={() => setRunning(r => !r)}>
            {running ? "⏸ Pausar" : "▶ Reanudar"}
          </button>
          <button className="abtn abtn-o" onClick={endPeriod}>
            {period === 1 ? "🔔 Fin 1T" : "🏁 Fin Partido"}
          </button>
          <button className="abtn abtn-b" onClick={() => setModal("goal_us")}>⚽ Gol RFC</button>
          <button className="abtn abtn-r" onClick={() => setModal("goal_them")}>⚽ Gol Rival</button>
          <button className="abtn" style={{ background:"rgba(100,100,100,.15)", borderColor:"rgba(150,150,150,.3)", color:"#9ab8cc", fontSize:9 }} onClick={() => setModal("own_goal_us")}>🙈 Autogol RFC</button>
          <button className="abtn" style={{ background:"rgba(100,100,100,.15)", borderColor:"rgba(150,150,150,.3)", color:"#9ab8cc", fontSize:9 }} onClick={() => setModal("own_goal_them")}>🙈 Autogol Rival</button>
          <button className="abtn" onClick={() => setModal("foul_us")}>⚠️ Falta RFC</button>
          <button className="abtn abtn-r" onClick={() => setModal("foul_them")}>⚠️ Falta Rival</button>
          <button className="abtn abtn-y" onClick={() => setModal("yel_us")}>🟨 Amarilla RFC</button>
          <button className="abtn abtn-y" onClick={() => setModal("yel_them")}>🟨 Amarilla Rival</button>
          <button className="abtn abtn-r" onClick={() => setModal("red_us")}>🟥 Roja RFC</button>
          <button className="abtn abtn-r" onClick={() => setModal("red_them")}>🟥 Roja Rival</button>
          <button
            className={"abtn abtn-b" + (!tmUav ? " abtn-dim" : "")}
            onClick={() => tmUav && setModal("tm_us")}
          >⏸ T.Muerto RFC</button>
          <button
            className={"abtn abtn-r" + (!tmTav ? " abtn-dim" : "")}
            onClick={() => tmTav && setModal("tm_them")}
          >⏸ T.Muerto Rival</button>
          <button className="abtn abtn-full" onClick={() => setModal("sub")}>🔄 Cambio</button>
          <button className="abtn abtn-full" style={{ background:"rgba(212,184,74,.15)", borderColor:"rgba(212,184,74,.3)", color:"#d4b84a" }}
            onClick={() => setModal("add_player")}>👤 + Jugador</button>
        </div>

        <div className="card">
          <div className="ch">
            <span className="ct">En Cancha · RFC</span>
            <span className="bg bg-b">{onField.length}/5</span>
          </div>
          {onField.map(pid => {
            const p = myPlayers.find(x => x.id === pid);
            if (!p) return null;
            const f = myFouls[pid] || {};
            const y = (sanctions[pid] && sanctions[pid].yellows) || 0;
            return (
              <div key={pid} className="pr">
                <Avatar p={p} size={26} />
                <div className="pi">
                  <div className="pn">#{p.num} {p.nombre} {p.apellido}</div>
                  <div className="ps">
                    ⚠️{f.direct||0} · ↩️{f.indirect||0}
                    {y > 0 ? " · 🟨×" + y : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {rivals.length > 0 && (
          <div className="card">
            <div className="ch"><span className="ct">Faltas · {match.away}</span></div>
            {rivals.map(r => {
              const f = rivFouls[r.num] || {};
              return (
                <div key={r.num} className="riv-row">
                  <span className="riv-num">#{r.num}</span>
                  <div style={{ flex:1 }}>
                    <div className="riv-name">{r.name || <em style={{ color:"#4e6a88" }}>Sin nombre</em>}</div>
                    <div className="riv-stats">
                      ⚠️{f.direct||0} · ↩️{f.indirect||0}
                      {f.yellows ? " · 🟨×" + f.yellows : ""}
                      {f.reds    ? " · 🟥×" + f.reds    : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="card">
          <div className="ch">
            <span className="ct">Bitácora</span>
            <span className="bg bg-b">{events.length}</span>
          </div>
          <div className="evlog">
            {events.length === 0 && (
              <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"6px 0" }}>Sin eventos aún</p>
            )}
            {events.slice(0, 12).map(e => (
              <div key={e.id} className="ev">
                <span className="ev-min">{e.min}'</span>
                <span className="ev-ico">{e.ico}</span>
                <span className="ev-txt">{e.txt}</span>
                <span className="ev-p">{e.period === 1 ? "1T" : e.period === 2 ? "2T" : e.period === 3 ? "ET1" : "ET2"}</span>
              </div>
            ))}
          </div>
        </div>

        <button className="btn-sm" style={{ width:"100%", padding:9, marginTop:4, color:"#EF9A9A" }}
          onClick={() => { if (window.confirm("¿Salir sin guardar?")) onClose(); }}
        >
          ✕ Salir sin guardar
        </button>
      </div>

      {/* ── MODALS ── */}
      {modal && (
        <div className="ov" onClick={e => { if (e.target.className === "ov") closeModal(); }}>
          <div className="modal">

            {modal === "goal_us" && (
              <>
                <div className="mt2">⚽ Gol RFC · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                {selP === null ? (
                  <>
                    <p style={{ fontSize:9, color:"#4e6a88", marginBottom:7 }}>¿Quién anotó?</p>
                    <div className="psgrid">
                      {onField.map(pid => {
                        const p = myPlayers.find(x => x.id === pid);
                        if (!p) return null;
                        return (
                          <div key={pid} className="psbtn" onClick={() => setSelP(pid)}>
                            <Avatar p={p} size={24} />
                            <div><div className="psbtn-n">#{p.num} {p.nombre}</div></div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (() => {
                  const pg = myPlayers.find(x => x.id === selP);
                  return (
                    <>
                      <div style={{ textAlign:"center", padding:"8px 0" }}>
                        <div style={{ fontSize:28, marginBottom:3 }}>⚽</div>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", letterSpacing:.5 }}>
                          #{pg?.num} {pg?.nombre} {pg?.apellido}
                        </div>
                        <div style={{ fontSize:9, color:"#4e6a88", marginTop:3 }}>Minuto {curMin}' · Confirmar gol</div>
                      </div>
                      {!showAssist ? (
                        <>
                          <button className="btn" style={{ width:"100%", marginBottom:5 }} onClick={() => setShowAssist(true)}>+ Agregar asistencia</button>
                          <div style={{ display:"flex", gap:6 }}>
                            <button className="btn" style={{ flex:1 }} onClick={() => {
                              doGoalUs(selP);
                            }}>✅ CONFIRMAR GOL</button>
                            <button className="btn-sm" style={{ padding:"10px 14px" }} onClick={() => { setSelP(null); setShowAssist(false); }}>← Cambiar</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize:9, color:"#4e6a88", marginBottom:5 }}>¿Quién asistió?</p>
                          <div className="psgrid">
                            <div className="psbtn" style={{ opacity:.7 }} onClick={() => {
                              setShowAssist(false); doGoalUs(selP);
                            }}>
                              <div style={{ fontSize:18 }}>🚫</div>
                              <div><div className="psbtn-n">Sin asistencia</div></div>
                            </div>
                            {onField.filter(pid=>pid!==selP).map(pid => {
                              const pa = myPlayers.find(x => x.id === pid);
                              if (!pa) return null;
                              return (
                                <div key={pid} className="psbtn" onClick={() => {
                                  setPStats(s => ({ ...s, [pid]: { ...s[pid], asistencias: (s[pid]?.asistencias||0)+1 } }));
                                  addLog("assist", "Asistencia: " + pa.nombre + " → " + pg.nombre, "🎯");
                                  setShowAssist(false); doGoalUs(selP);
                                }}>
                                  <Avatar p={pa} size={22} />
                                  <div><div className="psbtn-n">#{pa.num} {pa.nombre}</div></div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            {modal === "goal_them" && (
              <>
                <div className="mt2">⚽ Gol Rival · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                {rivals.length > 0 ? (
                  <>
                    <p style={{ fontSize:9, color:"#4e6a88", marginBottom:7 }}>¿Quién anotó?</p>
                    <div className="psgrid">
                      {rivals.map(r => (
                        <div key={r.num} className={"psbtn" + (selR === r.num ? " pssel" : "")} onClick={() => setSelR(r.num)}>
                          <span className="riv-num" style={{ width:"auto", marginRight:4 }}>#{r.num}</span>
                          <span style={{ fontSize:10 }}>{r.name || "–"}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:6, marginTop:8 }}>
                      <button className="btn btn-red" onClick={() => selR !== null && doGoalThem(selR)}>CONFIRMAR</button>
                      <button className="btn" style={{ background:"var(--bg3)", border:"1px solid rgba(33,150,243,.15)", fontSize:11 }} onClick={() => doGoalThem(null)}>Sin asignar</button>
                    </div>
                  </>
                ) : (
                  <button className="btn btn-red" onClick={() => doGoalThem(null)}>CONFIRMAR GOL RIVAL</button>
                )}
              </>
            )}

            {/* ── Autogol RFC → suma al rival ── */}
            {modal === "own_goal_us" && (
              <>
                <div className="mt2">🙈 Autogol RFC · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <p style={{ fontSize:9, color:"#4e6a88", marginBottom:8 }}>
                  Suma 1 punto al <strong style={{ color:"#e8a0a0" }}>{match.away}</strong>.<br/>
                  ¿Quién metió el autogol?
                </p>
                <div className="psgrid">
                  {convocados.map(pid => {
                    const p = myPlayers.find(x => x.id === pid);
                    if (!p) return null;
                    return (
                      <div key={pid} className={"psbtn" + (selP === pid ? " psred" : "")}
                        onClick={() => setSelP(pid)}>
                        <Avatar p={p} size={24}/>
                        <div><div className="psbtn-n">#{p.num} {p.nombre}</div></div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:6, marginTop:8 }}>
                  {selP && (
                    <button className="btn btn-red" onClick={() => doOwnGoalUs(selP)}>
                      CONFIRMAR AUTOGOL
                    </button>
                  )}
                  <button className="btn" style={{ background:"var(--bg3)", border:"1px solid rgba(33,150,243,.15)", fontSize:11 }}
                    onClick={() => { setThem(s=>s+1); addLog("goal_them","Autogol RFC","🙈"); closeModal(); }}>
                    Sin asignar
                  </button>
                </div>
              </>
            )}

            {/* ── Autogol rival → suma a RFC ── */}
            {modal === "own_goal_them" && (
              <>
                <div className="mt2">🙈 Autogol Rival · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <p style={{ fontSize:9, color:"#4e6a88", marginBottom:8 }}>
                  Suma 1 punto a <strong style={{ color:"#7ab3e0" }}>{match.home}</strong>.<br/>
                  {rivals.length > 0 ? "¿Quién metió el autogol?" : ""}
                </p>
                {rivals.length > 0 && (
                  <div className="psgrid">
                    {rivals.map(r => (
                      <div key={r.num} className={"psbtn" + (selR === r.num ? " pssel" : "")}
                        onClick={() => setSelR(r.num)}>
                        <span className="riv-num" style={{ width:"auto", marginRight:4 }}>#{r.num}</span>
                        <span style={{ fontSize:10 }}>{r.name || "–"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:6, marginTop:8 }}>
                  {rivals.length > 0 && selR !== null && (
                    <button className="btn" style={{ background:"rgba(21,101,192,.2)", borderColor:"rgba(33,150,243,.4)", color:"#7ab3e0" }}
                      onClick={() => doOwnGoalThem(selR)}>
                      CONFIRMAR AUTOGOL
                    </button>
                  )}
                  <button className="btn" style={{ background:"var(--bg3)", border:"1px solid rgba(33,150,243,.15)", fontSize:11 }}
                    onClick={() => { setUs(s=>s+1); addLog("goal_us","Autogol rival","🙈"); closeModal(); }}>
                    Sin asignar
                  </button>
                </div>
              </>
            )}

            {modal === "foul_us" && (
              <>
                <div className="mt2">⚠️ Falta RFC · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <div className="ftype-row">
                  <button className={"ftype-btn" + (ftype === "direct" ? " ftd" : "")} onClick={() => setFtype("direct")}>
                    ⚠️ Directa<br /><span style={{ fontSize:7 }}>Acumula colectiva</span>
                  </button>
                  <button className={"ftype-btn" + (ftype === "indirect" ? " fti" : "")} onClick={() => setFtype("indirect")}>
                    ↩️ Indirecta<br /><span style={{ fontSize:7 }}>No acumula</span>
                  </button>
                </div>
                {ftype && (
                  <>
                    <div className="ftype-note">
                      {ftype === "direct"
                        ? "Falta directa — suma al conteo colectivo (" + cfU + "/5). Desde la 6ª hay tiro libre 10m para el rival."
                        : "Falta indirecta — se registra por jugador pero NO suma al conteo colectivo."}
                    </div>
                    <div className="psgrid">
                      {onField.map(pid => {
                        const p = myPlayers.find(x => x.id === pid);
                        if (!p) return null;
                        const f = myFouls[pid] || {};
                        return (
                          <div key={pid} className="psbtn" onClick={() => doFoulUs(pid, ftype)}>
                            <Avatar p={p} size={24} />
                            <div>
                              <div className="psbtn-n">#{p.num} {p.nombre}</div>
                              <div className="psbtn-s">Dir:{f.direct||0} Ind:{f.indirect||0}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {modal === "foul_them" && (
              <>
                <div className="mt2">⚠️ Falta Rival · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <div className="ftype-row">
                  <button className={"ftype-btn" + (ftype === "direct" ? " ftd" : "")} onClick={() => setFtype("direct")}>⚠️ Directa</button>
                  <button className={"ftype-btn" + (ftype === "indirect" ? " fti" : "")} onClick={() => setFtype("indirect")}>↩️ Indirecta</button>
                </div>
                {ftype && rivals.length > 0 && (
                  <>
                    <div className="psgrid">
                      {rivals.map(r => {
                        const f = rivFouls[r.num] || {};
                        return (
                          <div key={r.num} className={"psbtn" + (selR === r.num ? " psred" : "")} onClick={() => setSelR(r.num)}>
                            <span className="riv-num" style={{ width:"auto", marginRight:4, fontSize:15 }}>#{r.num}</span>
                            <div>
                              <div className="psbtn-n">{r.name || "–"}</div>
                              <div className="psbtn-s">Dir:{f.direct||0} Ind:{f.indirect||0}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {selR !== null && (
                      <button className="btn btn-red" style={{ marginTop:8 }} onClick={() => doFoulThem(selR, ftype)}>CONFIRMAR</button>
                    )}
                  </>
                )}
                {ftype && rivals.length === 0 && (
                  <button className="btn btn-red" onClick={() => {
                    if (ftype === "direct") {
                      setCfThem(f => ({ ...f, [period]: (f[period]||0) + 1 }));
                      addLog("fd_them", "Falta directa rival", "⚠️");
                    } else {
                      addLog("fi_them", "Falta indirecta rival", "↩️");
                    }
                    closeModal();
                  }}>CONFIRMAR</button>
                )}
              </>
            )}

            {modal === "yel_us" && (
              <>
                <div className="mt2">🟨 Amarilla RFC · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <div className="psgrid">
                  {onField.map(pid => {
                    const p = myPlayers.find(x => x.id === pid);
                    if (!p) return null;
                    const y = (sanctions[pid] && sanctions[pid].yellows) || 0;
                    return (
                      <div key={pid} className={"psbtn" + (selP === pid ? " pssel" : "")} onClick={() => setSelP(pid)}>
                        <Avatar p={p} size={24} />
                        <div>
                          <div className="psbtn-n">#{p.num} {p.nombre}</div>
                          <div className="psbtn-s">{y > 0 ? "🟨×" + y : "Sin tarjetas"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {selP && (
                  <button className="btn" style={{ marginTop:8 }} onClick={() => doCardUs(selP, "yellow")}>CONFIRMAR AMARILLA</button>
                )}
              </>
            )}

            {modal === "red_us" && (
              <>
                <div className="mt2">🟥 Roja RFC · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <div className="psgrid">
                  {onField.map(pid => {
                    const p = myPlayers.find(x => x.id === pid);
                    if (!p) return null;
                    return (
                      <div key={pid} className={"psbtn" + (selP === pid ? " psred" : "")} onClick={() => setSelP(pid)}>
                        <Avatar p={p} size={24} />
                        <div><div className="psbtn-n">#{p.num} {p.nombre}</div></div>
                      </div>
                    );
                  })}
                </div>
                {selP && (
                  <button className="btn btn-red" style={{ marginTop:8 }} onClick={() => doCardUs(selP, "red")}>CONFIRMAR ROJA</button>
                )}
              </>
            )}

            {modal === "yel_them" && (
              <>
                <div className="mt2">🟨 Amarilla Rival · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                {rivals.length > 0 ? (
                  <>
                    <div className="psgrid">
                      {rivals.map(r => {
                        const f = rivFouls[r.num] || {};
                        return (
                          <div key={r.num} className={"psbtn" + (selR === r.num ? " pssel" : "")} onClick={() => setSelR(r.num)}>
                            <span className="riv-num" style={{ width:"auto", marginRight:4, fontSize:15 }}>#{r.num}</span>
                            <div>
                              <div className="psbtn-n">{r.name || "–"}</div>
                              <div className="psbtn-s">{f.yellows > 0 ? "🟨×" + f.yellows : ""}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {selR !== null && <button className="btn" style={{ marginTop:8 }} onClick={() => doCardThem(selR, "yellow")}>CONFIRMAR</button>}
                  </>
                ) : (
                  <button className="btn" onClick={() => { addLog("y_them","Amarilla rival","🟨"); closeModal(); }}>CONFIRMAR</button>
                )}
              </>
            )}

            {modal === "red_them" && (
              <>
                <div className="mt2">🟥 Roja Rival · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                {rivals.length > 0 ? (
                  <>
                    <div className="psgrid">
                      {rivals.map(r => (
                        <div key={r.num} className={"psbtn" + (selR === r.num ? " psred" : "")} onClick={() => setSelR(r.num)}>
                          <span className="riv-num" style={{ width:"auto", marginRight:4, fontSize:15 }}>#{r.num}</span>
                          <span style={{ fontSize:10 }}>{r.name || "–"}</span>
                        </div>
                      ))}
                    </div>
                    {selR !== null && <button className="btn btn-red" style={{ marginTop:8 }} onClick={() => doCardThem(selR, "red")}>CONFIRMAR</button>}
                  </>
                ) : (
                  <button className="btn btn-red" onClick={() => { addLog("r_them","Roja rival","🟥"); closeModal(); }}>CONFIRMAR</button>
                )}
              </>
            )}

            {modal === "tm_us" && (
              <>
                <div className="mt2">⏸ Tiempo Muerto RFC <span className="mx" onClick={closeModal}>✕</span></div>
                <p style={{ fontSize:10, color:"#4e6a88", marginBottom:9, lineHeight:1.5 }}>
                  Tiempo muerto de <strong style={{ color:"#ccd8e8" }}>Rómulo FC</strong> en el minuto {curMin}' del {period === 1 ? "primer" : "segundo"} tiempo.
                  <br /><span style={{ color:"#EF9A9A", fontSize:9 }}>Solo 1 por tiempo. No se puede revertir.</span>
                </p>
                <button className="btn" onClick={() => doTimeout("us")}>CONFIRMAR</button>
              </>
            )}

            {modal === "tm_them" && (
              <>
                <div className="mt2">⏸ Tiempo Muerto Rival <span className="mx" onClick={closeModal}>✕</span></div>
                <p style={{ fontSize:10, color:"#4e6a88", marginBottom:9, lineHeight:1.5 }}>
                  Tiempo muerto de <strong style={{ color:"#ccd8e8" }}>{match.away}</strong> en el minuto {curMin}'.
                </p>
                <button className="btn btn-red" onClick={() => doTimeout("them")}>CONFIRMAR</button>
              </>
            )}

            {modal === "add_player" && (
              <AddPlayerModal
                match={match}
                rivals={rivals}
                myPlayers={myPlayers}
                curMin={curMin}
                onClose={closeModal}
                onAddUs={(nombre, num) => {
                  const tempId = "temp_" + Date.now();
                  myPlayers.push({ id:tempId, nombre, apellido:"", num, cat:match.cat,
                    col:"#1565C0", foto:null, stats:{goles:0,asistencias:0,partidos:0} });
                  setConvocados(prev => [...prev, tempId]);
                  setPStats(prev => ({ ...prev, [tempId]:{ goles:0, asistencias:0 } }));
                  addLog("sub", nombre + " #" + num + " entra (RFC)", "👤");
                  closeModal();
                }}
                onAddThem={(nombre, num) => {
                  setRivals(rv => [...rv, { num, name:nombre }]);
                  addLog("sub", nombre + " #" + num + " registrado (Rival)", "👤");
                  closeModal();
                }}
              />
            )}

            {modal === "sub" && (
              <>
                <div className="mt2">🔄 Cambio · {curMin}' <span className="mx" onClick={closeModal}>✕</span></div>
                <p style={{ fontSize:9, color:"#4e6a88", marginBottom:6 }}>SALE (en cancha):</p>
                <div className="psgrid">
                  {onField.map(pid => {
                    const p = myPlayers.find(x => x.id === pid);
                    if (!p) return null;
                    return (
                      <div key={pid} className={"psbtn" + (selOut === pid ? " psred" : "")} onClick={() => setSelOut(pid)}>
                        <Avatar p={p} size={24} />
                        <div><div className="psbtn-n">#{p.num} {p.nombre}</div></div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize:9, color:"#4e6a88", margin:"8px 0 6px" }}>ENTRA (banca):</p>
                <div className="psgrid">
                  {bench.map(pid => {
                    const p = myPlayers.find(x => x.id === pid);
                    if (!p) return null;
                    return (
                      <div key={pid} className={"psbtn" + (selP === pid ? " pssel" : "")} onClick={() => setSelP(pid)}>
                        <Avatar p={p} size={24} />
                        <div><div className="psbtn-n">#{p.num} {p.nombre}</div></div>
                      </div>
                    );
                  })}
                </div>
                {selOut && selP && (
                  <button className="btn" style={{ marginTop:8 }} onClick={doSub}>CONFIRMAR CAMBIO</button>
                )}
              </>
            )}

          </div>
        </div>
      )}

      {/* ── Modal ¿Tiempo Extra? ── */}
      {showExtraQ && (
        <div className="ov">
          <div className="modal" style={{ textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:6 }}>⚡</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#d4b84a", marginBottom:4 }}>
              EMPATE AL FINAL DEL TIEMPO REGLAMENTARIO
            </div>
            <div style={{ fontSize:10, color:"var(--txt)", marginBottom:6 }}>
              {match.home} {scoreUs} — {scoreThem} {match.away}
            </div>
            <div style={{ fontSize:9, color:"#4e6a88", marginBottom:16 }}>
              Fase: {match.fase} · Se jugarán 2 tiempos extra de {minET} minutos
            </div>
            <button className="btn" style={{ width:"100%", marginBottom:8, background:"rgba(212,184,74,.15)", borderColor:"rgba(212,184,74,.4)", color:"#d4b84a" }}
              onClick={startExtraTime}>
              ⚡ Sí, jugar Tiempo Extra
            </button>
            <button className="btn-sm" style={{ width:"100%", padding:10 }}
              onClick={() => { setShowExtraQ(false); addLog("end","Fin del Partido","🏁"); setPhase("summary"); }}>
              Terminar sin tiempo extra
            </button>
          </div>
        </div>
      )}

      {/* ── Modal ¿Penales? ── */}
      {showPenalQ && (
        <div className="ov">
          <div className="modal" style={{ textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:6 }}>🥅</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#E53935", marginBottom:4 }}>
              EMPATE EN TIEMPO EXTRA
            </div>
            <div style={{ fontSize:10, color:"var(--txt)", marginBottom:16 }}>
              {match.home} {scoreUs} — {scoreThem} {match.away}
            </div>
            <button className="btn" style={{ width:"100%", marginBottom:8, background:"rgba(229,57,53,.15)", borderColor:"rgba(229,57,53,.4)", color:"#ef9a9a" }}
              onClick={startPenales}>
              🥅 Ir a tanda de penales
            </button>
            <button className="btn-sm" style={{ width:"100%", padding:10 }}
              onClick={() => { setShowPenalQ(false); addLog("end","Fin del Partido","🏁"); setPhase("summary"); }}>
              Terminar sin penales
            </button>
          </div>
        </div>
      )}

      {/* ── Pantalla de Penales ── */}
      {showPenales && (
        <div className="ov">
          <div className="modal">
            <div className="mt2">🥅 Tanda de Penales <span className="mx" onClick={() => { setShowPenales(false); setPhase("summary"); }}>✕</span></div>
            <div style={{ display:"flex", justifyContent:"space-around", marginBottom:12 }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#7ab3e0", marginBottom:4, fontWeight:600 }}>{match.home}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30, color:"#2196F3" }}>{penUs.filter(Boolean).length}</div>
                <div style={{ display:"flex", gap:5, marginTop:6, flexWrap:"wrap", maxWidth:140, justifyContent:"center" }}>
                  {penUs.map((r,i) => (
                    <span key={i} style={{ fontSize:16 }}>{r ? "✅" : "❌"}</span>
                  ))}
                </div>
                <div style={{ display:"flex", gap:5, marginTop:8 }}>
                  <button className="btn-sm" style={{ padding:"6px 10px", fontSize:11 }} onClick={() => setPenUs(p => [...p, true])}>✅ Gol</button>
                  <button className="btn-sm" style={{ padding:"6px 10px", fontSize:11, background:"rgba(183,28,28,.15)", borderColor:"rgba(183,28,28,.3)", color:"#ef9a9a" }} onClick={() => setPenUs(p => [...p, false])}>❌ Falla</button>
                </div>
                {penUs.length > 0 && (
                  <button className="btn-sm" style={{ marginTop:4, padding:"4px 8px", fontSize:9, color:"#4e6a88" }} onClick={() => setPenUs(p => p.slice(0,-1))}>↩ Deshacer</button>
                )}
              </div>
              <div style={{ width:1, background:"rgba(255,255,255,.05)" }} />
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#ef9a9a", marginBottom:4, fontWeight:600 }}>{match.away}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30, color:"#E53935" }}>{penThem.filter(Boolean).length}</div>
                <div style={{ display:"flex", gap:5, marginTop:6, flexWrap:"wrap", maxWidth:140, justifyContent:"center" }}>
                  {penThem.map((r,i) => (
                    <span key={i} style={{ fontSize:16 }}>{r ? "✅" : "❌"}</span>
                  ))}
                </div>
                <div style={{ display:"flex", gap:5, marginTop:8 }}>
                  <button className="btn-sm" style={{ padding:"6px 10px", fontSize:11 }} onClick={() => setPenThem(p => [...p, true])}>✅ Gol</button>
                  <button className="btn-sm" style={{ padding:"6px 10px", fontSize:11, background:"rgba(183,28,28,.15)", borderColor:"rgba(183,28,28,.3)", color:"#ef9a9a" }} onClick={() => setPenThem(p => [...p, false])}>❌ Falla</button>
                </div>
                {penThem.length > 0 && (
                  <button className="btn-sm" style={{ marginTop:4, padding:"4px 8px", fontSize:9, color:"#4e6a88" }} onClick={() => setPenThem(p => p.slice(0,-1))}>↩ Deshacer</button>
                )}
              </div>
            </div>
            {(penUs.length > 0 || penThem.length > 0) && penUs.length !== penThem.length || penUs.length >= 5 ? null : null}
            <button className="btn" style={{ width:"100%", marginTop:4 }}
              onClick={() => {
                const ganador = penUs.filter(Boolean).length > penThem.filter(Boolean).length ? match.home : penThem.filter(Boolean).length > penUs.filter(Boolean).length ? match.away : "Empate";
                addLog("end", "Fin por penales: " + match.home + " " + penUs.filter(Boolean).length + " — " + penThem.filter(Boolean).length + " " + match.away + " · Ganador: " + ganador, "🥅");
                setShowPenales(false);
                setPhase("summary");
              }}>
              🏁 Finalizar partido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────

export default function App() {

  // ── Demo check (antes de estados para usarse en Firebase bypass) ──
  const _demoSession = (() => { try { const s = sessionStorage.getItem("rfc_session"); return s ? JSON.parse(s) : null; } catch { return null; } })();


  // ── STATE ──────────────────────────────────
  const [players,  setPlayers]  = useState([]);
  const [matches,  setMatches]  = useState([]);
  const [pay,      setPay]      = useState({});
  const [sanc,     setSanc]     = useState({});
  const [att,      setAtt]      = useState({});
  const [coaches,  setCoaches]  = useState(COACHES_DEFAULT);
  const [dbReady,  setDbReady]  = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [attSession, setAttSession] = useState(null);
  const [notifs,   setNotifs]   = useState([]);

  // ── PUSH NOTIFICATIONS ─────────────────────
  const [pushStatus, setPushStatus] = useState("idle"); // idle | requesting | granted | denied | unsupported
  const [swUpdate,  setSwUpdate]   = useState(false);
  const [darkMode,  setDarkMode]   = useState(() => {
    try { return localStorage.getItem("rfc_theme") !== "light"; } catch { return true; }
  });

  // Aplicar clase al body según el modo
  useEffect(() => {
    document.body.classList.toggle("light", !darkMode);
    try { localStorage.setItem("rfc_theme", darkMode ? "dark" : "light"); } catch {}
  }, [darkMode]);

  // ── Listener de actualizaciones del SW ──
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onSwMsg = e => {
      if (e.data && e.data.type === "SW_UPDATED") setSwUpdate(true);
    };
    navigator.serviceWorker.addEventListener("message", onSwMsg);
    // También detectar cuando hay un SW esperando
    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) setSwUpdate(true);
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller)
            setSwUpdate(true);
        });
      });
    });
    return () => navigator.serviceWorker.removeEventListener("message", onSwMsg);
  }, []);

  useEffect(() => {
    if (!messaging || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setPushStatus("unsupported"); return;
    }
    if (Notification.permission === "granted") {
      setPushStatus("granted");
      registerFCMToken();
    } else if (Notification.permission === "denied") {
      setPushStatus("denied");
    }

    // Notificaciones con la app ABIERTA (foreground)
    const unsubMsg = onMessage(messaging, payload => {
      const { title, body } = payload.notification || {};
      const id = String(Date.now());
      if (!isDemoSession()) setDoc(doc(db, "notifs", id), {
        id, txt: (title ? title + ": " : "") + (body || ""),
        ts: new Date().toISOString(), read: false
      });
    });
    return () => unsubMsg();
  }, []);

  async function registerFCMToken() {
    try {
      const sw = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
      if (token) {
        const deviceId = token.slice(-20);
        // Guardar token con info del usuario para filtrar notifs por categoría/rol
        await setDoc(doc(db, "fcm_tokens", deviceId), {
          token,
          nombre:    user?.name    || "desconocido",
          role:      role          || "visitor",
          playerId:  user?.playerId ? String(user.playerId) : null,
          cat:       user?.cat     || "Todas",
          updatedAt: new Date().toISOString(),
          platform:  navigator.userAgent.includes("Android") ? "android" : "ios/web"
        });
      }
    } catch(e) {
      console.warn("FCM token error:", e);
    }
  }

  async function requestPushPermission() {
    if (!messaging) return;
    setPushStatus("requesting");
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setPushStatus("granted");
        await registerFCMToken();
      } else {
        setPushStatus("denied");
      }
    } catch(e) {
      setPushStatus("denied");
    }
  }

  // Detectar modo demo antes de Firebase
  const _demoCheck = (() => { try { const s = sessionStorage.getItem("rfc_session"); return s ? JSON.parse(s)?.isDemo : false; } catch { return false; } })();

  // ── FIRESTORE LISTENERS ────────────────────
  useEffect(() => {
    // Si es modo demo, cargar datos ficticios y no conectar a Firebase
    if (_demoCheck) {
      const DP = [
        { id:9001, nombre:"Carlos",   apellido:"Rodríguez", cat:"Sub-15", num:10, tel:"04140000001", repNombre:"Pedro",  repApellido:"Rodríguez", repTel:"04140000002", repCedula:"V-99000001", cedula:"V-88000001", dob:"2010-03-15", foto:null, stats:{ goles:8, asistencias:5, partidos:12 }, subequipo:"A", talla:"M", tipoSangre:"O+", contactoEmergencia:"Pedro Rodríguez 04140000002", eval:{ velocidad:8, tecnica:9, tactica:7, fisico:8, actitud:9, trabajo:9 } },
        { id:9002, nombre:"Andrés",   apellido:"Martínez",  cat:"Sub-13", num:7,  tel:"04140000003", repNombre:"Ana",    repApellido:"Martínez",  repTel:"04140000004", repCedula:"V-99000003", cedula:"V-88000003", dob:"2012-06-22", foto:null, stats:{ goles:4, asistencias:7, partidos:10 }, subequipo:"B", talla:"S", tipoSangre:"A+", contactoEmergencia:"Ana Martínez 04140000004",    eval:{ velocidad:7, tecnica:8, tactica:8, fisico:6, actitud:8, trabajo:9 } },
        { id:9003, nombre:"Luis",     apellido:"García",    cat:"Sub-17", num:1,  tel:"04140000005", repNombre:"María",  repApellido:"García",    repTel:"04140000006", repCedula:"V-99000005", cedula:"V-88000005", dob:"2008-11-08", foto:null, stats:{ goles:0, asistencias:2, partidos:14 }, subequipo:"A", talla:"L", tipoSangre:"B+", contactoEmergencia:"María García 04140000006",   eval:{ velocidad:6, tecnica:7, tactica:9, fisico:9, actitud:7, trabajo:8 } },
        { id:9004, nombre:"Miguel",   apellido:"Torres",    cat:"Sub-15", num:5,  tel:"04140000007", repNombre:"Jorge",  repApellido:"Torres",    repTel:"04140000008", repCedula:"V-99000007", cedula:"V-88000007", dob:"2010-08-20", foto:null, stats:{ goles:5, asistencias:3, partidos:11 }, subequipo:"A", talla:"M", tipoSangre:"AB+", contactoEmergencia:"Jorge Torres 04140000008",  eval:{ velocidad:9, tecnica:7, tactica:6, fisico:9, actitud:8, trabajo:7 } },
        { id:9005, nombre:"Gabriela", apellido:"Vega",      cat:"Sub-11", num:3,  tel:"04140000009", repNombre:"Carmen", repApellido:"Vega",      repTel:"04140000010", repCedula:"V-99000009", cedula:"V-88000009", dob:"2014-01-10", foto:null, stats:{ goles:2, asistencias:4, partidos:8  }, subequipo:"B", talla:"XS", tipoSangre:"O-", contactoEmergencia:"Carmen Vega 04140000010",   eval:{ velocidad:7, tecnica:6, tactica:5, fisico:6, actitud:10, trabajo:9 } },
      ];
      const DM = [
        { id:8001, home:"Rómulo FC", away:"Deportivo Carabobo", date:"10 Mar 2026", time:"10:00", cat:"Sub-15", field:"Campo A", status:"finalizado", scoreH:3, scoreA:1, fase:"Normal", playerStats:{ 9001:{ goles:2, asistencias:1 }, 9004:{ goles:1, asistencias:0 } }, mvp:{ playerId:9001, nombre:"Carlos", apellido:"Rodríguez" } },
        { id:8002, home:"Rómulo FC", away:"Atlético Valencia",  date:"05 Mar 2026", time:"15:00", cat:"Sub-15", field:"Campo B", status:"finalizado", scoreH:1, scoreA:1, fase:"Normal", playerStats:{ 9001:{ goles:0, asistencias:1 }, 9004:{ goles:1, asistencias:0 } }, mvp:{ playerId:9004, nombre:"Miguel", apellido:"Torres" } },
        { id:8003, home:"Rómulo FC", away:"Carabobo FC Sub-15", date:"28 Mar 2026", time:"09:00", cat:"Sub-15", field:"Campo A", status:"próximo", scoreH:null, scoreA:null, fase:"Normal" },
        { id:8004, home:"Rómulo FC", away:"Escuela Cruz Diez",  date:"08 Mar 2026", time:"11:00", cat:"Sub-13", field:"Campo C", status:"finalizado", scoreH:2, scoreA:0, fase:"Normal", playerStats:{ 9002:{ goles:1, asistencias:1 } }, mvp:{ playerId:9002, nombre:"Andrés", apellido:"Martínez" } },
        { id:8005, home:"Rómulo FC", away:"Mineros de Guayana", date:"25 Mar 2026", time:"16:00", cat:"Sub-13", field:"Campo B", status:"próximo", scoreH:null, scoreA:null, fase:"Normal" },
        { id:8006, home:"Rómulo FC", away:"Deportivo Lara",     date:"01 Mar 2026", time:"10:00", cat:"Sub-17", field:"Campo A", status:"finalizado", scoreH:0, scoreA:2, fase:"Normal", playerStats:{ 9003:{ goles:0, asistencias:0 } }, mvp:null },
      ];
      const DPAY = {
        9001: { id:9001, months:{ Ene:{ paid:true, monto:"30", metodo:"Efectivo Bs.", date:"05 Ene" }, Feb:{ paid:true, monto:"30", metodo:"Zelle", date:"03 Feb" }, Mar:{ paid:false } }, history:[], arbitraje:[] },
        9002: { id:9002, months:{ Ene:{ paid:true, monto:"30", metodo:"Efectivo Bs.", date:"04 Ene" }, Feb:{ paid:false }, Mar:{ paid:false } }, history:[], arbitraje:[] },
        9003: { id:9003, months:{ Ene:{ paid:true, monto:"30", metodo:"Binance", date:"02 Ene" }, Feb:{ paid:true, monto:"30", metodo:"Binance", date:"01 Feb" }, Mar:{ paid:true, monto:"30", metodo:"Binance", date:"01 Mar" } }, history:[], arbitraje:[] },
        9004: { id:9004, months:{ Ene:{ paid:true, monto:"30", metodo:"Efectivo Bs.", date:"06 Ene" }, Feb:{ paid:false }, Mar:{ paid:false } }, history:[], arbitraje:[] },
        9005: { id:9005, months:{ Ene:{ paid:false }, Feb:{ paid:false }, Mar:{ paid:false } }, history:[], arbitraje:[] },
      };
      const DATT = {
        9001: { "6001":{ present:true }, "6002":{ present:true }, "6003":{ present:false } },
        9002: { "6001":{ present:true }, "6002":{ present:false }, "6003":{ present:true } },
        9003: { "6001":{ present:true }, "6002":{ present:true }, "6003":{ present:true } },
        9004: { "6001":{ present:false }, "6002":{ present:true }, "6003":{ present:true } },
        9005: { "6001":{ present:true }, "6002":{ present:true }, "6003":{ present:false } },
      };
      const DSANC = {
        9001:{ id:9001, yellows:1, reds:0, suspended:false },
        9002:{ id:9002, yellows:2, reds:0, suspended:false },
        9003:{ id:9003, yellows:0, reds:0, suspended:false },
        9004:{ id:9004, yellows:0, reds:1, suspended:true  },
        9005:{ id:9005, yellows:1, reds:0, suspended:false },
      };
      const DCHAMPS = [{ id:7001, nombre:"Copa Rómulo FC 2026", cats:["Sub-15","Sub-13"], activo:true, fase:"grupos", grupos:[{ nombre:"Grupo A", equipos:["Rómulo FC","Deportivo Carabobo","Atlético Valencia","Escuela Cruz Diez"] }], standings:[{ equipo:"Rómulo FC", pj:2, g:1, e:1, p:0, gf:4, gc:2, pts:4, dg:2 },{ equipo:"Deportivo Carabobo", pj:2, g:1, e:0, p:1, gf:3, gc:3, pts:3, dg:0 },{ equipo:"Atlético Valencia", pj:2, g:0, e:1, p:1, gf:2, gc:4, pts:1, dg:-2 }] }];
      const DTRAININGS = [
        { id:"6001", fecha:"2026-03-24", hora:"17:00", lugar:"Campo A", cats:["Sub-15"], tema:"Definición y finalización", notas:"Traer peto azul" },
        { id:"6002", fecha:"2026-03-26", hora:"17:00", lugar:"Campo A", cats:["Sub-15"], tema:"Pases en velocidad", notas:"" },
        { id:"6003", fecha:"2026-03-28", hora:"17:00", lugar:"Campo B", cats:["Sub-15"], tema:"Táctica defensiva", notas:"Trabajo físico" },
        { id:"6004", fecha:"2026-03-24", hora:"16:00", lugar:"Campo C", cats:["Sub-13"], tema:"Control de balón", notas:"" },
      ];
      const DCOACHES = [{ id:99, name:"Demo Entrenador", role:"Director Técnico", cat:"Todas", pin:"1111", perms:["inicio","jugadores","asistencia","pagos","calendario","entrenamientos","campeonatos","uniformes","chat","stats","entrenadores","config","partido"] }];
      const DATT_MATCHES = [
        { matchId:8001, date:"10 Mar 2026", cat:"Sub-15", home:"Rómulo FC", away:"Deportivo Carabobo", convocados:[9001,9004], titulares:[9001,9004], mvp:{ playerId:9001 } },
        { matchId:8002, date:"05 Mar 2026", cat:"Sub-15", home:"Rómulo FC", away:"Atlético Valencia",  convocados:[9001,9004], titulares:[9001],       mvp:{ playerId:9004 } },
      ];
      setPlayers(DP); setPay(DPAY); setSanc(DSANC); setAtt(DATT);
      setCoaches(DCOACHES); setMatches(DM); setChamps(DCHAMPS);
      setTrainings(DTRAININGS); setAttMatches(DATT_MATCHES);
      setDbReady(true);
      return;
    }

    const unsubs = [];

    // Jugadores
    unsubs.push(onSnapshot(collection(db, "players"), snap => {
      // Usar docChanges para actualizaciones incrementales
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setPlayers(data);
      // Inicializar pay/sanc/att para jugadores nuevos
      setPay(prev => {
        const next = { ...prev };
        data.forEach(p => {
          if (!next[p.id]) next[p.id] = { months: MONTHS.reduce((a,m) => ({ ...a,[m]:{ paid:false,date:null } }),{}), championships:{}, arbitraje:[], history:[] };
        });
        return next;
      });
      setSanc(prev => {
        const next = { ...prev };
        data.forEach(p => { if (!next[p.id]) next[p.id] = { yellows:0, reds:0, suspended:false, history:[] }; });
        return next;
      });
      setAtt(prev => {
        const next = { ...prev };
        data.forEach(p => { if (!next[p.id]) next[p.id] = {}; });
        return next;
      });
    }));

    // Partidos
    unsubs.push(onSnapshot(collection(db, "matches"), snap => {
      setMatches(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }));

    // Pagos
    unsubs.push(onSnapshot(collection(db, "pay"), snap => {
      const data = {};
      snap.docs.forEach(d => { data[d.id] = d.data(); });
      setPay(data);
    }));

    // Sanciones
    unsubs.push(onSnapshot(collection(db, "sanc"), snap => {
      const data = {};
      snap.docs.forEach(d => { data[d.id] = d.data(); });
      setSanc(data);
    }));

    // Asistencia
    unsubs.push(onSnapshot(collection(db, "att"), snap => {
      const data = {};
      snap.docs.forEach(d => { data[d.id] = d.data(); });
      setAtt(data);
    }));

    // Notificaciones
    unsubs.push(onSnapshot(collection(db, "notifs"), snap => {
      setNotifs(snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>(b.ts||"").localeCompare(a.ts||"")).slice(0,50));
    }));

    // Coaches — solo lee de Firebase, nunca sobreescribe
    unsubs.push(onSnapshot(collection(db, "coaches"), snap => {
      if (snap.docs.length > 0) {
        setCoaches(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      }
      // Si está vacío no hacemos nada — el DT los crea desde el módulo Entrenadores
    }));

    // Configuración del club
    unsubs.push(onSnapshot(doc(db, "config", "club"), snap => {
      if (snap.exists()) setClubConfig(snap.data());
    }));

    // Entrenamientos
    unsubs.push(onSnapshot(collection(db, "trainings"), snap => {
      setTrainings(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }));

    // Campeonatos
    unsubs.push(onSnapshot(collection(db, "champs"), snap => {
      setChamps(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }));
    unsubs.push(onSnapshot(collection(db, "chat"), snap => {
      const msgs = snap.docs.map(d=>({...d.data(),id:d.id}));
      msgs.sort((a,b)=>(a.ts||"").localeCompare(b.ts||""));
      setChatMsgs(msgs.slice(-150));
    }));
    unsubs.push(onSnapshot(collection(db, "att_matches"), snap => {
      setAttMatches(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }));

    setDbReady(true);

    // Detectar cambios de conexión
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);

    // ── Verificador de cumpleaños cada minuto ──
    const checkBirthdays = () => {
      const now = new Date();
      if (now.getHours() !== 9 || now.getMinutes() !== 0) return;
      const dd = now.getDate(), mm = now.getMonth()+1;
      const key = "bday_sent_" + dd + "_" + mm + "_" + now.getFullYear();
      if (sessionStorage.getItem(key)) return;
      // Marcar para no enviar de nuevo en esta sesión
      sessionStorage.setItem(key, "1");
      // Disparar evento para que el dashboard lo procese
      window.dispatchEvent(new CustomEvent("rfc_bday_check", { detail:{ dd, mm } }));
    };
    const bdayInterval = setInterval(checkBirthdays, 60000);
    checkBirthdays(); // chequeo inicial

    return () => {
      unsubs.forEach(u => u());
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(bdayInterval);
    };
  }, []);

  // Auth — restaurar sesión si existe
  const _savedSession = (() => { try { const s = sessionStorage.getItem("rfc_session"); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [loggedIn, setLoggedIn] = useState(!!_savedSession);
  const [role,     setRole]     = useState(_savedSession?.role || null);
  const [user,     setUser]     = useState(_savedSession?.user || null);
  const [lstep,    setLstep]    = useState("role");
  const [selCoach, setSelCoach] = useState(null);
  const [pin,      setPin]      = useState("");
  const [lid,      setLid]      = useState("");
  const [lerr,     setLerr]     = useState("");

  // UI
  const [tab,      setTab]      = useState("inicio");
  const [catF,     setCatF]     = useState("Todas");
  const [payTab,   setPayTab]   = useState("mensualidades");
  const [liveM,    setLiveM]    = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [showMForm,setShowMForm]= useState(false);
  const [showListWA,setShowListWA]= useState(false);
  const [showNotif,setShowNotif]= useState(false);
  const [addOk,    setAddOk]    = useState(false);
  const [formErr,  setFormErr]  = useState("");
  const [conf,     setConf]     = useState(null);
  const [search,   setSearch]   = useState("");
  const [listType, setListType] = useState("pendientes");
  const [listCat,  setListCat]  = useState("Todas");
  const photoRef = useRef();
  // Modal de registro de pago mensual
  const [payModal,  setPayModal]  = useState(null); // { pid, mes }
  const [payRef,    setPayRef]    = useState("");
  const [payMonto,  setPayMonto]  = useState("");
  const [payMetodo, setPayMetodo] = useState("Transferencia");
  const [payErr,    setPayErr]    = useState("");
  const [payFoto,   setPayFoto]   = useState(null); // base64 comprobante
  const [tasaCambio, setTasaCambio] = useState("36.50"); // Bs. por $1

  // Entrenamientos
  const DIAS_SEMANA = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
  const [trainings, setTrainings] = useState([]);
  const [showTForm,  setShowTForm]  = useState(false);
  const [editTrain,  setEditTrain]  = useState(null);
  const [nt, setNt] = useState({ fecha:"", hora:"", lugar:"", cats:[], notas:"", tema:"", repetir:false, repetirSemanas:4 });

  // Campeonatos
  const [champs, setChamps] = useState([]);
  const [showCForm,  setShowCForm]  = useState(false);
  const [nc, setNc] = useState({ nombre:"", cats:[], activo:true, link:"", minET:5 });

  // Staff / Coaches form
  const ALL_PERMS = ["jugadores","pagos","calendario","stats","entrenadores","partido"];
  const COACH_BLANK = { name:"", role:"", pin:"", cat:"Sub-11", tel:"", perms:[] };
  const [showCoachForm, setShowCoachForm] = useState(false);
  const [editCoachId,   setEditCoachId]   = useState(null);
  const [nc2, setNc2] = useState(COACH_BLANK);
  const [coachErr, setCoachErr] = useState("");
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [chatCat,    setChatCat]   = useState("General");
  const [chatMsg,    setChatMsg]   = useState("");
  const [chatMsgs,   setChatMsgs]  = useState([]);
  const [attMatches, setAttMatches] = useState([]);
  const [mvpModal,   setMvpModal]   = useState(null);  // matchId del partido a votar MVP
  const [mvpPdfSent, setMvpPdfSent] = useState(false);
  const [surveyTarget, setSurveyTarget] = useState(null);
  const [galeriaModal, setGaleriaModal] = useState(null);
  const [isDemo, setIsDemo] = useState(!!_savedSession?.isDemo); // { pid, nombre, session }
  const [lastMatchResult, setLastMatchResult] = useState(null);
  const [compareModal, setCompareModal] = useState(false);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState(""); // PDF ya enviado en esta sesión
  const [torneoRapido, setTorneoRapido] = useState(null); // modal torneo rápido
  const [trStep,      setTrStep]      = useState(1);
  const [trData,      setTrData]      = useState({ nombre:"", fecha:"", cat:"Sub-15", formato:"grupos", equipos:[] });
  const [trEquipoNuevo, setTrEquipoNuevo] = useState("");
  const [trPartidos,  setTrPartidos]  = useState([]); // partidos del torneo rápido activo
  // ── Agenda/Calendario ──
  const [agendaVista,  setAgendaVista]  = useState("mensual"); // "mensual" | "semanal"
  const [agendaMes,    setAgendaMes]    = useState(new Date().getMonth());
  const [agendaAnio,   setAgendaAnio]   = useState(new Date().getFullYear());
  const [agendaSemana, setAgendaSemana] = useState(0); // offset de semanas desde hoy
  const [agendaDia,    setAgendaDia]    = useState(null); // día seleccionado para ver detalle
  // ── Torneos estados ──
  const T_BLANK_G = { nombre:"", fecha:"", lugar:"", costo:"", cats:[], resultado:"", notas:"" };
  const [showTFormT, setShowTFormT] = useState(false);
  const [editTIdx,   setEditTIdx]   = useState(null);
  const [ntT,        setNtT]        = useState(T_BLANK_G);
  // ── Encuesta estados ──
  const [svSentido,  setSvSentido]  = useState(0);
  const [svPractico, setSvPractico] = useState("");
  const [svMolestia, setSvMolestia] = useState("no");
  const [svZona,     setSvZona]     = useState("");
  const [svProximo,  setSvProximo]  = useState("si");
  const [csvErr, setCsvErr] = useState("");
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);

  // Stats
  const [statCat,  setStatCat]  = useState("Todas");
  const [statView, setStatView] = useState("goleadores");

  // WhatsApp al registrar jugador
  const [newPlayerWA, setNewPlayerWA] = useState(null);

  // Configuración del club
  const [clubConfig, setClubConfig] = useState({
    nombre: "Rómulo F.C",
    temporada: "2026",
    ciudad: "Caracas",
    tel: "04140000001",
    colores: "Azul y Rojo",
    maxJugadoresCat: 20,
    mesesActivos: [...MONTHS],
    directora: "Prof. María García",
    directoraCedula: "V-10000001",
  });
  const [editConfig, setEditConfig] = useState(false);
  const [cfgDraft,  setCfgDraft]  = useState(null);
  const [newPin,    setNewPin]    = useState("");
  const [newPin2,   setNewPin2]   = useState("");
  const [pinOk,     setPinOk]     = useState("");
  const [expandChamp, setExpandChamp] = useState(null); // id del campeonato expandido
  const [editStanding, setEditStanding] = useState(null); // { champId, row }
  const [nsRow, setNsRow] = useState({ equipo:"", pj:0, g:0, e:0, p:0, gf:0, gc:0 });

  const NP_BLANK = { nombre:"", apellido:"", cedula:"", dob:"", tel:"", cat:"Sub-11", num:"", subequipo:"", repNombre:"", repApellido:"", repCedula:"", repTel:"", foto:null, notas:"" };
  const [np,       setNp]       = useState(NP_BLANK);
  const [editPid,  setEditPid]  = useState(null);
  const [statsEditModal, setStatsEditModal] = useState(null); // jugador a editar stats
  const [statsEdit, setStatsEdit] = useState({ goles:0, asistencias:0, partidos:0, mvps:0, yellows:0, reds:0 });
  const [historialModal, setHistorialModal] = useState(false);
  const [trNombre,     setTrNombre]     = useState("");
  const [trFecha,      setTrFecha]      = useState("");
  const [trCat,        setTrCat]        = useState("Sub-15");
  const [trEquips,     setTrEquips]     = useState(["",""]);
  const [trErr,        setTrErr]        = useState("");
  const [calVista,     setCalVista]     = useState("lista");
  const [exentoModal, setExentoModal] = useState(null);
  const [selectedChildId,  setSelectedChildId]  = useState(null);
  const [liveMMinimized,   setLiveMMinimized]   = useState(false); // live match en segundo plano
  const [quickResult,     setQuickResult]     = useState(null);  // partido para resultado rápido
  const [qr,              setQr]              = useState({ scoreH:"", scoreA:"", goleadores:[] });
  const [qrInput,         setQrInput]         = useState("");    // input goleador
  const [liveState,        setLiveState]        = useState({ secs:0, scoreUs:0, scoreThem:0, running:false });
  const [bulkMode,      setBulkMode]      = useState(false);   // modo edición masiva
  const [bulkSel,       setBulkSel]       = useState([]);      // ids seleccionados
  const [bulkAction,    setBulkAction]    = useState("cat");   // "cat"|"uniforme"
  const [bulkVal,       setBulkVal]       = useState({});      // valores a aplicar
  const [anoFiltro,     setAnoFiltro]     = useState("");      // filtro por año nacimiento
  const [exentoMotivo,setExentoMotivo]= useState("");
  const [hp, setHp] = useState({ home:"Rómulo FC", away:"", date:"", cat:"Sub-15", field:"", scoreH:"", scoreA:"", fase:"Normal", champId:"" });
  const [hpStats, setHpStats] = useState({}); // { playerId: { goles, asistencias, amarilla, roja } }
  const [hpStep, setHpStep] = useState(1); // 1=datos, 2=jugadores
  const [nm, setNm] = useState({
    home:"Rómulo FC", away:"", date:"", time:"", cat:"Sub-11", field:"", champId:"", fase:"Normal"
  });
  const [editMid, setEditMid] = useState(null);
  const [confirmDelM, setConfirmDelM] = useState(null);

  // ── DERIVED ────────────────────────────────
  const isAdmin  = role === "admin";
  const can      = perm => isAdmin && user && Array.isArray(user.perms) && user.perms.includes(perm);
  const unread = notifs.filter(n => {
    const uid = user?.playerId ? String(user.playerId) : (user?.id ? String(user.id) : "admin");
    return !n.readBy?.[uid];
  }).length;

  const filtP = players.filter(p => {
    const catOk  = !isAdmin || !user || user.cat === "Todas" || p.cat === user.cat;
    const filt   = catF === "Todas" || p.cat === catF;
    const srch   = !search || (p.nombre + " " + p.apellido).toLowerCase().includes(search.toLowerCase());
    return catOk && filt && srch;
  });



  const filtM = (() => {
    // Inicio de la semana actual (lunes a las 00:00)
    const hoy    = new Date();
    const diaSem = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1; // 0=lun..6=dom
    const lunesActual = new Date(hoy);
    lunesActual.setHours(0,0,0,0);
    lunesActual.setDate(hoy.getDate() - diaSem);

    function parseMatchDate(dateStr) {
      if (!dateStr) return null;
      // Formato ISO "2026-03-21"
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        const [y,mo,d] = dateStr.trim().split("-").map(Number);
        return new Date(y, mo-1, d);
      }
      // Formato "21 Mar 2026" o "21 Mar"
      const MESES = {Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11};
      const parts = dateStr.trim().split(/\s+/);
      if (parts.length >= 2) {
        const dd = parseInt(parts[0]);
        const mm = MESES[parts[1]];
        const yy = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
        if (!isNaN(dd) && mm !== undefined) return new Date(yy, mm, dd);
      }
      return null;
    }

    // Fin de la semana actual (domingo a las 23:59)
    const domingoActual = new Date(lunesActual);
    domingoActual.setDate(lunesActual.getDate() + 6);
    domingoActual.setHours(23,59,59,999);

    return matches
      .filter(m => {
        const catOk = !user || user.cat === "Todas" || m.cat === user.cat;
        const filt  = catF === "Todas" || m.cat === catF;
        if (!catOk || !filt) return false;
        // Ocultar partidos finalizados de semanas anteriores (antes del lunes de esta semana)
        if (m.status === "finalizado") {
          const fd = parseMatchDate(m.date);
          if (fd && fd < lunesActual) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Orden cronológico puro — "en vivo" siempre primero
        if (a.status === "en vivo" && b.status !== "en vivo") return -1;
        if (b.status === "en vivo" && a.status !== "en vivo") return  1;
        const da  = parseMatchDate(a.date);
        const db_ = parseMatchDate(b.date);
        if (da && db_) return da - db_;  // más antiguo primero
        if (da && !db_) return -1;
        if (!da && db_) return 1;
        return 0;
      });
  })();

  const attCount = attSession ? filtP.filter(p => att[p.id] && att[p.id][attSession] && att[p.id][attSession].present).length : 0;
  const attPct   = filtP.length && attSession ? Math.round(attCount / filtP.length * 100) : 0;

  // para: "all" | "cat:Sub-15" | "player:ID"
  function addNotif(txt, link = null, para = "all", tipo = "info") {
    const id = "n_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    if (!isDemo) setDoc(doc(db, "notifs", id), {
      id, txt,
      ts:        new Date().toISOString(),
      link:      link   || "inicio",
      para:      para   || "all",
      tipo:      tipo   || "info",
      creadoPor: user?.name || "Sistema",
      readBy:    {}   // { "playerId": true, "adminId": true }
    });
  }

  // ¿Esta notif es para el usuario actual?
  function notifEsPara(n) {
    if (!n.para || n.para === "all") return true;
    if (n.para.startsWith("cat:")) {
      const cat = n.para.replace("cat:","");
      return user?.cat === cat || user?.cat === "Todas";
    }
    if (n.para.startsWith("player:")) {
      const pid = n.para.replace("player:","");
      return String(user?.playerId) === pid ||
             (user?.playerIds||[]).map(String).includes(pid);
    }
    return false;
  }

  // ID único del usuario actual (para marcar leídas)
  function myUID() {
    if (isAdmin) return "admin_" + (user?.id || "dt");
    return String(user?.playerId || "visitor");
  }

  // Marcar notif como leída para el usuario actual
  function markNotifRead(nid) {
    if (isDemo) return;
    const uid = myUID();
    updateDoc(doc(db, "notifs", nid), { [`readBy.${uid}`]: true });
  }

  // Marcar todas como leídas
  function markAllRead(lista) {
    if (isDemo) return;
    const uid = myUID();
    lista.forEach(n => {
      if (!n.readBy?.[uid]) updateDoc(doc(db,"notifs",n.id), { [`readBy.${uid}`]: true });
    });
  }

  // ── DEMO SAFE WRAPPERS ─────────────────────
  function safeSetDoc(ref, data) {
    if (isDemo) return Promise.resolve();
    return setDoc(ref, data);
  }
  function safeDeleteDoc(ref) {
    if (isDemo) return Promise.resolve();
    return deleteDoc(ref);
  }

  // ── Reset attSession si el entreno fue eliminado ──
  useEffect(() => {
    if (attSession && trainings.length > 0) {
      const existe = trainings.find(t => t.id === attSession);
      if (!existe) setAttSession(null);
    }
  }, [trainings, attSession]);

  // ── ACTIONS ────────────────────────────────
  function toggleAtt(pid) {
    if (!isAdmin || !attSession) return;
    const current = att[pid]?.[attSession]?.present || false;
    const nowPresent = !current;
    const updated = { ...(att[pid]||{}), [attSession]: { present: nowPresent } };
    safeSetDoc(doc(db, "att", String(pid)), updated);
    // Disparar encuesta si se marcó presente
    if (nowPresent) {
      const pl = players.find(x=>x.id===pid);
      setSurveyTarget({ pid, nombre: pl?.nombre || "", session: attSession });
    }
  }

  function toggleMonth(pid, m) {
    if (!can("pagos")) return;
    const already = pay[pid] && pay[pid].months[m] && pay[pid].months[m].paid;
    if (already) {
      // Reversión directa con confirmación
      setConf({
        title: "REVERTIR PAGO",
        msg: "¿Marcar " + m + " como pendiente?",
        danger: true,
        ok: () => {
          const date = new Date().toLocaleDateString("es");
          const updated = {
            ...pay[pid],
            months: { ...pay[pid].months, [m]: { paid: false, date: null, ref: null, monto: null, metodo: null } },
            history: [...(pay[pid].history||[]), { action: "Reversión", item: m, date }]
          };
          safeSetDoc(doc(db, "pay", String(pid)), updated);
        }
      });
    } else {
      // Abrir modal de registro
      setPayModal({ pid, mes: m });
      setPayRef(""); setPayMonto(""); setPayMetodo("Transferencia"); setPayErr("");
    }
  }

  function generateReceipt(p, mes, refNum, monto, metodo, fecha, entrenador) {
    // Generar PDF con jsPDF
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const W = 210, pad = 18;

      // Fondo blanco puro
      doc.setFillColor(255,255,255);
      doc.rect(0, 0, W, 297, "F");

      // Franja superior azul
      doc.setFillColor(21, 101, 192);
      doc.rect(0, 0, W, 38, "F");

      // Acento rojo lateral
      doc.setFillColor(183, 28, 28);
      doc.rect(0, 0, 6, 38, "F");

      // Logo / nombre del club
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.text("RÓMULO F.C", pad, 18);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text("Academia de Fútbol Sala  ·  Temporada 2026", pad, 26);
      doc.text("Caracas, Venezuela", pad, 32);

      // Título comprobante
      doc.setFillColor(245, 247, 250);
      doc.rect(0, 38, W, 22, "F");
      doc.setTextColor(21, 101, 192);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("COMPROBANTE DE PAGO — MENSUALIDAD", W/2, 51, { align:"center" });
      doc.setFontSize(9);
      doc.setTextColor(100, 120, 150);
      doc.text("Documento generado automáticamente por el sistema Rómulo FC", W/2, 57, { align:"center" });

      // Número de referencia destacado
      doc.setFillColor(21, 101, 192);
      doc.roundedRect(pad, 68, W - pad*2, 16, 3, 3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("N° REFERENCIA: " + refNum, W/2, 78, { align:"center" });

      // Sección: datos del pago
      let y = 96;
      const col1 = pad, col2 = W/2 + 4;
      const rowH = 11;

      function secTitle(title, yy) {
        doc.setFillColor(236, 242, 250);
        doc.rect(pad, yy, W - pad*2, 8, "F");
        doc.setTextColor(21, 101, 192);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(title.toUpperCase(), pad + 3, yy + 5.5);
        return yy + 11;
      }

      function field(label, value, x, yy, full) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 140, 165);
        doc.text(label, x, yy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 40, 60);
        doc.text(String(value || "—"), x, yy + 5);
      }

      // Bloque: Detalle del pago
      y = secTitle("Detalle del Pago", y);
      field("Mes pagado",   mes,    col1, y); field("Monto (Bs.)",  monto || "—", col2, y); y += rowH;
      field("Método",       metodo, col1, y); field("Fecha de pago", fecha,       col2, y); y += rowH;
      field("Referencia",   refNum, col1, y); y += rowH + 2;

      // Línea divisoria
      doc.setDrawColor(220, 228, 240);
      doc.setLineWidth(0.3);
      doc.line(pad, y, W - pad, y); y += 8;

      // Bloque: Datos del jugador
      y = secTitle("Datos del Jugador", y);
      field("Nombre completo", p.nombre + " " + p.apellido, col1, y);
      field("Cédula",          p.cedula,                    col2, y); y += rowH;
      field("Categoría",       p.cat,                       col1, y);
      field("N° Camiseta",     "#" + p.num,                 col2, y); y += rowH + 2;

      doc.line(pad, y, W - pad, y); y += 8;

      // Bloque: Datos del representante
      y = secTitle("Datos del Representante", y);
      field("Nombre completo", p.repNombre + " " + p.repApellido, col1, y);
      field("Cédula",          p.repCedula,                       col2, y); y += rowH;
      field("Teléfono",        p.repTel,                          col1, y); y += rowH + 2;

      doc.line(pad, y, W - pad, y); y += 8;

      // Bloque: Registrado por
      y = secTitle("Registrado por", y);
      field("Entrenador / Admin", entrenador, col1, y);
      field("Fecha de emisión",   fecha,      col2, y); y += rowH + 6;

      // Firma
      doc.setDrawColor(21, 101, 192);
      doc.setLineWidth(0.5);
      doc.line(pad, y, pad + 60, y);
      doc.setTextColor(100, 120, 150);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Firma / Sello del Club", pad, y + 5);

      // QR placeholder visual
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(W - pad - 30, y - 20, 30, 30, 2, 2, "F");
      doc.setDrawColor(200, 210, 225);
      doc.setLineWidth(0.3);
      doc.roundedRect(W - pad - 30, y - 20, 30, 30, 2, 2, "S");
      doc.setTextColor(150, 165, 185);
      doc.setFontSize(6);
      doc.text("Ref: " + refNum, W - pad - 15, y - 4, { align:"center" });

      // Pie de página
      doc.setFillColor(21, 101, 192);
      doc.rect(0, 282, W, 15, "F");
      doc.setFillColor(183, 28, 28);
      doc.rect(0, 282, 6, 15, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Rómulo F.C  ·  Academia de Fútbol Sala  ·  Caracas, Venezuela", W/2, 291, { align:"center" });
      doc.text("Este comprobante es válido como recibo de pago oficial.", W/2, 295, { align:"center" });

      doc.save("Comprobante_" + p.nombre + "_" + p.apellido + "_" + mes + "_" + refNum + ".pdf");
    };
    document.head.appendChild(script);
  }

  function generatePermisoEscolar(p) {
    const myTrains = trainings.filter(t => t.cats.includes(p.cat));
    const diasStr  = myTrains.length
      ? myTrains.map(t => `${t.dia} a las ${t.hora} en ${t.lugar}`).join(", ")
      : "días a confirmar";
    const hoy   = new Date().toLocaleDateString("es-VE", { day:"numeric", month:"long", year:"numeric" });
    const dir   = clubConfig.directora  || "Directora de la Academia";
    const dirCI = clubConfig.directoraCedula || "—";

    const script = document.createElement("script");
    script.src   = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const W = 210, pad = 22;

      // ── Fondo ──
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, W, 297, "F");

      // ── Franja superior azul ──
      doc.setFillColor(21, 101, 192);
      doc.rect(0, 0, W, 42, "F");
      doc.setFillColor(183, 28, 28);
      doc.rect(0, 0, 7, 42, "F");

      // Nombre club
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.text("RÓMULO F.C", pad, 17);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Academia de Fútbol Sala  ·  Temporada " + clubConfig.temporada, pad, 25);
      doc.text(clubConfig.ciudad + ", Venezuela  ·  " + clubConfig.tel, pad, 31);

      // Fecha arriba derecha
      doc.setFontSize(8);
      doc.setTextColor(200, 220, 255);
      doc.text(clubConfig.ciudad + ", " + hoy, W - pad, 37, { align:"right" });

      // ── Título del documento ──
      doc.setFillColor(245, 247, 252);
      doc.rect(0, 42, W, 20, "F");
      doc.setTextColor(21, 101, 192);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("SOLICITUD DE PERMISO DE SALIDA TEMPRANA", W/2, 53, { align:"center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 120, 150);
      doc.text("Comunicado oficial dirigido a la Institución Educativa", W/2, 59, { align:"center" });

      // ── Destinatario ──
      let y = 74;
      doc.setTextColor(30, 40, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Ciudadano(a):", pad, y); y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Director(a) / Coordinador(a) de la Institución Educativa", pad, y); y += 5;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(100, 120, 150);
      doc.text("Presente.-", pad, y); y += 12;

      // ── Cuerpo del comunicado ──
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 40, 60);

      const nombreCompleto  = `${p.nombre} ${p.apellido}`;
      const cedulaJugador   = p.cedula || "—";
      const repCompleto     = `${p.repNombre} ${p.repApellido}`;
      const cedulaRep       = p.repCedula || "—";
      const cat             = p.cat;

      // Párrafo 1
      const p1 = doc.splitTextToSize(
        `Por medio de la presente, nosotros, los directivos de la Academia de Fútbol Sala ` +
        `${clubConfig.nombre}, con sede en ${clubConfig.ciudad}, Venezuela, nos dirigimos ` +
        `a usted de la manera más respetuosa para solicitarle su valioso apoyo en beneficio ` +
        `del desarrollo deportivo de uno de nuestros atletas.`,
        W - pad * 2
      );
      doc.text(p1, pad, y); y += p1.length * 5.5 + 6;

      // Párrafo 2 — datos del jugador
      const p2 = doc.splitTextToSize(
        `El joven ${nombreCompleto}, titular de la Cédula de Identidad N° ${cedulaJugador}, ` +
        `representado por el ciudadano(a) ${repCompleto}, C.I. N° ${cedulaRep}, ` +
        `forma parte activa de nuestra academia en la categoría ${cat}, ` +
        `participando de manera comprometida y disciplinada en nuestro programa de formación deportiva.`,
        W - pad * 2
      );
      doc.text(p2, pad, y); y += p2.length * 5.5 + 6;

      // Párrafo 3 — solicitud
      const diasFormateados = myTrains.length
        ? myTrains.map(t => `${t.dia} (${t.hora})`).join(", ")
        : "los días de entrenamiento establecidos";
      const p3 = doc.splitTextToSize(
        `En este sentido, solicitamos comedidamente se le conceda al estudiante antes mencionado ` +
        `permiso para retirarse de la institución de manera anticipada los días de entrenamiento, ` +
        `específicamente los ${diasFormateados}, a fin de que pueda asistir puntualmente ` +
        `a las sesiones de entrenamiento programadas.`,
        W - pad * 2
      );
      doc.text(p3, pad, y); y += p3.length * 5.5 + 6;

      // Párrafo 4 — cierre
      const p4 = doc.splitTextToSize(
        `Agradecemos de antemano su comprensión y apoyo a la formación deportiva y personal de ` +
        `nuestros jóvenes atletas. Estamos seguros de que instituciones como la suya comparten ` +
        `el compromiso de ofrecer oportunidades integrales de desarrollo a la juventud venezolana.`,
        W - pad * 2
      );
      doc.text(p4, pad, y); y += p4.length * 5.5 + 6;

      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      doc.text("Sin otro particular al cual hacer referencia, se despide atentamente,", pad, y); y += 14;

      // ── Datos del jugador — recuadro ──
      doc.setFillColor(236, 242, 252);
      doc.roundedRect(pad, y, W - pad * 2, 28, 3, 3, "F");
      doc.setDrawColor(180, 200, 230);
      doc.setLineWidth(0.3);
      doc.roundedRect(pad, y, W - pad * 2, 28, 3, 3, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(21, 101, 192);
      doc.text("DATOS DEL ATLETA", pad + 4, y + 7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(30, 40, 60);
      const col1 = pad + 4, col2 = W/2 + 4;
      doc.text(`Nombre: ${nombreCompleto}`,  col1,  y + 13);
      doc.text(`Cédula: ${cedulaJugador}`,    col2,  y + 13);
      doc.text(`Categoría: ${cat}`,           col1,  y + 19);
      doc.text(`Representante: ${repCompleto}`, col1, y + 25);
      doc.text(`C.I. Rep: ${cedulaRep}`,      col2,  y + 25);
      y += 36;

      // ── Firma directora ──
      doc.setDrawColor(21, 101, 192);
      doc.setLineWidth(0.6);
      doc.line(pad, y + 14, pad + 70, y + 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 40, 60);
      doc.text(dir, pad, y + 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 120, 150);
      doc.text("Directora de la Academia · C.I. " + dirCI, pad, y + 26);
      doc.text(clubConfig.nombre, pad, y + 32);

      // Sello circular decorativo
      doc.setDrawColor(21, 101, 192);
      doc.setLineWidth(0.8);
      doc.circle(W - pad - 18, y + 18, 18, "S");
      doc.setDrawColor(183, 28, 28);
      doc.setLineWidth(0.4);
      doc.circle(W - pad - 18, y + 18, 15, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(21, 101, 192);
      doc.text("RÓMULO F.C", W - pad - 18, y + 16, { align:"center" });
      doc.text("ACADEMIA", W - pad - 18, y + 20, { align:"center" });
      doc.text("FÚTBOL SALA", W - pad - 18, y + 24, { align:"center" });

      // ── Pie de página ──
      doc.setFillColor(21, 101, 192);
      doc.rect(0, 282, W, 15, "F");
      doc.setFillColor(183, 28, 28);
      doc.rect(0, 282, 7, 15, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(`${clubConfig.nombre}  ·  Academia de Fútbol Sala  ·  ${clubConfig.ciudad}, Venezuela`, W/2, 290, { align:"center" });
      doc.text("Documento oficial generado por el sistema de gestión Rómulo FC", W/2, 294, { align:"center" });

      doc.save(`Permiso_Escolar_${p.nombre}_${p.apellido}_${cat}.pdf`);
    };
    document.head.appendChild(script);
  }

  function exportPaymentsPDF(mesTarget) {
    const mes  = mesTarget || new Date().toLocaleString("es",{month:"long"}).replace(/^\w/,c=>c.toUpperCase());
    const lista = players.filter(p => user.cat === "Todas" || p.cat === user.cat);
    const pagados   = lista.filter(p => pay[p.id]?.months?.[mes]?.paid);
    const pendientes = lista.filter(p => !pay[p.id]?.months?.[mes]?.paid);
    const totalBs   = pagados.reduce((s,p) => s + (parseFloat(pay[p.id]?.months?.[mes]?.monto)||0), 0);
    const hoy = new Date().toLocaleDateString("es-VE",{day:"numeric",month:"long",year:"numeric"});

    const script = document.createElement("script");
    script.src   = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const W = 210, pad = 18;

      // Header
      doc.setFillColor(21,101,192); doc.rect(0,0,W,38,"F");
      doc.setFillColor(183,28,28);  doc.rect(0,0,7,38,"F");
      doc.setTextColor(255,255,255);
      doc.setFont("helvetica","bold"); doc.setFontSize(22);
      doc.text("RÓMULO F.C", pad, 14);
      doc.setFont("helvetica","normal"); doc.setFontSize(9);
      doc.text("Reporte de Pagos — " + mes + " " + clubConfig.temporada, pad, 22);
      doc.text("Generado el " + hoy + "  ·  " + user.name, pad, 28);

      // Resumen
      doc.setFillColor(240,244,251); doc.rect(0,38,W,18,"F");
      doc.setTextColor(21,101,192); doc.setFont("helvetica","bold"); doc.setFontSize(10);
      const col = (W-2*pad)/3;
      doc.text("PAGARON: " + pagados.length,   pad,              50);
      doc.text("PENDIENTES: " + pendientes.length, pad+col,      50);
      doc.text("RECAUDADO: Bs. " + totalBs.toFixed(2), pad+col*2, 50);

      let y = 64;
      const drawSection = (title, arr, color) => {
        doc.setFillColor(...color); doc.rect(pad,y,W-2*pad,7,"F");
        doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8);
        doc.text(title + " (" + arr.length + ")", pad+2, y+5);
        y += 9;
        arr.forEach(p => {
          if (y > 270) { doc.addPage(); y = 20; }
          const info = pay[p.id]?.months?.[mes];
          doc.setTextColor(30,40,60); doc.setFont("helvetica","normal"); doc.setFontSize(9);
          doc.text(p.nombre + " " + p.apellido, pad+2, y);
          doc.setTextColor(100,120,150); doc.setFontSize(8);
          doc.text(p.cat + "  ·  CI: " + (p.cedula||"—"), pad+2, y+4);
          if (info?.paid) {
            doc.setTextColor(21,101,192);
            doc.text(info.montoMostrado||("Bs. "+info.monto), W-pad-2, y, {align:"right"});
            doc.setTextColor(100,120,150); doc.setFontSize(7.5);
            doc.text(info.metodo + "  Ref: " + info.ref, W-pad-2, y+4, {align:"right"});
          }
          doc.setDrawColor(220,228,240); doc.setLineWidth(0.2);
          doc.line(pad, y+7, W-pad, y+7);
          y += 10;
        });
        y += 4;
      };
      drawSection("✅ PAGOS CONFIRMADOS", pagados,    [21,101,192]);
      drawSection("❌ PAGOS PENDIENTES",  pendientes, [183,28,28]);

      // Pie
      doc.setFillColor(21,101,192); doc.rect(0,282,W,15,"F");
      doc.setFillColor(183,28,28);  doc.rect(0,282,7,15,"F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
      doc.text("Rómulo F.C  ·  Academia de Fútbol Sala  ·  " + clubConfig.ciudad, W/2, 290, {align:"center"});
      doc.text("Reporte oficial generado por el sistema de gestión Rómulo FC", W/2, 294, {align:"center"});

      doc.save("Pagos_" + mes + "_" + clubConfig.temporada + ".pdf");
    };
    document.head.appendChild(script);
  }

  function confirmPayMonth() {
    const esDivisa   = ["Efectivo USD","Zelle","Binance"].includes(payMetodo);
    const esEfectivo = ["Efectivo Bs.","Efectivo USD"].includes(payMetodo);
    const tasa       = parseFloat(tasaCambio) || 1;

    if (!esEfectivo && !payRef.trim()) { setPayErr("La referencia es obligatoria"); return; }
    if (!payMonto || isNaN(parseFloat(payMonto)) || parseFloat(payMonto) <= 0) {
      setPayErr("Ingresa un monto válido"); return;
    }

    const { pid, mes } = payModal;
    const date          = new Date().toLocaleDateString("es");
    const ref           = esEfectivo ? "EFECTIVO" : payRef.trim().toUpperCase();
    const montoOriginal = parseFloat(payMonto);
    const montoBs       = esDivisa ? parseFloat((montoOriginal * tasa).toFixed(2)) : parseFloat(montoOriginal.toFixed(2));
    const montoMostrado = esDivisa ? `$${montoOriginal.toFixed(2)} (Bs. ${montoBs.toFixed(2)})` : `Bs. ${montoBs.toFixed(2)}`;
    const p             = players.find(x => x.id === pid);

    const updated = {
      ...(pay[pid]||{}),
      months: { ...(pay[pid]?.months||{}), [mes]: {
        paid: true, date, ref,
        monto: montoBs, montoMostrado,
        montoOriginal: esDivisa ? montoOriginal : null,
        divisa: esDivisa ? "USD" : "Bs.",
        tasa: esDivisa ? tasa : null,
        metodo: payMetodo,
        foto: payFoto || null
      }},
      history: [...(pay[pid]?.history||[]), {
        action:"Pago", item:mes, date, ref,
        monto: montoBs, montoMostrado, metodo: payMetodo
      }]
    };
    safeSetDoc(doc(db, "pay", String(pid)), updated);

    generateReceipt(p, mes, ref, montoMostrado, payMetodo, date, user?.name || "Administrador");
    setPayFoto(null);
    setPayModal(null);
  }

  function toggleChamp(pid, champId) {
    if (!can("pagos")) return;
    const date    = new Date().toLocaleDateString("es");
    const nowPaid = !(pay[pid] && pay[pid].championships && pay[pid].championships[champId] && pay[pid].championships[champId].paid);
    const updated = {
      ...pay[pid],
      championships: { ...(pay[pid]?.championships||{}), [champId]: { paid: nowPaid, date: nowPaid ? date : null } },
      history: [...(pay[pid]?.history||[]), { action: nowPaid ? "Pago Camp." : "Rev. Camp.", date }]
    };
    safeSetDoc(doc(db, "pay", String(pid)), updated);
  }

  function parseCSV(text) {
    const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { error: "El archivo debe tener encabezado y al menos 1 jugador" };
    const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/[^a-záéíóúñ]/gi,""));
    const required = ["nombre","apellido","cedula","fechanacimiento","categoria"];
    const missing = required.filter(r => !headers.some(h => h.includes(r.slice(0,5))));
    if (missing.length) return { error: "Faltan columnas: " + missing.join(", ") };
    const idx = (key) => headers.findIndex(h => h.includes(key.slice(0,5)));
    const players = [];
    for (let i=1; i<lines.length; i++) {
      const cols = lines[i].split(/[,;]/).map(c => c.trim().replace(/^"|"$/g,""));
      const cat = cols[idx("categoria")] || "Sub-11";
      const validCat = CATS.find(c => c.toLowerCase().replace("-","") === cat.toLowerCase().replace("-","")) || "Sub-11";
      players.push({
        nombre: cols[idx("nombre")] || "",
        apellido: cols[idx("apellido")] || "",
        cedula: cols[idx("cedula")] || "",
        dob: cols[idx("fecha")] || "",
        cat: validCat,
        tel: cols[idx("tel")] || "",
        num: cols[idx("num")] || cols[idx("dors")] || "",
        repNombre: cols[idx("repnombre")] || cols[idx("repre")] || "",
        repApellido: cols[idx("repapell")] || "",
        repCedula: cols[idx("repced")] || "",
        repTel: cols[idx("reptel")] || "",
        notas: cols[idx("nota")] || ""
      });
    }
    return { players };
  }

  async function importCSVPlayers() {
    setCsvImporting(true);
    for (const p of csvPreview) {
      if (!p.nombre || !p.apellido) continue;
      const id = String(Date.now() + Math.random());
      const player = { ...p, id, num: parseInt(p.num)||0, col: CAT_COLOR[p.cat]||"#1565C0" };
      await safeSetDoc(doc(db,"players",id), player);
      await safeSetDoc(doc(db,"pay",id), { months:MONTHS.reduce((a,m)=>({...a,[m]:{paid:false,date:null}}),{}), championships:{}, arbitraje:[], history:[] });
      await safeSetDoc(doc(db,"sanc",id), { yellows:0, reds:0, suspended:false, history:[] });
      await safeSetDoc(doc(db,"att",id), {});
    }
    setCsvImporting(false);
    setShowCsvImport(false);
    setCsvPreview([]);
    addNotif("✅ " + csvPreview.length + " jugadores importados", "jugadores", "all", "info");
  }

  function savePlayer() {
    if (!np.nombre || !np.apellido || !np.cedula || !np.dob) { setFormErr("Nombre, apellido, cédula y fecha son obligatorios"); return; }
    if (!np.repCedula) { setFormErr("La cédula del representante es obligatoria"); return; }
    if (editPid) {
      const ref = doc(db, "players", String(editPid));
      const data = { ...np, num: parseInt(np.num)||0, col: CAT_COLOR[np.cat]||"#1565C0" };
      safeSetDoc(ref, data);
      addNotif("✏️ Jugador actualizado: " + np.nombre + " " + np.apellido, "jugadores", "player:"+np.id, "info");
      setAddOk(true); setFormErr("");
      setTimeout(() => { setAddOk(false); setShowAdd(false); setEditPid(null); setNp(NP_BLANK); }, 1500);
    } else {
      const id = String(Date.now());
      const p  = { ...np, id, num: parseInt(np.num)||players.length+1, col: CAT_COLOR[np.cat]||"#1565C0" };
      safeSetDoc(doc(db, "players", id), p);
      const initP = { months: MONTHS.reduce((a,m) => ({ ...a,[m]:{ paid:false,date:null } }),{}), championships:{}, arbitraje:[], history:[] };
      safeSetDoc(doc(db, "pay",  id), initP);
      safeSetDoc(doc(db, "sanc", id), { yellows:0, reds:0, suspended:false, history:[] });
      safeSetDoc(doc(db, "att",  id), {});
      addNotif("👤 Nuevo jugador: " + np.nombre + " " + np.apellido + " (" + np.cat + ")", "jugadores", "cat:"+np.cat, "info");
      setAddOk(true); setFormErr("");
      setNewPlayerWA({ nombre: np.nombre, apellido: np.apellido, cedula: np.cedula, tel: np.tel, repNombre: np.repNombre, repApellido: np.repApellido, repCedula: np.repCedula, repTel: np.repTel });
      setNp(NP_BLANK);
      setTimeout(() => { setAddOk(false); setShowAdd(false); }, 2000);
    }
  }

  function saveMatch() {
    if (!nm.away || !nm.date || !nm.time || !nm.field) { setFormErr("Completa todos los campos"); return; }
    if (editMid) {
      safeSetDoc(doc(db, "matches", editMid), { ...nm });
      addNotif("🔄 Partido reprogramado: " + nm.home + " vs " + nm.away + " · " + nm.date, "calendario", "cat:"+nm.cat, "partido");
      setEditMid(null);
    } else {
      const id = String(Date.now());
      const m  = { ...nm, id, scoreH:null, scoreA:null, status:"próximo" };
      safeSetDoc(doc(db, "matches", id), m);
      addNotif("📅 Partido: " + nm.home + " vs " + nm.away + " · " + nm.date, "calendario", "cat:"+nm.cat, "partido");
    }
    setNm({ home:"Rómulo FC", away:"", date:"", time:"", cat:"Sub-11", field:"", champId:"", fase:"Normal" });
    setShowMForm(false); setFormErr("");
  }

  function buildListMsg() {
    const pl = players.filter(p => listCat === "Todas" || p.cat === listCat);
    let msg = "";
    if (listType === "pendientes") {
      msg = "❌ RÓMULO F.C — Pagos Pendientes\n" + new Date().toLocaleDateString("es") + "\n\n";
      pl.forEach(p => {
        const pend = ACTIVE_MONTHS.filter(m => !pay[p.id]?.months[m]?.paid && !pay[p.id]?.months[m]?.exento);
        if (pend.length) msg += "❌ " + p.nombre + " " + p.apellido + " (" + p.cat + "): " + pend.join(", ") + "\n";
      });
    } else if (listType === "pagados") {
      msg = "✅ RÓMULO F.C — Al Día\n" + new Date().toLocaleDateString("es") + "\n\n";
      pl.forEach(p => {
        if (ACTIVE_MONTHS.every(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid)) {
          msg += "✅ " + p.nombre + " " + p.apellido + " (" + p.cat + ")\n";
        }
      });
    } else {
      msg = "📋 RÓMULO F.C — Estado Completo\n" + new Date().toLocaleDateString("es") + "\n\n";
      pl.forEach(p => {
        const pend = ACTIVE_MONTHS.filter(m => !pay[p.id]?.months[m]?.paid && !pay[p.id]?.months[m]?.exento);
        msg += (pend.length ? "❌ " : "✅ ") + p.nombre + " " + p.apellido + " (" + p.cat + ")" +
               (pend.length ? ": " + pend.join(", ") : ": Al día") + "\n";
      });
    }
    return msg;
  }

  // ── NOTIFICACIONES PUSH ────────────────────
  async function requestNotifPermission(coachId) {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const token = await getToken(messaging, { vapidKey: VAPID_KEY });
      if (token && coachId) {
        await safeSetDoc(doc(db, "fcm_tokens", String(coachId)), {
          token, coachId: String(coachId), updatedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn("FCM token error:", e);
    }
  }

  // Escuchar notificaciones cuando la app está en PRIMER PLANO
  useEffect(() => {
    const unsub = onMessage(messaging, payload => {
      const { title, body } = payload.notification || {};
      addNotif((title ? title + ": " : "") + (body || ""), "calendario");
    });
    return unsub;
  }, []);

  function doLogin() {
    setLerr("");
    if (role === "admin") {
      if (!selCoach) { setLerr("Selecciona un perfil"); return; }
      const c = coaches.find(x => x.id === selCoach);
      if (!c) { setLerr("Perfil no encontrado"); return; }
      if (c.pin !== pin) { setLerr("PIN incorrecto"); return; }
      setUser(c); setLoggedIn(true);
      sessionStorage.setItem("rfc_session", JSON.stringify({ role:"admin", user:c }));
      requestNotifPermission(c.id);
    } else if (role === "player") {
      // Normalizar: quitar prefijos V- E- J- P- y espacios para comparación flexible
      const normCI = v => v ? v.trim().toUpperCase().replace(/\s/g,"").replace(/^[VEJPG]-?/,"") : "";
      const clean = normCI(lid);
      const p = players.find(x => normCI(x.cedula) === clean);
      if (!p) { setLerr("Cédula no registrada"); return; }
      const u = { name: p.nombre + " " + p.apellido, playerId: p.id, cat: p.cat, perms:[] };
      setUser(u); setLoggedIn(true);
      sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u }));
      // Registrar token FCM automáticamente para recibir notificaciones push
      setTimeout(() => registerFCMToken(), 1000);
    } else if (role === "parent") {
      const normCI = v => v ? v.trim().toUpperCase().replace(/\s/g,"").replace(/^[VEJPG]-?/,"") : "";
      const clean = normCI(lid);
      const todos = players.filter(x => normCI(x.repCedula) === clean);
      if (!todos.length) { setLerr("Cédula del representante no registrada"); return; }
      const p = todos[0];
      // Guardar todos los IDs de hijos para que el rep pueda cambiar entre ellos
      const u = {
        name: p.repNombre + " " + p.repApellido,
        playerId: p.id,
        playerIds: todos.map(x => x.id), // todos los hijos
        cat: p.cat,
        perms: []
      };
      setUser(u); setLoggedIn(true);
      sessionStorage.setItem("rfc_session", JSON.stringify({ role:"parent", user:u }));
    }
  }

  function logout() {
    setConf({
      title: "CERRAR SESIÓN", msg: "¿Seguro que quieres salir?",
      ok: () => {
        sessionStorage.removeItem("rfc_session");
        setLoggedIn(false); setRole(null); setUser(null);
        setSelCoach(null); setPin(""); setLid(""); setLstep("role"); setTab("inicio");
      }
    });
  }

  // ── LIVE MATCH ─────────────────────────────
  if (liveM) {
    // Todos los jugadores pueden ser convocados en cualquier partido.
    // Su categoría de registro no cambia — solo se separan sus stats.
    // Primero aparecen los de la categoría del partido, luego el resto ordenados por categoría.
    const CATS_ORDER = ["Sub-11","Sub-13","Sub-15","Sub-17","Sub-19"];
    const myPlayers = [...players].sort((a,b) => {
      const aPropio = a.cat === liveM.cat ? 0 : 1;
      const bPropio = b.cat === liveM.cat ? 0 : 1;
      if (aPropio !== bPropio) return aPropio - bPropio;
      return CATS_ORDER.indexOf(a.cat) - CATS_ORDER.indexOf(b.cat);
    });
    // Si está minimizado, mostramos el admin con banner flotante
    if (liveMMinimized) {
      // Continuar con el renderizado normal del admin (no hacer return aquí)
    } else {
      return (
        <>
          <style>{CSS}</style>
          <LiveMatch
            match={liveM}
            myPlayers={myPlayers}
            sanctions={sanc}
            setSanctions={setSanc}
            minET={champs.find(c => c.id === liveM.champId)?.minET || 5}
            onClose={() => { setLiveM(null); setLiveMMinimized(false); }}
            onMinimize={() => setLiveMMinimized(true)}
          onSave={r => {
            // Guardar resultado en Firebase
            const matchData = { ...liveM, scoreH:r.scoreH, scoreA:r.scoreA, status:"finalizado",
              events: r.events || [], playerStats: r.playerStats || {} };
            safeSetDoc(doc(db,"matches",String(liveM.id)), matchData);

            // ── Actualizar tabla de posiciones automáticamente ──
            if (liveM.champId && liveM.fase === "Normal") {
              const ch = champs.find(c => c.id === liveM.champId);
              if (ch && ch.fase === "grupos") {
                const gH = r.scoreH, gA = r.scoreA;
                const winH = gH > gA, winA = gA > gH, draw = gH === gA;
                const standings = JSON.parse(JSON.stringify(ch.standings || []));

                function upsert(equipo, gf, gc, win, dr) {
                  let row = standings.find(s => s.equipo === equipo);
                  if (!row) {
                    row = { equipo, pj:0, g:0, e:0, p:0, gf:0, gc:0, pts:0, dg:0 };
                    standings.push(row);
                  }
                  row.pj += 1;
                  row.gf += gf; row.gc += gc;
                  if (win)      { row.g += 1; row.pts += 3; }
                  else if (dr)  { row.e += 1; row.pts += 1; }
                  else          { row.p += 1; }
                  row.dg = row.gf - row.gc;
                }

                upsert(liveM.home, gH, gA, winH, draw);
                upsert(liveM.away, gA, gH, winA, draw);
                standings.sort((a,b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
                safeSetDoc(doc(db,"champs",String(liveM.champId)), { ...ch, standings });
              }
            }

            // Actualizar estadísticas acumuladas por jugador — separadas por categoría
            if (r.playerStats) {
              Object.entries(r.playerStats).forEach(([pid, ps]) => {
                const ref = doc(db,"players",String(pid));
                const pl = players.find(x=>x.id===pid);
                if (!pl) return;
                const esPrestamo = pl.cat !== liveM.cat;

                if (!esPrestamo) {
                  // ── Jugó en SU categoría → suma a stats principal (su categoría)
                  const cur = pl.stats || { goles:0, asistencias:0, partidos:0 };
                  safeSetDoc(ref, { ...pl, stats: {
                    goles:       (cur.goles||0)       + (ps.goles||0),
                    asistencias: (cur.asistencias||0) + (ps.asistencias||0),
                    partidos:    (cur.partidos||0)    + 1,
                  }, statsPorCat: pl.statsPorCat || {} });
                } else {
                  // ── Jugó en PRÉSTAMO → suma SOLO a statsPorCat[catDelPartido]
                  // stats (su categoría propia) NO se toca
                  const curPorCat = pl.statsPorCat || {};
                  const curEsaCat = curPorCat[liveM.cat] || { goles:0, asistencias:0, partidos:0 };
                  safeSetDoc(ref, { ...pl,
                    stats: pl.stats || { goles:0, asistencias:0, partidos:0 }, // sin cambios
                    statsPorCat: {
                      ...curPorCat,
                      [liveM.cat]: {
                        goles:       (curEsaCat.goles||0)       + (ps.goles||0),
                        asistencias: (curEsaCat.asistencias||0) + (ps.asistencias||0),
                        partidos:    (curEsaCat.partidos||0)    + 1,
                      }
                    }
                  });
                }
              });
            }
            if (r.arbitraje && r.arbitraje.jugadores) {
              const { rival, date, jugadores } = r.arbitraje;
              jugadores.forEach(({ playerId, paid, amount }) => {
                if (!pay[playerId]) return;
                const entry = { matchId: liveM.id, rival, date, paid, amount };
                const updated = { ...pay[playerId], arbitraje: [...(pay[playerId].arbitraje||[]), entry] };
                safeSetDoc(doc(db,"pay",String(playerId)), updated);
              });
            }

            // ── Asistencia al partido: guardar convocados y titulares ──
            if (r.convocados && r.convocados.length > 0) {
              const matchAttId = "matt_" + liveM.id;
              safeSetDoc(doc(db,"att_matches",matchAttId), {
                matchId: liveM.id,
                date: liveM.date,
                cat: liveM.cat,
                home: liveM.home,
                away: liveM.away,
                convocados: r.convocados || [],
                titulares:  r.titulares  || [],
                mvp: r.mvp || null
              });
            }

            // ── Guardar MVP en el partido ──
            if (r.mvp) {
              const matchData2 = { ...liveM, scoreH:r.scoreH, scoreA:r.scoreA, status:"finalizado",
                events: r.events||[], playerStats: r.playerStats||{},
                mvp: r.mvp };
              safeSetDoc(doc(db,"matches",String(liveM.id)), matchData2);
            }

            // ── Notificación de resultado a la categoría ──
            const res = r.scoreH > r.scoreA ? "VICTORIA" : r.scoreH < r.scoreA ? "DERROTA" : "EMPATE";
            const emojRes = res==="VICTORIA"?"🏆":res==="DERROTA"?"😔":"🤝";
            addNotif(
              emojRes + " " + res + " · " + liveM.home + " " + r.scoreH + "-" + r.scoreA + " " + liveM.away,
              "calendario", "cat:"+liveM.cat, "resultado"
            );

            // ── Guardar resultado final para el resumen post-partido ──
            setLastMatchResult({ match: liveM, r });
            setLiveM(null);
          }}
        />
        {/* ── RESUMEN POST-PARTIDO WhatsApp ── */}
        {lastMatchResult && (() => {
          const { match: lm, r } = lastMatchResult;
          const catPls = players.filter(p => p.cat === lm.cat);
          // Goleadores
          const goleadores = Object.entries(r.playerStats || {})
            .filter(([,ps]) => ps.goles > 0)
            .map(([pid, ps]) => {
              const pl = players.find(x => x.id === pid);
              return pl ? pl.nombre + " " + pl.apellido + " (" + ps.goles + ")" : null;
            }).filter(Boolean);
          // MVP
          const mvpId  = r.mvp?.playerId;
          const mvpPl  = mvpId ? players.find(x => x.id === mvpId) : null;
          // Próximo partido de la categoría
          const proxM  = matches.filter(m => m.status === "próximo" && m.cat === lm.cat)
            .sort((a,b) => a.id - b.id)[0];
          // Armar mensaje
          const esCasa = lm.home === "Rómulo FC" || lm.home?.includes("Rómulo");
          const gRFC   = esCasa ? r.scoreH : r.scoreA;
          const gRiv   = esCasa ? r.scoreA : r.scoreH;
          const res    = gRFC > gRiv ? "✅ VICTORIA" : gRFC < gRiv ? "❌ DERROTA" : "🤝 EMPATE";
          let msg = res + " ⚽\n\n";
          msg += "🔵 " + lm.home + " " + r.scoreH + " – " + r.scoreA + " " + lm.away + "\n";
          msg += "📅 " + lm.date + " · " + lm.cat + "\n";
          if (goleadores.length > 0) msg += "\n⚽ Goleadores: " + goleadores.join(", ");
          if (mvpPl) msg += "\n🏅 MVP: " + mvpPl.nombre + " " + mvpPl.apellido;
          if (proxM) msg += "\n\n📌 Próximo partido: " + proxM.away + " · " + proxM.date + " " + proxM.time;
          msg += "\n\n¡Gracias por el apoyo! 💙 Rómulo F.C";

          return (
            <div className="ov" onClick={e => { if(e.target.className==="ov") setLastMatchResult(null); }}>
              <div className="modal" style={{ borderTop:"3px solid #2196F3" }}>
                <div className="mt2" style={{ color:"#7ab3e0" }}>
                  📲 Resumen del Partido
                  <span className="mx" onClick={() => setLastMatchResult(null)}>✕</span>
                </div>
                <div style={{ fontSize:9, color:"#4e6a88", marginBottom:10 }}>
                  Envía el resumen a representantes y jugadores de {lm.cat}
                </div>
                <div style={{ background:"var(--card)", borderRadius:8, padding:"10px", marginBottom:10,
                  fontSize:9, whiteSpace:"pre-wrap", color:"var(--txt)", border:"1px solid rgba(33,150,243,.1)" }}>
                  {msg}
                </div>
                <div style={{ fontSize:8, color:"#3a5068", marginBottom:6 }}>
                  {catPls.length} contactos en {lm.cat}
                </div>
                <div style={{ display:"flex", gap:7 }}>
                  <button className="btn" style={{ flex:1 }}
                    onClick={() => {
                      catPls.forEach((p, i) => {
                        setTimeout(() => {
                          if (p.tel)    openWA(p.tel,    msg);
                          if (p.repTel) setTimeout(() => openWA(p.repTel, msg), 600);
                        }, i * 1500);
                      });
                    }}>
                    📲 Enviar a todos ({catPls.length})
                  </button>
                  <button className="btn-sm" onClick={() => setLastMatchResult(null)}>Omitir</button>
                </div>
              </div>
            </div>
          );
        })()}
        <ConfirmDialog cfg={conf} onClose={() => setConf(null)} />
      </>
    );
    } // fin if !liveMMinimized
  }

  // ── LOGIN ──────────────────────────────────
  if (!dbReady) {
    return (
      <div style={{ background:"var(--bg)", minHeight:"100vh", display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:16 }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:42, letterSpacing:4 }}>
          <span style={{ color:"#2196F3" }}>RÓMULO</span> <span style={{ color:"#E53935" }}>F.C</span>
        </div>
        <div style={{ fontSize:9, color:"#3a5068", letterSpacing:2, textTransform:"uppercase" }}>Conectando con la base de datos...</div>
        <div style={{ width:40, height:40, border:"3px solid rgba(33,150,243,.15)",
          borderTop:"3px solid #2196F3", borderRadius:"50%",
          animation:"spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <style>{CSS}</style>
        <div className="login">
          <div className="login-logo">
            <span style={{ color:"#2196F3" }}>RÓMULO</span>{" "}
            <span style={{ color:"#E53935" }}>F.C</span>
          </div>
          <div className="login-sub">Sistema de Gestión · Temporada 2026</div>
          {/* Botón demo */}
          <button onClick={() => setLstep("demo")}
            style={{ background:"rgba(212,184,74,.08)", border:"1px solid rgba(212,184,74,.2)", color:"#d4b84a",
              borderRadius:8, padding:"7px 18px", fontSize:9, cursor:"pointer", marginBottom:10,
              textTransform:"uppercase", letterSpacing:1 }}>
            🎮 Ver Demo
          </button>
          <div className="lcard">

            {lstep === "demo" && (() => {
              // Datos demo — solo se cargan cuando se activa el modo demo
              const DEMO_PLAYERS = [
                { id:9001, nombre:"Carlos",   apellido:"Rodríguez", cat:"Sub-15", num:10, tel:"04140000001", repNombre:"Pedro",  repApellido:"Rodríguez", repTel:"04140000002", repCedula:"V-99000001", cedula:"V-88000001", dob:"2010-03-15", foto:null, stats:{ goles:8, asistencias:5, partidos:12 }, subequipo:"A", talla:"M", tipoSangre:"O+", contactoEmergencia:"Pedro Rodríguez 04140000002", eval:{ velocidad:8, tecnica:9, tactica:7, fisico:8, actitud:9, trabajo:9 } },
                { id:9002, nombre:"Andrés",   apellido:"Martínez",  cat:"Sub-13", num:7,  tel:"04140000003", repNombre:"Ana",    repApellido:"Martínez",  repTel:"04140000004", repCedula:"V-99000003", cedula:"V-88000003", dob:"2012-06-22", foto:null, stats:{ goles:4, asistencias:7, partidos:10 }, subequipo:"B", talla:"S", tipoSangre:"A+", contactoEmergencia:"Ana Martínez 04140000004",    eval:{ velocidad:7, tecnica:8, tactica:8, fisico:6, actitud:8, trabajo:9 } },
                { id:9003, nombre:"Luis",     apellido:"García",    cat:"Sub-17", num:1,  tel:"04140000005", repNombre:"María",  repApellido:"García",    repTel:"04140000006", repCedula:"V-99000005", cedula:"V-88000005", dob:"2008-11-08", foto:null, stats:{ goles:0, asistencias:2, partidos:14 }, subequipo:"A", talla:"L", tipoSangre:"B+", contactoEmergencia:"María García 04140000006",   eval:{ velocidad:6, tecnica:7, tactica:9, fisico:9, actitud:7, trabajo:8 } },
                { id:9004, nombre:"Miguel",   apellido:"Torres",    cat:"Sub-15", num:5,  tel:"04140000007", repNombre:"Jorge",  repApellido:"Torres",    repTel:"04140000008", repCedula:"V-99000007", cedula:"V-88000007", dob:"2010-08-20", foto:null, stats:{ goles:5, asistencias:3, partidos:11 }, subequipo:"A", talla:"M", tipoSangre:"AB+", contactoEmergencia:"Jorge Torres 04140000008",  eval:{ velocidad:9, tecnica:7, tactica:6, fisico:9, actitud:8, trabajo:7 } },
                { id:9005, nombre:"Gabriela", apellido:"Vega",      cat:"Sub-11", num:3,  tel:"04140000009", repNombre:"Carmen", repApellido:"Vega",      repTel:"04140000010", repCedula:"V-99000009", cedula:"V-88000009", dob:"2014-01-10", foto:null, stats:{ goles:2, asistencias:4, partidos:8  }, subequipo:"B", talla:"XS", tipoSangre:"O-", contactoEmergencia:"Carmen Vega 04140000010",   eval:{ velocidad:7, tecnica:6, tactica:5, fisico:6, actitud:10, trabajo:9 } },
              ];
              return (
              <>
                <div className="ltitle">🎮 Modo Demo</div>
                <div style={{ fontSize:8.5, color:"#4e6a88", marginBottom:10, textAlign:"center", lineHeight:1.6 }}>
                  Explora todas las funciones de Rómulo F.C con datos de ejemplo.<br/>
                  Los datos demo son ficticios y no afectan la base de datos real.
                </div>
                <div className="rgrid">
                  <div className="ropt" onClick={() => {
                    const u = { id:99, name:"Demo Entrenador", role:"Director Técnico", cat:"Todas",
                      perms:["inicio","jugadores","asistencia","pagos","calendario","entrenamientos","campeonatos","uniformes","chat","stats","entrenadores","config","partido"] };
                    setUser(u); setRole("admin"); setLoggedIn(true); setIsDemo(true);
                    sessionStorage.setItem("rfc_session", JSON.stringify({ role:"admin", user:u, isDemo:true }));
                  }}>
                    <div className="ro-ico">🧑‍💼</div>
                    <div className="ro-lbl">Entrenador</div>
                    <div className="ro-sub">Panel admin completo</div>
                  </div>
                  <div className="ropt" onClick={() => {
                    const demoP = DEMO_PLAYERS[0];
                    const u = { name:demoP.nombre+" "+demoP.apellido, playerId:demoP.id, cat:demoP.cat,
                      role:"Jugador Demo", perms:[] };
                    setUser(u); setRole("player"); setLoggedIn(true); setIsDemo(true);
                    sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u, isDemo:true }));
                  }}>
                    <div className="ro-ico">⚽</div>
                    <div className="ro-lbl">Jugador</div>
                    <div className="ro-sub">Vista del jugador</div>
                  </div>
                  <div className="ropt" onClick={() => {
                    const demoP = DEMO_PLAYERS[1];
                    const u = { name:"Rep. "+demoP.nombre, playerId:demoP.id, cat:demoP.cat,
                      role:"Representante Demo", perms:[], repMode:true };
                    setUser(u); setRole("player"); setLoggedIn(true); setIsDemo(true);
                    sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u, isDemo:true }));
                  }}>
                    <div className="ro-ico">👨‍👦</div>
                    <div className="ro-lbl">Representante</div>
                    <div className="ro-sub">Vista del representante</div>
                  </div>
                  <div className="ropt" onClick={() => {
                    const u = { name:"Visitante Demo", playerId:null, cat:"Todas", perms:[] };
                    setUser(u); setRole("player"); setLoggedIn(true); setIsDemo(true);
                    sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u, isDemo:true }));
                  }}>
                    <div className="ro-ico">👁️</div>
                    <div className="ro-lbl">Visitante</div>
                    <div className="ro-sub">Vista pública</div>
                  </div>
                </div>
                <button className="btn-sm" style={{ width:"100%", marginTop:8, textAlign:"center" }}
                  onClick={()=>setLstep("role")}>← Volver</button>
              </>
              );
            })()}

            {lstep === "role" && (
              <>
                <div className="ltitle">¿Quién eres?</div>
                <div className="rgrid">
                  <div className="ropt" onClick={() => { setRole("admin");  setLstep("who"); }}>
                    <div className="ro-ico">🧑‍💼</div>
                    <div className="ro-lbl">Entrenador</div>
                    <div className="ro-sub">Acceso admin</div>
                  </div>
                  <div className="ropt" onClick={() => { setRole("player"); setLstep("pin_p"); }}>
                    <div className="ro-ico">⚽</div>
                    <div className="ro-lbl">Jugador</div>
                    <div className="ro-sub">Ver mi info</div>
                  </div>
                  <div className="ropt" onClick={() => { setRole("parent"); setLstep("pin_r"); }}>
                    <div className="ro-ico">👨‍👦</div>
                    <div className="ro-lbl">Representante</div>
                    <div className="ro-sub">Ver representado</div>
                  </div>
                  <div className="ropt" onClick={() => {
                    const u = { name:"Visitante", playerId:null, cat:"Todas", perms:[] };
                    setUser(u); setRole("player"); setLoggedIn(true);
                    sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u }));
                  }}>
                    <div className="ro-ico">👁️</div>
                    <div className="ro-lbl">Visitante</div>
                    <div className="ro-sub">Solo lectura</div>
                  </div>
                </div>
              </>
            )}

            {lstep === "who" && (
              <>
                <div className="ltitle">Selecciona tu perfil</div>
                <div className="clist">
                  {coaches.map(c => (
                    <div key={c.id} className={"citem" + (selCoach === c.id ? " csel" : "")} onClick={() => setSelCoach(c.id)}>
                      <span style={{ fontWeight:600 }}>{c.name}</span>
                      <span className="ci-role">{c.role}</span>
                    </div>
                  ))}
                </div>
                <input className="linp" type="password" placeholder="PIN de 4 dígitos"
                  value={pin} onChange={e => setPin(e.target.value)} maxLength={4}
                  onKeyDown={e => e.key === "Enter" && doLogin()}
                />
                <button className="lbtn" onClick={doLogin}>INGRESAR</button>
                {lerr && <div className="lerr">⚠️ {lerr}</div>}
                <div className="back" onClick={() => { setLstep("role"); setLerr(""); }}>← Volver</div>
              </>
            )}

            {lstep === "pin_p" && (
              <>
                <div className="ltitle">Acceso Jugador</div>
                <p style={{ fontSize:9, color:"#4e6a88", marginBottom:8 }}>Ingresa tu cédula de identidad:</p>
                <input className="linp" placeholder="Ej: V-28100001"
                  value={lid} onChange={e => setLid(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doLogin()}
                />
                <button className="lbtn" onClick={doLogin}>INGRESAR</button>
                {lerr && <div className="lerr">⚠️ {lerr}</div>}
                <div className="back" onClick={() => { setLstep("role"); setLerr(""); }}>← Volver</div>
              </>
            )}

            {lstep === "pin_r" && (
              <>
                <div className="ltitle">Acceso Representante</div>
                <p style={{ fontSize:9, color:"#4e6a88", marginBottom:8 }}>Ingresa tu cédula de identidad:</p>
                <input className="linp" placeholder="Ej: V-12000001"
                  value={lid} onChange={e => setLid(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doLogin()}
                />
                <button className="lbtn" onClick={doLogin}>INGRESAR</button>
                {lerr && <div className="lerr">⚠️ {lerr}</div>}
                <div className="back" onClick={() => { setLstep("role"); setLerr(""); }}>← Volver</div>
              </>
            )}

          </div>
        </div>
        <ConfirmDialog cfg={conf} onClose={() => setConf(null)} />
      </>
    );
  }

  // ── SPECTATOR (jugador / representante / visitante) ──
  if (!isAdmin) {
    const isVisitor  = !user.playerId;
    const isParent   = role === "parent";
    // Si el representante tiene múltiples hijos, permitir seleccionar cuál ver
    const allChildIds = user.playerIds || (user.playerId ? [user.playerId] : []);
    const activeChildId = (isParent && allChildIds.length > 1)
      ? (selectedChildId || allChildIds[0])
      : user.playerId;
    const sp        = activeChildId ? players.find(p => p.id === activeChildId) : null;
    const spCat     = sp ? sp.cat : null;

    // Partidos: jugador/rep ven su categoría, visitante ve todos
    const spM       = spCat ? matches.filter(m => m.cat === spCat) : matches;
    // Semana actual para filtrar finalizados viejos
    const _hoyS   = new Date();
    const _diaS   = _hoyS.getDay()===0?6:_hoyS.getDay()-1;
    const _lunesS = new Date(_hoyS); _lunesS.setHours(0,0,0,0); _lunesS.setDate(_hoyS.getDate()-_diaS);
    function _pmd(ds){ if(!ds)return null; if(/^\d{4}-\d{2}-\d{2}$/.test(ds.trim())){const[y,mo,d]=ds.trim().split("-").map(Number);return new Date(y,mo-1,d);} const MS={Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11};const ps=ds.trim().split(/\s+/);if(ps.length>=2){const dd=parseInt(ps[0]),mm=MS[ps[1]],yy=ps[2]?parseInt(ps[2]):new Date().getFullYear();if(!isNaN(dd)&&mm!==undefined)return new Date(yy,mm,dd);}return null;}
    const nextM = spM
      .filter(m => m.status === "próximo" || m.status === "en vivo")
      .sort((a,b) => { const da=_pmd(a.date),db=_pmd(b.date); return da&&db?da-db:0; });
    const pastM = spM
      .filter(m => { if(m.status!=="finalizado")return false; const fd=_pmd(m.date); return !fd||fd>=_lunesS; })
      .sort((a,b) => { const da=_pmd(a.date),db=_pmd(b.date); return da&&db?da-db:0; });

    // Campeonatos: jugador/rep ven los de su categoría, visitante ve todos
    const spChamps  = spCat
      ? champs.filter(c => c.activo && (c.cats.length === 0 || c.cats.includes(spCat)))
      : champs.filter(c => c.activo);

    // Entrenamientos de su categoría
    const hoyISOsp  = new Date().toISOString().slice(0,10);
    const spTrains  = spCat
      ? trainings.filter(t => (t.cats||[]).includes(spCat) && t.fecha >= hoyISOsp).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""))
      : [];

    // Pagos del jugador
    const spPay     = sp && pay[sp.id] ? pay[sp.id] : null;
    const pendMeses = spPay ? ACTIVE_MONTHS.filter(m => !spPay.months[m]?.paid && !spPay.months[m]?.exento) : [];
    const pagMeses  = spPay ? ACTIVE_MONTHS.filter(m => spPay.months[m]?.paid) : [];

    // Sanciones
    const spSanc    = sp && sanc[sp.id] ? sanc[sp.id] : null;

    // Tabs según rol
    const SPEC_TABS = isVisitor
      ? [["inicio","🏠","Inicio"],["agenda","📆","Agenda"],["campeonatos","🏆","Tabla"],["calendario","📅","Partidos"],["stats","📊","Stats"]]
      : [["inicio","🏠","Mi Perfil"],["pagos","💳","Pagos"],["agenda","📆","Agenda"],["campeonatos","🏆","Tabla"],["partidos","📅","Partidos"],["entrenos","🏃","Entrenos"],["torneos","🌍","Torneos"],["chat","💬","Chat"]];

    const roleBadge = isVisitor ? "VISITANTE" : role === "player" ? "JUGADOR" : "REP.";

    // Mini tabla de posiciones reutilizable
    function MiniStandings({ ch }) {
      if (!ch.standings || ch.standings.length === 0)
        return <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"6px 0" }}>Sin datos aún</p>;
      const thS = { fontSize:7, color:"#3a5068", textAlign:"center", padding:"3px 2px", fontWeight:500, textTransform:"uppercase" };
      return (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid rgba(33,150,243,.08)" }}>
                <th style={{ ...thS, textAlign:"left", width:20 }}>#</th>
                <th style={{ ...thS, textAlign:"left" }}>Equipo</th>
                <th style={thS}>PJ</th><th style={thS}>G</th><th style={thS}>E</th><th style={thS}>P</th>
                <th style={thS}>DG</th><th style={{ ...thS, color:"#d4b84a" }}>PTS</th>
              </tr>
            </thead>
            <tbody>
              {ch.standings.map((row, idx) => {
                const isRFC = row.equipo === "Rómulo FC";
                const c1 = isRFC ? "#7ab3e0" : "#afc4d8";
                return (
                  <tr key={row.equipo} style={{ borderBottom:"1px solid rgba(255,255,255,.02)", background: isRFC ? "rgba(21,101,192,.06)" : "transparent" }}>
                    <td style={{ fontSize:8, textAlign:"left", padding:"4px 2px", color:c1 }}>
                      {idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":idx+1}
                    </td>
                    <td style={{ fontSize:9, padding:"4px 3px", color:c1, fontWeight: isRFC?700:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {row.equipo}{isRFC?" ⚽":""}
                    </td>
                    <td style={{ fontSize:9, textAlign:"center", padding:"4px 2px", color:c1 }}>{row.pj}</td>
                    <td style={{ fontSize:9, textAlign:"center", padding:"4px 2px", color:c1 }}>{row.g}</td>
                    <td style={{ fontSize:9, textAlign:"center", padding:"4px 2px", color:c1 }}>{row.e}</td>
                    <td style={{ fontSize:9, textAlign:"center", padding:"4px 2px", color:c1 }}>{row.p}</td>
                    <td style={{ fontSize:9, textAlign:"center", padding:"4px 2px", color:c1 }}>{row.dg>0?"+"+row.dg:row.dg}</td>
                    <td style={{ fontSize:10, textAlign:"center", padding:"4px 2px", fontWeight:700, color: idx===0?"#d4b84a":c1 }}>{row.pts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    function renderSpecContent() {

      // ── INICIO / MI PERFIL ──
      if (tab === "inicio") {
        if (isVisitor) {
          // Visitante: resumen general del club
          const totalJ  = players.length;
          const totalP  = matches.filter(m => m.status==="próximo").length;
          const totalF  = matches.filter(m => m.status==="finalizado").length;
          const totalC  = champs.filter(c => c.activo).length;
          return (
            <>
              <div className="hero" style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:44, letterSpacing:4, lineHeight:1 }}>
                  <span style={{ color:"#2196F3" }}>RÓMULO</span> <span style={{ color:"#E53935" }}>F.C</span>
                </div>
                <div style={{ fontSize:8, color:"#3a5068", letterSpacing:2, textTransform:"uppercase", marginTop:4 }}>Academia de Fútbol Sala · 2026</div>
              </div>
              <div className="sr4" style={{ marginTop:9 }}>
                <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{totalJ}</div><div className="sl">Jugadores</div></div>
                <div className="sb"><div className="sn" style={{ color:"#d4b84a" }}>{CATS.length}</div><div className="sl">Categorías</div></div>
                <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{totalP}</div><div className="sl">Próximos</div></div>
                <div className="sb"><div className="sn" style={{ color:"var(--txt)" }}>{totalF}</div><div className="sl">Jugados</div></div>
              </div>
              <div className="card">
                <div className="ch"><span className="ct">Campeonatos Activos</span><span className="bg bg-y">{totalC}</span></div>
                {champs.filter(c=>c.activo).map(ch => (
                  <div key={ch.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div>
                      <div style={{ fontSize:10, fontWeight:500 }}>{ch.nombre}</div>
                      <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                        {ch.cats.length>0 ? ch.cats.map(c=><span key={c} className="bg bg-b">{c}</span>) : <span className="bg bg-n">Todas</span>}
                      </div>
                    </div>
                    <span className="bg bg-y">🏆</span>
                  </div>
                ))}
                {champs.filter(c=>c.activo).length===0 && <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center" }}>Sin campeonatos activos</p>}
              </div>
              {nextM.slice(0,2).map(m => (
                <div key={m.id}>
                  <div style={{ fontSize:8, color:"#3a5068", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>Próximo partido</div>
                  <MatchCard m={m} champs={champs} />
                </div>
              ))}
            </>
          );
        }

        // Jugador / Representante
        if (!sp) return <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Jugador no encontrado.</p></div>;
        const susp = spSanc?.suspended;
        const yell = spSanc?.yellows || 0;
        const reds = spSanc?.reds    || 0;
        // Asistencia acumulada
        const spTrainsAtt = trainings.filter(t => t.cats.includes(sp.cat));
        const totalSes  = spTrainsAtt.length;
        const asistSes  = spTrainsAtt.filter(t => att[sp.id]?.[t.id]?.present).length;
        const attPctSp  = totalSes ? Math.round(asistSes / totalSes * 100) : 0;
        // Último pago registrado
        const lastPago  = spPay?.history?.filter(h => h.action==="Pago").slice(-1)[0];
        return (
          <>
            {/* Selector de hijo para representantes con múltiples jugadores */}
            {isParent && allChildIds.length > 1 && (
              <div style={{ background:"rgba(21,101,192,.08)", border:"1px solid rgba(33,150,243,.15)",
                borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:7 }}>
                  👨‍👦 Tus jugadores
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {allChildIds.map(cid => {
                    const child = players.find(x => x.id === cid);
                    if (!child) return null;
                    const isActive = cid === activeChildId;
                    return (
                      <div key={cid}
                        onClick={() => setSelectedChildId(cid)}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                          borderRadius:8, cursor:"pointer",
                          background: isActive ? "rgba(21,101,192,.2)" : "rgba(255,255,255,.02)",
                          border: `1px solid ${isActive ? "rgba(33,150,243,.4)" : "rgba(255,255,255,.05)"}` }}>
                        <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0,
                          background:"rgba(21,101,192,.2)", border:`2px solid ${isActive?"#2196F3":"rgba(255,255,255,.1)"}`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700, color:"#7ab3e0" }}>
                          {child.nombre[0]}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, fontWeight:600, color: isActive?"#7ab3e0":"#c0cfe0" }}>
                            {child.nombre} {child.apellido}
                          </div>
                          <div style={{ fontSize:8, color:"#4e6a88" }}>{child.cat} · #{child.num}</div>
                        </div>
                        {isActive && <span style={{ fontSize:10, color:"#2196F3" }}>●</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="hero">
              <div className="hero-av" style={{ background: sp.col, border: susp ? "3px solid #E53935" : "2px solid #1565C0" }}>
                {sp.foto ? <img src={sp.foto} alt="" /> : sp.nombre[0]}
              </div>
              <div className="hero-name">{sp.nombre} {sp.apellido}</div>
              <div className="hero-cat">{sp.cat} · #{sp.num} · {calcAge(sp.dob)} años</div>
              <div style={{ fontSize:8, color:"#4e6a88", marginTop:3 }}>CI: {sp.cedula || "—"}</div>
              <button className="btn-sm" style={{ marginTop:8, background:"rgba(212,184,74,.1)",
                color:"#d4b84a", borderColor:"rgba(212,184,74,.3)", fontSize:9, padding:"5px 14px" }}
                onClick={() => generatePerfilPdf(sp, pay, att, matches, attMatches, sanc)}>
                Perfil 📝
              </button>
              {/* Stats rápidas */}
              {/* Badge MVPs */}
              {(() => {
                const mvpCnt = matches.filter(m=>m.mvp?.playerId===sp.id).length;
                return mvpCnt > 0 ? (
                  <div style={{ display:"flex", justifyContent:"center", marginTop:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(212,184,74,.1)",
                      border:"1px solid rgba(212,184,74,.25)", borderRadius:20, padding:"4px 14px" }}>
                      <span style={{ fontSize:16 }}>🏅</span>
                      <div>
                        <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#d4b84a" }}>{mvpCnt}</span>
                        <span style={{ fontSize:8, color:"#8a7040", marginLeft:3 }}>MVP{mvpCnt>1?"s":""}</span>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}
              <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:10 }}>
                <div style={{ textAlign:"center", background:"rgba(21,101,192,.1)", borderRadius:8, padding:"6px 14px" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#7ab3e0" }}>{attPctSp}%</div>
                  <div style={{ fontSize:7.5, color:"#4e6a88" }}>Asistencia</div>
                </div>
                <div style={{ textAlign:"center", background:"rgba(21,101,192,.1)", borderRadius:8, padding:"6px 14px" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color: spPay && ACTIVE_MONTHS.filter(m=>!spPay.months[m]?.paid&&!spPay.months[m]?.exento).length===0 ? "#43A047" : "#E53935" }}>
                    {spPay ? ACTIVE_MONTHS.filter(m=>spPay.months[m]?.paid||spPay.months[m]?.exento).length : 0}/{ACTIVE_MONTHS.length}
                  </div>
                  <div style={{ fontSize:7.5, color:"#4e6a88" }}>Meses pagos</div>
                </div>
                {lastPago && (
                  <div style={{ textAlign:"center", background:"rgba(21,101,192,.1)", borderRadius:8, padding:"6px 14px" }}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, color:"#7ab3e0", marginTop:2 }}>{lastPago.item}</div>
                    <div style={{ fontSize:7.5, color:"#4e6a88" }}>Último pago</div>
                  </div>
                )}
              </div>

              {/* Stats por categoría si tiene préstamos */}
              {/* ── Stats separadas: propia + préstamo ── */}
              <div style={{ marginTop:10 }}>
                {/* Categoría propia */}
                <div style={{ background:"rgba(21,101,192,.08)", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid rgba(33,150,243,.12)" }}>
                  <div style={{ fontSize:7.5, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>
                    📊 {sp.cat} <span style={{ color:"#2196F3", fontWeight:600 }}>(categoría propia)</span>
                  </div>
                  <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
                    {[["⚽", sp.stats?.goles||0, "Goles"], ["🎯", sp.stats?.asistencias||0, "Asist."], ["🏟️", sp.stats?.partidos||0, "Partidos"]].map(([ic,val,lb])=>(
                      <div key={lb} style={{ textAlign:"center" }}>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#7ab3e0" }}>{val}</div>
                        <div style={{ fontSize:7, color:"#4e6a88" }}>{ic} {lb}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Categorías de préstamo */}
                {sp.statsPorCat && Object.keys(sp.statsPorCat).length > 0 && Object.entries(sp.statsPorCat).map(([cat, s]) => (
                  <div key={cat} style={{ background:"rgba(212,184,74,.05)", borderRadius:8, padding:"8px 10px", marginBottom:6, border:"1px solid rgba(212,184,74,.12)" }}>
                    <div style={{ fontSize:7.5, color:"#8a7040", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>
                      🔁 {cat} <span style={{ color:"#d4b84a", fontWeight:600 }}>(préstamo)</span>
                    </div>
                    <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
                      {[["⚽", s.goles||0, "Goles"], ["🎯", s.asistencias||0, "Asist."], ["🏟️", s.partidos||0, "Partidos"]].map(([ic,val,lb])=>(
                        <div key={lb} style={{ textAlign:"center" }}>
                          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#d4b84a" }}>{val}</div>
                          <div style={{ fontSize:7, color:"#8a7040" }}>{ic} {lb}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap", marginTop:8 }}>
                {susp
                  ? <span className="bg bg-r">🟥 SUSPENDIDO</span>
                  : <span className="bg bg-b">✅ Habilitado</span>
                }
                {yell > 0 && <span className="bg bg-y">🟨 {yell} amarilla{yell>1?"s":""}</span>}
                {reds > 0 && <span className="bg bg-r">🟥 {reds} roja{reds>1?"s":""}</span>}
              </div>
            </div>

            {susp && (
              <div className="card card-r">
                <div style={{ fontSize:10, color:"#e8a0a0", fontWeight:600, marginBottom:4 }}>⚠️ Estás suspendido</div>
                <div style={{ fontSize:9, color:"#4e6a88", lineHeight:1.6 }}>No puedes participar en el próximo partido. Contacta al entrenador para más información.</div>
              </div>
            )}

            {/* Próximo partido */}
            {nextM.length > 0 && (
              <div className="card">
                <div className="ch"><span className="ct">Próximo Partido</span><span className="bg bg-b">{sp.cat}</span></div>
                <MatchCard m={nextM[0]} champs={champs} />
              </div>
            )}

            {/* Resumen pagos */}
            {spPay && (
              <div className={"card" + (pendMeses.length > 0 ? " card-r" : "")}>
                <div className="ch">
                  <span className="ct">💳 Estado de Pagos</span>
                  <span className={"bg " + (pendMeses.length===0 ? "bg-b" : "bg-r")}>
                    {pendMeses.length===0 ? "Al día ✅" : pendMeses.length + " pendiente" + (pendMeses.length>1?"s":"")}
                  </span>
                </div>
                {pendMeses.length > 0 && (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:8, color:"#e8a0a0", marginBottom:4 }}>Meses pendientes:</div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {pendMeses.map(m => <span key={m} className="bg bg-r">{m}</span>)}
                    </div>
                  </div>
                )}
                <div className="mgrid">
                  {ACTIVE_MONTHS.map(m => {
                    const paid = spPay.months[m]?.paid;
                    return (
                      <div key={m} className={"mcell " + (paid ? "mp" : "mup")} style={{ cursor:"default" }}>
                        <div className="mclbl">{m}</div>
                        <div className="mcico">{paid ? "✅" : "❌"}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginTop:7, paddingTop:7, borderTop:"1px solid rgba(255,255,255,.04)" }}>
                  <span style={{ color:"#4e6a88" }}>Campeonatos</span>
                  <span className={"bg " + (champs.filter(ch=>ch.cats.includes(sp.cat)).every(ch=>spPay.championships?.[ch.id]?.paid) ? "bg-b" : "bg-r")}>
                    {champs.filter(ch=>ch.cats.includes(sp.cat)).filter(ch=>spPay.championships?.[ch.id]?.paid).length}/
                    {champs.filter(ch=>ch.cats.includes(sp.cat)).length} pagados
                  </span>
                </div>
              </div>
            )}

            {/* Entrenos */}
            {spTrains.length > 0 && (
              <div className="card">
                <div className="ch"><span className="ct">🏃 Próximos Entrenos</span><span className="bg bg-b">{spTrains.length}</span></div>
                {spTrains.slice(0,5).map(t => {
                  const fdT = t.fecha ? new Date(t.fecha+"T12:00:00") : null;
                  const fechaT = fdT ? fdT.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}) : "—";
                  return (
                  <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, letterSpacing:.5, color:"var(--txt)" }}>{fechaT}</div>
                      <div style={{ fontSize:8, color:"#4e6a88" }}>⏰ {t.hora} · 📍 {t.lugar}</div>
                      {t.tema && <div style={{ fontSize:7.5, color:"#4e6a88", marginTop:1 }}>📋 {t.tema}</div>}
                    </div>
                    <span className="bg bg-b">{sp.cat}</span>
                  </div>
                  );
                })}
              </div>
            )}

            {/* Evaluación técnica */}
            {(sp.eval_velocidad || sp.eval_tecnica || sp.eval_tactica || sp.eval_fisico || sp.eval_actitud || sp.eval_trabajo) && (
              <div className="card">
                <div className="ch"><span className="ct">⭐ Mi Evaluación Técnica</span></div>
                {[
                  ["eval_velocidad","⚡ Velocidad"],
                  ["eval_tecnica","🎯 Técnica"],
                  ["eval_tactica","🧠 Táctica"],
                  ["eval_fisico","💪 Físico"],
                  ["eval_actitud","❤️ Actitud"],
                  ["eval_trabajo","🤝 Trabajo en equipo"],
                ].map(([key, label]) => {
                  const val = sp[key];
                  if (!val) return null;
                  const pct = (val/10)*100;
                  const col = val>=8 ? "#2196F3" : val>=5 ? "#d4b84a" : "#E53935";
                  return (
                    <div key={key} style={{ marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ fontSize:9 }}>{label}</span>
                        <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:col }}>{val}/10</span>
                      </div>
                      <div className="pb"><div className="pf" style={{ width:pct+"%", background:col }} /></div>
                    </div>
                  );
                })}
                {sp.eval_comentario && (
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:8, fontStyle:"italic", borderTop:"1px solid rgba(255,255,255,.04)", paddingTop:7 }}>
                    💬 "{sp.eval_comentario}"
                  </div>
                )}
              </div>
            )}

            {/* ── Historial de partidos de la categoría ── */}
            {(() => {
              const catMatches = matches
                .filter(m => m.status==="finalizado" && m.cat===sp.cat)
                .sort((a,b) => b.id - a.id)
                .slice(0, 5);
              if (catMatches.length === 0) return null;
              return (
                <div className="card">
                  <div className="ch"><span className="ct">⚽ Últimos Partidos</span><span className="bg bg-n">{sp.cat}</span></div>
                  {catMatches.map(m => {
                    const attM    = attMatches.find(a => a.matchId === m.id);
                    const convocado = attM?.convocados?.includes(sp.id);
                    const titular   = attM?.titulares?.includes(sp.id);
                    const ps        = m.playerStats?.[sp.id] || {};
                    const goles     = ps.goles || 0;
                    const asist     = ps.asistencias || 0;
                    const esMvp     = m.mvp?.playerId === sp.id;
                    const esCasa    = m.home === "Rómulo FC" || m.home?.includes("Rómulo");
                    const golesRFC  = esCasa ? m.scoreH : m.scoreA;
                    const golesRiv  = esCasa ? m.scoreA : m.scoreH;
                    const res       = golesRFC > golesRiv ? "V" : golesRFC < golesRiv ? "D" : "E";
                    const resCol    = res==="V" ? "#2196F3" : res==="D" ? "#E53935" : "#d4b84a";
                    return (
                      <div key={m.id} style={{ padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,.03)" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                          <div style={{ flex:1 }}>
                            <span style={{ fontSize:9, fontWeight:600 }}>{m.home} {m.scoreH}–{m.scoreA} {m.away}</span>
                          </div>
                          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                            {esMvp && <span className="bg bg-y" style={{ fontSize:7 }}>🏅 MVP</span>}
                            <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                              color: resCol, width:16, textAlign:"center" }}>{res}</span>
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                          <span style={{ fontSize:7.5, color:"#4e6a88" }}>📅 {m.date}</span>
                          {convocado
                            ? <span className="bg bg-b" style={{ fontSize:7 }}>{titular ? "Titular" : "Suplente"}</span>
                            : <span className="bg bg-n" style={{ fontSize:7 }}>No convocado</span>}
                          {goles > 0 && <span className="bg bg-b" style={{ fontSize:7 }}>⚽ {goles}</span>}
                          {asist > 0 && <span className="bg bg-n" style={{ fontSize:7 }}>🎯 {asist}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Historial de lesiones */}
            {sp.lesiones && sp.lesiones.length > 0 && (
              <div className="card">
                <div className="ch"><span className="ct">🩹 Mis Lesiones</span><span className="bg bg-r">{sp.lesiones.length}</span></div>
                {sp.lesiones.map((l,i) => (
                  <div key={i} style={{ padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:10, color:"#e8a0a0" }}>🩹 {l.tipo}</span>
                      <span style={{ fontSize:8, color:"#4e6a88" }}>{l.fecha}</span>
                    </div>
                    <div style={{ fontSize:8, color:"#4e6a88", marginTop:2 }}>⏱ Recuperación: {l.recuperacion}</div>
                    {l.notas && <div style={{ fontSize:7.5, color:"#3a5068", marginTop:1 }}>{l.notas}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        );
      }

      // ── PAGOS (solo jugador/rep) ──
      if (tab === "pagos" && sp && spPay) {
        return (
          <>
            <div className="st">💳 Mis Pagos</div>
            <div className="card">
              <div className="ch">
                <span className="ct">Mensualidades</span>
                <span className={"bg " + (pendMeses.length===0 ? "bg-b" : "bg-r")}>
                  {pagMeses.length}/12
                </span>
              </div>
              <div className="mgrid">
                {ACTIVE_MONTHS.map(m => {
                  const paid = spPay.months[m]?.paid;
                  return (
                    <div key={m} className={"mcell " + (paid ? "mp" : "mup")} style={{ cursor:"default" }}>
                      <div className="mclbl">{m}</div>
                      <div className="mcico">{paid ? "✅" : "❌"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            {champs.filter(ch => ch.cats.includes(sp.cat)).map(ch => {
              const ok = spPay.championships?.[ch.id]?.paid;
              const fecha = spPay.championships?.[ch.id]?.date;
              return (
                <div key={ch.id} className={"card" + (ok ? "" : " card-r")}>
                  <div className="ch">
                    <span className="ct">🏆 {ch.nombre}</span>
                    <span className={"bg " + (ok ? "bg-b" : "bg-r")}>
                      {ok ? "Pagado ✅" : "Pendiente ❌"}
                    </span>
                  </div>
                  <p style={{ fontSize:9, color:"#4e6a88", lineHeight:1.6 }}>
                    {ok
                      ? "Inscripción pagada" + (fecha ? " el " + fecha : "") + "."
                      : "Inscripción pendiente. Contacta al entrenador para regularizar."}
                  </p>
                </div>
              );
            })}
            {pendMeses.length > 0 && (
              <div className="card card-r">
                <div className="ch"><span className="ct">⚠️ Pendientes</span><span className="bg bg-r">{pendMeses.length}</span></div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  {pendMeses.map(m => <span key={m} className="bg bg-r">{m}</span>)}
                </div>
                <p style={{ fontSize:9, color:"#4e6a88", marginTop:8, lineHeight:1.6 }}>
                  Contacta a tu entrenador o dirígete a la administración para ponerte al día.
                </p>
              </div>
            )}
          </>
        );
      }

      // ── CAMPEONATOS / TABLA ──
      if (tab === "campeonatos") {
        return (
          <>
            <div className="st">🏆 {isVisitor ? "Campeonatos" : "Mis Campeonatos"}</div>
            {spChamps.length === 0 && (
              <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Sin campeonatos activos</p></div>
            )}
            {spChamps.map(ch => (
              <div key={ch.id} className="card" style={{ marginBottom:8 }}>
                <div className="ch" style={{ marginBottom:8 }}>
                  <div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:.5 }}>{ch.nombre}</div>
                    <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginTop:3 }}>
                      {ch.cats.length>0 ? ch.cats.map(c=><span key={c} className="bg bg-b">{c}</span>) : <span className="bg bg-n">Todas</span>}
                    </div>
                  </div>
                  {ch.link && (
                    <button className="btn-wa" onClick={() => window.open(ch.link,"_blank")}>🌐 Oficial</button>
                  )}
                </div>
                <MiniStandings ch={ch} />
              </div>
            ))}
          </>
        );
      }

      // ── PARTIDOS ──
      if (tab === "partidos" || tab === "calendario") {
        return (
          <>
            <div className="st">📅 {isVisitor ? "Partidos" : "Mis Partidos"}</div>
            {nextM.length > 0 && (
              <>
                <div style={{ fontSize:8, color:"#3a5068", letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>Próximos</div>
                {nextM.map(m => <MatchCard key={m.id} m={m} champs={champs} />)}
              </>
            )}
            {pastM.length > 0 && (
              <>
                <div style={{ fontSize:8, color:"#3a5068", letterSpacing:1, textTransform:"uppercase", margin:"10px 0 5px" }}>Jugados</div>
                {pastM.map(m => <MatchCard key={m.id} m={m} champs={champs} />)}
              </>
            )}
            {spM.length === 0 && <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Sin partidos</p></div>}
          </>
        );
      }

      // ── AGENDA (espectador/visitante) ──
      if (tab === "agenda") {
        const MESES_N2 = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        const DIAS_S2  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
        function parseEDate(dateStr) {
          if (!dateStr) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
            const [y,m,d] = dateStr.trim().split("-").map(Number); return new Date(y,m-1,d);
          }
          const meses = { Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11,
            Enero:0,Febrero:1,Marzo:2,Abril:3,Mayo:4,Junio:5,Julio:6,Agosto:7,Septiembre:8,Octubre:9,Noviembre:10,Diciembre:11 };
          const parts = dateStr.trim().split(/\s+/);
          if (parts.length>=2){ const dd=parseInt(parts[0]),mm=meses[parts[1]],yy=parts[2]?parseInt(parts[2]):new Date().getFullYear();
            if(!isNaN(dd)&&mm!==undefined) return new Date(yy,mm,dd); }
          return null;
        }
        function getEvSpec(date) {
          const evs=[]; const dd=date.getDate(),mm=date.getMonth(),yy=date.getFullYear();
          function sd(d){ return d&&d.getDate()===dd&&d.getMonth()===mm&&d.getFullYear()===yy; }
          matches.forEach(m=>{ const d=parseEDate(m.date); if(sd(d)) evs.push({tipo:"partido",color:m.status==="finalizado"?"#1565C0":"#2196F3",icon:"⚽",label:m.home+" vs "+m.away,sub:m.status==="finalizado"?m.scoreH+"-"+m.scoreA:m.time}); });
          trainings.forEach(t=>{ const d=parseEDate(t.date||t.fecha); if(sd(d)) evs.push({tipo:"entreno",color:"#1976D2",icon:"🏃",label:t.tema||"Entrenamiento",sub:(t.cat||"")+" "+(t.time||t.hora||"")}); });
          (clubConfig?.torneos||[]).forEach(t=>{ const d=parseEDate(t.fecha); if(sd(d)) evs.push({tipo:"torneo",color:"#d4b84a",icon:"🌍",label:t.nombre,sub:t.lugar||""}); });
          players.forEach(p=>{ if(!p.dob)return; const bd=new Date(p.dob); if(bd.getDate()===dd&&bd.getMonth()===mm) evs.push({tipo:"bday",color:"#E53935",icon:"🎂",label:p.nombre+" "+p.apellido,sub:"Cumple "+(yy-bd.getFullYear())+" años"}); });
          return evs;
        }
        const primerDia2 = new Date(agendaAnio, agendaMes, 1).getDay();
        const diasMes2   = new Date(agendaAnio, agendaMes+1, 0).getDate();
        const hoy2       = new Date();
        const celdas2    = [];
        for(let i=0;i<primerDia2;i++) celdas2.push(null);
        for(let d=1;d<=diasMes2;d++) celdas2.push(d);
        return (
          <>
            <div className="st">📆 Agenda</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <button className="btn-sm" onClick={()=>{ if(agendaMes===0){setAgendaMes(11);setAgendaAnio(agendaAnio-1);}else setAgendaMes(agendaMes-1); }}>‹</button>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0" }}>{MESES_N2[agendaMes]} {agendaAnio}</div>
              <button className="btn-sm" onClick={()=>{ if(agendaMes===11){setAgendaMes(0);setAgendaAnio(agendaAnio+1);}else setAgendaMes(agendaMes+1); }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:3 }}>
              {DIAS_S2.map(d=><div key={d} style={{ textAlign:"center", fontSize:7, color:"#3a5068", fontWeight:600 }}>{d}</div>)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:10 }}>
              {celdas2.map((d,i)=>{
                if(!d) return <div key={"e"+i}/>;
                const date=new Date(agendaAnio,agendaMes,d);
                const evs=getEvSpec(date);
                const esHoy=d===hoy2.getDate()&&agendaMes===hoy2.getMonth()&&agendaAnio===hoy2.getFullYear();
                const selec=agendaDia&&agendaDia.getDate()===d&&agendaDia.getMonth()===agendaMes;
                return (
                  <div key={d} onClick={()=>setAgendaDia(selec?null:date)}
                    style={{ minHeight:42,borderRadius:6,padding:"3px 2px",cursor:"pointer",
                      background:selec?"rgba(21,101,192,.25)":esHoy?"rgba(21,101,192,.12)":"rgba(255,255,255,.02)",
                      border:`1px solid ${selec?"rgba(33,150,243,.5)":esHoy?"rgba(33,150,243,.3)":"rgba(255,255,255,.03)"}`,
                      display:"flex",flexDirection:"column",alignItems:"center",gap:1 }}>
                    <div style={{ fontSize:9,fontWeight:esHoy?700:400,color:esHoy?"#7ab3e0":"#8a9ab0" }}>{d}</div>
                    <div style={{ display:"flex",flexWrap:"wrap",gap:1,justifyContent:"center" }}>
                      {evs.slice(0,3).map((e,ei)=><div key={ei} style={{ width:5,height:5,borderRadius:"50%",background:e.color }}/>)}
                      {evs.length>3&&<div style={{ fontSize:6,color:"#4e6a88" }}>+{evs.length-3}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {agendaDia&&(()=>{
              const evs=getEvSpec(agendaDia);
              return (
                <div className="card" style={{ border:"1px solid rgba(33,150,243,.15)" }}>
                  <div className="ch"><span className="ct">📋 {agendaDia.getDate()} {MESES_N2[agendaDia.getMonth()].slice(0,3)}</span>
                    <span style={{ cursor:"pointer", color:"#7ab3e0" }} onClick={()=>setAgendaDia(null)}>✕</span></div>
                  {evs.length===0&&<div style={{ fontSize:9,color:"#3a5068",textAlign:"center",padding:12 }}>Sin actividades</div>}
                  {evs.map((e,i)=>(
                    <div key={i} style={{ display:"flex",gap:8,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.03)",alignItems:"center" }}>
                      <div style={{ width:3,height:32,borderRadius:2,background:e.color,flexShrink:0 }}/>
                      <div style={{ fontSize:14 }}>{e.icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:9.5,fontWeight:600 }}>{e.label}</div>
                        <div style={{ fontSize:7.5,color:"#4e6a88" }}>{e.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        );
      }

      // ── TORNEOS (espectador: solo nombre, fecha, lugar) ──
      if (tab === "torneos") {
        const torneos = clubConfig?.torneos || [];
        return (
          <>
            <div className="st">🌍 Torneos Externos</div>
            {torneos.length === 0 && (
              <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:14 }}>Sin torneos registrados aún</p></div>
            )}
            {[...torneos].reverse().map((t,i) => (
              <div key={t.id||i} className="card" style={{ marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#7ab3e0", marginBottom:5 }}>{t.nombre}</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <span className="bg bg-n">📅 {t.fecha}</span>
                  {t.lugar && <span className="bg bg-n">📍 {t.lugar}</span>}
                  {t.cats?.length > 0 && t.cats.map(cat=><span key={cat} className="bg bg-b">{cat}</span>)}
                </div>
              </div>
            ))}
          </>
        );
      }

      // ── ENTRENOS (jugador/rep) ──
      if (tab === "entrenos") {
        const hoyISO = new Date().toISOString().slice(0,10);
        const myT = trainings.filter(t => !spCat || (t.cats||[]).includes(spCat));
        const proxT = myT.filter(t=>t.fecha&&t.fecha>=hoyISO).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
        const pastT = myT.filter(t=>t.fecha&&t.fecha<hoyISO).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).slice(0,10);
        function FechaLeg(f){ if(!f) return "—"; const d=new Date(f+"T12:00:00"); return d.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}); }
        return (
          <>
            <div className="st">🏃 Entrenamientos</div>
            {proxT.length===0 && pastT.length===0 && (
              <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Sin entrenamientos registrados</p></div>
            )}
            {proxT.length>0 && (
              <>
                <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:5 }}>Próximos</div>
                {proxT.map(t=>(
                  <div key={t.id} className="card" style={{ marginBottom:8, borderLeft:"3px solid rgba(33,150,243,.3)" }}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:15, letterSpacing:.5, color:"var(--txt)", marginBottom:4 }}>{FechaLeg(t.fecha)}</div>
                    <div style={{ display:"flex", gap:10, fontSize:9.5, color:"#7ab3e0" }}>
                      <span>⏰ {t.hora}</span><span>📍 {t.lugar}</span>
                    </div>
                    {t.tema && <div style={{ fontSize:8.5, color:"#4e6a88", marginTop:3 }}>📋 {t.tema}</div>}
                    {t.notas && <div style={{ fontSize:8, color:"#4e6a88", marginTop:4, borderTop:"1px solid rgba(255,255,255,.04)", paddingTop:4 }}>📝 {t.notas}</div>}
                  </div>
                ))}
              </>
            )}
            {pastT.length>0 && (
              <>
                <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, margin:"10px 0 5px" }}>Historial reciente</div>
                {pastT.map(t=>(
                  <div key={t.id} className="card" style={{ marginBottom:6, opacity:.65 }}>
                    <div style={{ fontSize:9, color:"#4e6a88" }}>{FechaLeg(t.fecha)} · ⏰ {t.hora} · 📍 {t.lugar}</div>
                    {t.tema && <div style={{ fontSize:8, color:"#3a5068", marginTop:2 }}>📋 {t.tema}</div>}
                  </div>
                ))}
              </>
            )}
          </>
        );
      }

      if (tab === "chat") {
        const miCat   = spCat || "General";
        const CANALES = ["General", ...CATS.filter(c => c === miCat && miCat !== "General")].filter((v,i,a)=>a.indexOf(v)===i);
        const activeChatCat = CANALES.includes(chatCat) ? chatCat : CANALES[0];
        const filtMsgs = chatMsgs.filter(m => m.canal === activeChatCat);
        return (
          <>
            <div className="st">💬 Chat</div>
            <div className="dtabs" style={{ marginBottom:10 }}>
              {CANALES.map(c => (
                <div key={c} className={"dt"+(activeChatCat===c?" da":"")} onClick={() => setChatCat(c)}>{c}</div>
              ))}
            </div>
            <div style={{ minHeight:260, maxHeight:"calc(100vh - 360px)", overflowY:"auto",
              background:"var(--card)", borderRadius:10, border:"1px solid rgba(33,150,243,.08)",
              padding:"10px", marginBottom:10, display:"flex", flexDirection:"column", gap:8 }}>
              {filtMsgs.length === 0 && (
                <div style={{ textAlign:"center", color:"#3a5068", fontSize:9, marginTop:40 }}>
                  Sin mensajes aún en {activeChatCat}
                </div>
              )}
              {filtMsgs.map(m => {
                const esPropio = m.autor === user?.name;
                return (
                  <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems: esPropio?"flex-end":"flex-start" }}>
                    {!esPropio && <div style={{ fontSize:7.5, color:"#3a5068", marginBottom:2, paddingLeft:4 }}>{m.autor}</div>}
                    <div style={{
                      background: esPropio ? "rgba(21,101,192,.25)" : "#090d1a",
                      border:`1px solid ${esPropio?"rgba(33,150,243,.3)":"rgba(255,255,255,.05)"}`,
                      borderRadius: esPropio?"12px 12px 4px 12px":"12px 12px 12px 4px",
                      padding:"8px 11px", maxWidth:"85%"
                    }}>
                      <div style={{ fontSize:11, color:"#ccd8e8", lineHeight:1.5 }}>{m.texto}</div>
                      <div style={{ fontSize:7, color:"#3a5068", marginTop:3 }}>{timeAgo(m.ts)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:7 }}>
              <textarea className="inp" style={{ flex:1, resize:"none", minHeight:40, lineHeight:1.5, paddingTop:9 }}
                placeholder="Escribe un mensaje..."
                value={chatMsg}
                onChange={e => setChatMsg(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault();
                  const txt=chatMsg.trim(); if(!txt) return;
                  const id="cm_"+Date.now();
                  if(!isDemo) safeSetDoc(doc(db,"chat",id),{ id, canal:activeChatCat, texto:txt, autor:user?.name||"Jugador", rol: role==="player"?"Jugador":"Representante", ts:new Date().toISOString(), uid:user?.playerId||"" });
                  else setChatMsgs(prev=>[...prev,{ id, canal:activeChatCat, texto:txt, autor:user?.name||"Jugador", ts:new Date().toISOString() }]);
                  setChatMsg("");
                }}}
              />
              <button className="btn" style={{ width:44, height:44, padding:0, borderRadius:10, fontSize:18, flexShrink:0 }}
                onClick={() => {
                  const txt=chatMsg.trim(); if(!txt) return;
                  const id="cm_"+Date.now();
                  if(!isDemo) safeSetDoc(doc(db,"chat",id),{ id, canal:activeChatCat, texto:txt, autor:user?.name||"Jugador", rol: role==="player"?"Jugador":"Representante", ts:new Date().toISOString(), uid:user?.playerId||"" });
                  else setChatMsgs(prev=>[...prev,{ id, canal:activeChatCat, texto:txt, autor:user?.name||"Jugador", ts:new Date().toISOString() }]);
                  setChatMsg("");
                }}>➤</button>
            </div>
          </>
        );
      }

      // ── STATS (visitante) ──
      if (tab === "stats") {
        const totalJ = players.length;
        const totalF = matches.filter(m=>m.status==="finalizado").length;
        const totalP = matches.filter(m=>m.status==="próximo").length;
        return (
          <>
            <div className="st">📊 Estadísticas</div>
            <div className="sr4">
              <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{totalJ}</div><div className="sl">Jugadores</div></div>
              <div className="sb"><div className="sn" style={{ color:"#d4b84a" }}>{CATS.length}</div><div className="sl">Categorías</div></div>
              <div className="sb"><div className="sn" style={{ color:"var(--txt)" }}>{totalF}</div><div className="sl">Jugados</div></div>
              <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{totalP}</div><div className="sl">Próximos</div></div>
            </div>
            {/* Botón comparativa */}
            <button className="btn" style={{ marginBottom:8, background:"rgba(212,184,74,.08)",
              border:"1px solid rgba(212,184,74,.2)", color:"#d4b84a" }}
              onClick={() => setCompareModal(true)}>
              ⚖️ Comparar Jugadores
            </button>

            <div className="card">
              <div className="ch"><span className="ct">Por Categoría</span></div>
              {CATS.map(c => {
                const cp = players.filter(p=>p.cat===c).length;
                const cm = matches.filter(m=>m.cat===c&&m.status==="finalizado").length;
                return (
                  <div key={c} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <span style={{ fontSize:10, fontWeight:500 }}>{c}</span>
                    <div style={{ display:"flex", gap:5 }}>
                      <span className="bg bg-b">👥 {cp}</span>
                      <span className="bg bg-n">⚽ {cm} partidos</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card">
              <div className="ch"><span className="ct">Campeonatos Activos</span></div>
              {champs.filter(c=>c.activo).map(ch => (
                <div key={ch.id} style={{ padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                  <div style={{ fontSize:10, fontWeight:500, marginBottom:3 }}>{ch.nombre}</div>
                  <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                    {ch.cats.length>0 ? ch.cats.map(c=><span key={c} className="bg bg-b">{c}</span>) : <span className="bg bg-n">Todas</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      }

      return null;
    }

    return (
      <>
        <style>{CSS}</style>
        <div className="app">
          <div className="hdr">
            <div className="hdr-row">
              <div>
                <div className="logo"><span className="lb">RÓMULO</span> <span className="lr">F.C</span></div>
                <div className="hdr-sub">{user.name} · {clubConfig?.temporada || 2026}</div>
                {isDemo && <div style={{ fontSize:7.5, color:"#d4b84a", fontWeight:600, letterSpacing:.5 }}>🎮 MODO DEMO</div>}
              </div>
              <div className="hdr-right">
                <span className="badge badge-b">{roleBadge}</span>
                {/* Campana de notificaciones espectador */}
                {!isVisitor && (() => {
                  const misNotifs = notifs.filter(n => notifEsPara(n));
                  const uid = myUID();
                  const noLeidas = misNotifs.filter(n => !n.readBy?.[uid]).length;
                  return (
                    <div style={{ position:"relative", cursor:"pointer" }}
                      onClick={() => setShowNotif(v => !v)}>
                      <div className="ico-btn">🔔</div>
                      {noLeidas > 0 && (
                        <div style={{ position:"absolute", top:-2, right:-2, minWidth:14, height:14,
                          background:"#E53935", borderRadius:7, fontSize:7.5, fontWeight:700,
                          color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                          padding:"0 3px", lineHeight:1 }}>
                          {noLeidas > 9 ? "9+" : noLeidas}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="ico-btn" onClick={()=>setDarkMode(d=>!d)} title="Cambiar tema" style={{fontSize:14}}>{darkMode?"☀️":"🌙"}</div>
                <div className="ico-btn" onClick={logout} title="Salir">🚪</div>
              </div>
            </div>
            <div className="nav">
              {SPEC_TABS.map(([k,,l]) => (
                <button key={k} className={"nb" + (tab===k ? " ab" : "")} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
          </div>
          {/* Panel notificaciones espectador */}
          {showNotif && !isVisitor && (() => {
            const misNotifs = notifs.filter(n => notifEsPara(n))
              .sort((a,b) => (b.ts||"").localeCompare(a.ts||""))
              .slice(0, 30);
            const uid = myUID();
            return (
              <div style={{ position:"absolute", top:64, right:8, width:"calc(100% - 16px)",
                maxWidth:360, background:"var(--card)", border:"1px solid rgba(33,150,243,.2)",
                borderRadius:12, zIndex:900, boxShadow:"0 8px 32px rgba(0,0,0,.5)",
                maxHeight:"70vh", display:"flex", flexDirection:"column" }}>
                {/* Header */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,.05)" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:"#7ab3e0" }}>🔔 Notificaciones</span>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button className="btn-sm" style={{ fontSize:7.5, padding:"2px 8px" }}
                      onClick={() => markAllRead(misNotifs)}>
                      ✓ Marcar leídas
                    </button>
                    <span style={{ cursor:"pointer", color:"#4e6a88", fontSize:16 }}
                      onClick={() => setShowNotif(false)}>✕</span>
                  </div>
                </div>
                {/* Lista */}
                <div style={{ overflowY:"auto", flex:1 }}>
                  {misNotifs.length === 0 && (
                    <div style={{ padding:"20px 14px", textAlign:"center", fontSize:9, color:"#3a5068" }}>
                      Sin notificaciones
                    </div>
                  )}
                  {misNotifs.map(n => {
                    const leida = !!(n.readBy?.[uid]);
                    const tipoColor = {
                      gol:       "#d4b84a",
                      resultado: "#2196F3",
                      partido:   "#7ab3e0",
                      live:      "#E53935",
                      campeonato:"#d4b84a",
                    }[n.tipo] || "#4e6a88";
                    const ts = n.ts ? new Date(n.ts).toLocaleString("es",{
                      day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}) : "";
                    return (
                      <div key={n.id}
                        onClick={() => { markNotifRead(n.id); setShowNotif(false); setTab(n.link||"inicio"); }}
                        style={{ display:"flex", gap:8, padding:"10px 14px", cursor:"pointer",
                          background: leida ? "transparent" : "rgba(33,150,243,.04)",
                          borderBottom:"1px solid rgba(255,255,255,.03)",
                          borderLeft: leida ? "3px solid transparent" : "3px solid "+tipoColor }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:9.5, color: leida?"#4e6a88":"#c0cfe0", lineHeight:1.4 }}>
                            {n.txt}
                          </div>
                          <div style={{ fontSize:7.5, color:"#3a5068", marginTop:3 }}>{ts}</div>
                        </div>
                        {!leida && (
                          <div style={{ width:7, height:7, borderRadius:"50%",
                            background:tipoColor, flexShrink:0, marginTop:4 }}/>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Banner actualización espectador */}
          {swUpdate && (
            <div style={{ background:"rgba(21,101,192,.18)", borderBottom:"1px solid rgba(33,150,243,.35)",
              padding:"8px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:16 }}>🔄</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9.5, fontWeight:600, color:"#7ab3e0" }}>Nueva versión disponible</div>
                <div style={{ fontSize:7.5, color:"#4e6a88" }}>Toca para actualizar Rómulo F.C.</div>
              </div>
              <button onClick={() => { setSwUpdate(false); window.location.reload(); }}
                style={{ background:"#1565C0", border:"none", borderRadius:8, color:"#fff",
                  fontSize:9, fontWeight:600, padding:"6px 12px", cursor:"pointer", flexShrink:0 }}>
                Actualizar ↑
              </button>
              <button onClick={() => setSwUpdate(false)}
                style={{ background:"none", border:"none", color:"#4e6a88", fontSize:16,
                  cursor:"pointer", padding:"0 4px" }}>✕</button>
            </div>
          )}
          <div className="cnt">
            {renderSpecContent()}
          </div>
          <div className="bnav">
            {SPEC_TABS.map(([k,ic,lb]) => (
              <div key={k} className={"bn" + (tab===k ? " ba" : "")} onClick={() => setTab(k)}>
                <span className="bi">{ic}</span>{lb}
              </div>
            ))}
          </div>
        </div>
        <ConfirmDialog cfg={conf} onClose={() => setConf(null)} />
      </>
    );
  }

  // ── ADMIN PANEL ────────────────────────────
  if (!user) return <><style>{CSS}</style><div className="login"><div className="login-logo"><span style={{color:"#2196F3"}}>RÓMULO</span> <span style={{color:"#E53935"}}>F.C</span></div></div></>;

  const ADMIN_TABS = [
    ["inicio","🏠","Inicio"],
    ["agenda","📆","Agenda"],
    ["jugadores","👥","Jugadores"],
    ["asistencia","✅","Asistencia"],
    ["pagos","💳","Pagos"],
    ["calendario","📅","Partidos"],
    ["entrenamientos","🏃","Entrenos"],
    ["campeonatos","🏆","Campeonatos"],
    ["torneos","🌍","Torneos"],
    ["torneo-rapido","⚡","Torneo"],
    ["uniformes","👕","Uniformes"],
    ["chat","💬","Chat"],
    ["stats","📊","Stats"],
    ...(can("entrenadores") ? [["entrenadores","🧑‍💼","Staff"]] : []),
    ["config","⚙️","Config"],
  ];

  function renderAdminContent() {

    // ── INICIO ──────────────────────────────
    if (tab === "inicio") {
      const myPlayers  = players.filter(p => user.cat === "Todas" || p.cat === user.cat);
      const susp       = myPlayers.filter(p => sanc[p.id]?.suspended);
      const nextM      = matches.filter(m => m.status === "próximo" && (user.cat === "Todas" || m.cat === user.cat));
      const mesActual  = new Date().toLocaleString("es",{month:"long"}).replace(/^\w/,c=>c.toUpperCase());
      const pagadosMes = myPlayers.filter(p => pay[p.id]?.months?.[mesActual]?.paid).length;
      const pendMes    = myPlayers.length - pagadosMes;
      const pctPago    = myPlayers.length ? Math.round(pagadosMes / myPlayers.length * 100) : 0;
      const totalBs    = myPlayers.reduce((s,p) => s + (parseFloat(pay[p.id]?.months?.[mesActual]?.monto)||0), 0);
      // Asistencia promedio último entrenamiento
      const myTrainsD  = trainings.filter(t => user.cat === "Todas" || t.cats.some(c => c === user.cat));
      const lastTrain  = myTrainsD[myTrainsD.length - 1];
      const attPlayers = lastTrain ? myPlayers.filter(p => lastTrain.cats.includes(p.cat)) : [];
      const attCount   = lastTrain ? attPlayers.filter(p => att[p.id]?.[lastTrain.id]?.present).length : 0;
      const attPct     = attPlayers.length ? Math.round(attCount / attPlayers.length * 100) : 0;
      // Jugadores con notas
      const conNotas   = myPlayers.filter(p => p.notas && p.notas.trim()).length;
      // Deudores: 2+ meses sin pagar
      const deudores   = myPlayers.filter(p => {
        const mesesPend = ACTIVE_MONTHS.filter(m => !pay[p.id]?.months?.[m]?.paid && !pay[p.id]?.months?.[m]?.exento);
        return mesesPend.length >= 2;
      }).sort((a,b) => {
        const pa = ACTIVE_MONTHS.filter(m => !pay[a.id]?.months?.[m]?.paid && !pay[a.id]?.months?.[m]?.exento).length;
        const pb = ACTIVE_MONTHS.filter(m => !pay[b.id]?.months?.[m]?.paid && !pay[b.id]?.months?.[m]?.exento).length;
        return pb - pa;
      });

      return (
        <>
          <div className="st">🏟️ Panel Principal</div>
          <p style={{ fontSize:9, color:"#4e6a88", marginBottom:10 }}>
            Bienvenido, <strong style={{ color:"#ccd8e8" }}>{user?.name}</strong> · {user?.role}
          </p>

          {/* ── Banner notificaciones push ── */}
          {pushStatus === "idle" && (
            <div style={{ background:"rgba(21,101,192,.1)", border:"1px solid rgba(33,150,243,.2)",
              borderRadius:10, padding:"10px 12px", marginBottom:10,
              display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>🔔</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, fontWeight:600, color:"var(--txt)" }}>Activar notificaciones</div>
                <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>Recibe alertas de partidos, pagos y avisos del club</div>
              </div>
              <button className="btn-sm" style={{ background:"#1565C0", color:"#fff", flexShrink:0 }}
                onClick={requestPushPermission}>Activar</button>
            </div>
          )}
          {pushStatus === "requesting" && (
            <div style={{ background:"rgba(21,101,192,.08)", border:"1px solid rgba(33,150,243,.15)",
              borderRadius:10, padding:"10px 12px", marginBottom:10, fontSize:9, color:"#7ab3e0" }}>
              ⏳ Esperando permiso...
            </div>
          )}
          {pushStatus === "granted" && (
            <div style={{ background:"rgba(21,101,192,.08)", border:"1px solid rgba(33,150,243,.15)",
              borderRadius:10, padding:"9px 12px", marginBottom:10,
              display:"flex", alignItems:"center", gap:8, fontSize:9, color:"#7ab3e0" }}>
              <span>✅</span> Notificaciones activadas en este dispositivo
            </div>
          )}
          {pushStatus === "denied" && (
            <div style={{ background:"rgba(183,28,28,.06)", border:"1px solid rgba(229,57,53,.12)",
              borderRadius:10, padding:"9px 12px", marginBottom:10, fontSize:9, color:"#e8a0a0" }}>
              🔕 Notificaciones bloqueadas — actívalas desde la configuración del navegador
            </div>
          )}

          {/* ── Stats fila 1 ── */}
          <div className="sr3" style={{ marginBottom:8 }}>
            <div className="sb">
              <div className="sn" style={{ color:"#2196F3" }}>{myPlayers.length}</div>
              <div className="sl">Jugadores</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color: pendMes > 0 ? "#E53935" : "#43A047" }}>{pendMes}</div>
              <div className="sl">Sin pagar</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color:"#FFD600" }}>{nextM.length}</div>
              <div className="sl">Próximos</div>
            </div>
          </div>

          {/* ── Stats fila 2 ── */}
          <div className="sr3" style={{ marginBottom:10 }}>
            <div className="sb">
              <div className="sn" style={{ color:"#7ab3e0", fontSize:14 }}>{pctPago}%</div>
              <div className="sl">Pago {mesActual}</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color:"#7ab3e0", fontSize:14 }}>{attPct}%</div>
              <div className="sl">Últ. asistencia</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color:"#d4b84a", fontSize:14 }}>Bs.{totalBs > 999 ? (totalBs/1000).toFixed(1)+"k" : totalBs.toFixed(0)}</div>
              <div className="sl">Recaudado</div>
            </div>
          </div>

          {/* ── Alerta pagos pendientes ── */}
          {pendMes > 0 && (
            <div className="card card-r" style={{ marginBottom:8 }}>
              <div className="ch">
                <span className="ct">⚠️ Pagos Pendientes — {mesActual}</span>
                <span className="bg bg-r">{pendMes} jugadores</span>
              </div>
              <div style={{ display:"flex", gap:7, marginTop:6 }}>
                <button className="btn" style={{ flex:1, fontSize:10, padding:8 }}
                  onClick={() => { setTab("pagos"); }}>
                  Ver detalles
                </button>
                <button className="btn-sm" style={{ fontSize:10 }}
                  onClick={() => exportPaymentsPDF(mesActual)}>
                  📄 PDF
                </button>
              </div>
            </div>
          )}

          {/* ── Próximo partido ── */}
          {nextM.slice(0,1).map(m => (
            <div key={m.id} className="card" style={{ marginBottom:8 }}>
              <div className="ch">
                <span className="ct">⚽ Próximo Partido</span>
                <span className="bg bg-b">{m.cat}</span>
              </div>
              <MatchCard m={m} champs={champs} />
              <div style={{ display:"flex", gap:6, marginTop:4 }}>
                {can("partido") && (
                  <>
                    <button className="btn" style={{ flex:1, padding:8, fontSize:11 }} onClick={() => setLiveM(m)}>
                      🟢 En Vivo
                    </button>
                    <button className="btn-sm" style={{ flex:1, padding:8, fontSize:10,
                      background:"rgba(212,184,74,.1)", color:"#d4b84a", borderColor:"rgba(212,184,74,.3)" }}
                      onClick={() => { setQuickResult(m); setQr({ scoreH:"", scoreA:"", goleadores:[] }); setQrInput(""); }}>
                      📋 Resultado
                    </button>
                  </>
                )}
                <button className="btn-wa" style={{ flex:1, justifyContent:"center" }} onClick={() => {
                  const mp = players.filter(p => p.cat === m.cat);
                  mp.forEach((p,i) => setTimeout(() =>
                    openWA(p.repTel,"🏟️ RÓMULO F.C — Hola "+p.repNombre+", recordatorio: "+m.home+" vs "+m.away+" · "+m.date+" · "+m.time+" · "+m.field),
                    i*450
                  ));
                }}>📲 Notificar todos</button>
              </div>
            </div>
          ))}

          {/* ── Suspendidos ── */}
          {susp.length > 0 && (
            <div className="card card-r" style={{ marginBottom:8 }}>
              <div className="ch"><span className="ct">🟥 Suspendidos</span><span className="bg bg-r">{susp.length}</span></div>
              {susp.map(p => (
                <div key={p.id} className="pr">
                  <Avatar p={p} />
                  <div className="pi">
                    <div className="pn">{p.nombre} {p.apellido}</div>
                    <div className="ps">{p.cat}</div>
                  </div>
                  <span className="bg bg-r">Suspendido</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Deudores 2+ meses ── */}
          {/* Top MVP del dashboard */}
          {(() => {
            const mvpMap = {};
            matches.filter(m=>m.mvp?.playerId && (!myPlayers.length || myPlayers.find(x=>x.id===m.mvp.playerId)))
              .forEach(m => { mvpMap[m.mvp.playerId] = (mvpMap[m.mvp.playerId]||0)+1; });
            const sorted = Object.entries(mvpMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
            if (sorted.length===0) return null;
            return (
              <div className="card" style={{ marginBottom:8, border:"1px solid rgba(212,184,74,.15)", background:"rgba(212,184,74,.02)" }}>
                <div className="ch"><span className="ct">🏅 Top MVPs</span><span className="bg bg-y">Temporada</span></div>
                {sorted.map(([pid, cnt], i) => {
                  const p = players.find(x=>x.id===pid);
                  if (!p) return null;
                  return (
                    <div key={pid} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0",
                      borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                      <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                        color: i===0?"#d4b84a":i===1?"#afc4d8":"#c48a5a", width:16, textAlign:"center" }}>
                        {i===0?"🥇":i===1?"🥈":"🥉"}
                      </span>
                      <Avatar p={p} size={26}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:9.5, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                        <div style={{ fontSize:7.5, color:"#4e6a88" }}>{p.cat} · #{p.num}</div>
                      </div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#d4b84a" }}>{cnt}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {deudores.length > 0 && (
            <div className="card" style={{ marginBottom:8, border:"1px solid rgba(229,57,53,.2)", background:"rgba(229,57,53,.03)" }}>
              <div className="ch">
                <span className="ct">🚨 Deudas Críticas</span>
                <span className="bg bg-r">{deudores.length} jugadores</span>
              </div>
              <p style={{ fontSize:8, color:"#e8a0a0", marginBottom:8, lineHeight:1.5 }}>
                Jugadores con 2 o más meses sin pagar. Toca 📲 para enviar recordatorio.
              </p>
              {deudores.slice(0,5).map(p => {
                const mesesPend = ACTIVE_MONTHS.filter(m => !pay[p.id]?.months?.[m]?.paid && !pay[p.id]?.months?.[m]?.exento);
                return (
                  <div key={p.id} className="pr">
                    <Avatar p={p} size={30} />
                    <div className="pi">
                      <div className="pn">{p.nombre} {p.apellido}</div>
                      <div className="ps" style={{ color:"#e8a0a0" }}>
                        {mesesPend.length} mes{mesesPend.length>1?"es":""} pendiente{mesesPend.length>1?"s":""}: {mesesPend.join(", ")}
                      </div>
                    </div>
                    <button className="btn-wa" style={{ borderColor:"rgba(229,57,53,.3)", color:"#e8a0a0", background:"rgba(229,57,53,.07)" }}
                      onClick={() => openWA(p.repTel||p.tel,
                        "⚠️ Rómulo F.C — Hola "+p.repNombre+", le recordamos que "+p.nombre+" tiene "+mesesPend.length+" mensualidades pendientes ("+mesesPend.join(", ")+"). Por favor regularizar a la brevedad. ¡Gracias!"
                      )}>📲</button>
                  </div>
                );
              })}
              {deudores.length > 5 && (
                <div style={{ fontSize:8, color:"#4e6a88", textAlign:"center", marginTop:6 }}>
                  +{deudores.length-5} más — ver en Pagos
                </div>
              )}
            </div>
          )}

          {/* ── Notas recientes ── */}
          {conNotas > 0 && (
            <div className="card" style={{ marginBottom:8 }}>
              <div className="ch">
                <span className="ct">📝 Notas de Jugadores</span>
                <span className="bg bg-b">{conNotas}</span>
              </div>
              {myPlayers.filter(p => p.notas?.trim()).slice(0,3).map(p => (
                <div key={p.id} className="pr" style={{ alignItems:"flex-start" }}>
                  <Avatar p={p} size={28} />
                  <div className="pi">
                    <div className="pn" style={{ fontSize:10 }}>{p.nombre} {p.apellido}</div>
                    <div className="ps" style={{ fontStyle:"italic" }}>"{p.notas}"</div>
                  </div>
                </div>
              ))}
              {conNotas > 3 && (
                <div style={{ fontSize:8, color:"#4e6a88", textAlign:"center", marginTop:6 }}>
                  +{conNotas-3} más — ver en Jugadores
                </div>
              )}
            </div>
          )}

          {/* ── Notificaciones ── */}
          {unread > 0 && (
            <div className="card">
              <div className="ch">
                <span className="ct">🔔 Notificaciones</span>
                <span className="bg bg-r">{unread}</span>
              </div>
              {notifs.filter(n => !n.read).slice(0,3).map(n => (
                <div key={n.id} className="notif-row" onClick={() => {
                  updateDoc(doc(db, "notifs", n.id), { read: true });
                  if (n.link) { setTab(n.link); setShowNotif(false); }
                }}>
                  <span style={{ width:6,height:6,borderRadius:"50%",background:"#2196F3",flexShrink:0,marginTop:5,display:"block" }}/>
                  <div>
                    <div style={{ fontSize:10.5 }}>{n.txt}</div>
                    <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>{timeAgo(n.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Cumpleaños ── */}
          {(() => {
            const hoy = new Date();
            const dd  = hoy.getDate(), mm = hoy.getMonth()+1;
            const hoyBd = myPlayers.filter(p => {
              if (!p.dob) return false;
              const d = new Date(p.dob);
              return d.getDate()===dd && (d.getMonth()+1)===mm;
            });
            const prox7 = myPlayers.filter(p => {
              if (!p.dob) return false;
              const d = new Date(p.dob);
              const bd = new Date(hoy.getFullYear(), d.getMonth(), d.getDate());
              if (bd <= hoy) bd.setFullYear(hoy.getFullYear()+1);
              const diff = (bd - hoy) / 86400000;
              return diff > 0 && diff <= 7;
            }).sort((a,b) => {
              const da=new Date(a.dob), db2=new Date(b.dob);
              const ba=new Date(hoy.getFullYear(),da.getMonth(),da.getDate());
              const bb=new Date(hoy.getFullYear(),db2.getMonth(),db2.getDate());
              if(ba<=hoy) ba.setFullYear(hoy.getFullYear()+1);
              if(bb<=hoy) bb.setFullYear(hoy.getFullYear()+1);
              return ba-bb;
            });
            if (hoyBd.length===0 && prox7.length===0) return null;
            return (
              <div className="card" style={{ marginBottom:8, border:"1px solid rgba(212,184,74,.2)", background:"rgba(212,184,74,.03)" }}>
                <div className="ch">
                  <span className="ct">🎂 Cumpleaños</span>
                  {hoyBd.length > 0 && (
                    <button className="btn-sm" style={{ fontSize:8, padding:"4px 8px", color:"#d4b84a",
                      background:"rgba(212,184,74,.1)", borderColor:"rgba(212,184,74,.3)" }}
                      onClick={() => {
                        hoyBd.forEach((p,i) => setTimeout(() => {
                          const msg = "🎂 ¡Feliz cumpleaños "+p.nombre+"! El equipo Rómulo F.C te desea un excelente día 🎉⚽";
                          const msgRep = "🎂 Hola "+p.repNombre+", hoy cumple años "+p.nombre+" "+p.apellido+". ¡El equipo Rómulo F.C le desea un excelente día! 🎉";
                          if (p.tel) openWA(p.tel, msg);
                          setTimeout(() => { if (p.repTel) openWA(p.repTel, msgRep); }, 800);
                        }, i*1800));
                      }}>📲 Enviar a todos</button>
                  )}
                </div>
                {hoyBd.map(p => (
                  <div key={p.id} className="pr">
                    <Avatar p={p} size={32} />
                    <div className="pi">
                      <div className="pn">{p.nombre} {p.apellido}</div>
                      <div className="ps" style={{ color:"#d4b84a" }}>🎉 Hoy cumple {calcAge(p.dob)} años · {p.cat}</div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                      {p.tel    && <button className="btn-wa" style={{ fontSize:7.5, padding:"3px 6px" }} onClick={() => openWA(p.tel,    "🎂 ¡Feliz cumpleaños "+p.nombre+"! El equipo Rómulo F.C te desea un excelente día 🎉⚽")}>📲 Jugador</button>}
                      {p.repTel && <button className="btn-wa" style={{ fontSize:7.5, padding:"3px 6px" }} onClick={() => openWA(p.repTel, "🎂 Hola "+p.repNombre+", hoy cumple años "+p.nombre+" "+p.apellido+". ¡El equipo Rómulo F.C le desea un excelente día! 🎉")}>📲 Rep.</button>}
                    </div>
                  </div>
                ))}
                {prox7.length > 0 && (
                  <>
                    <div style={{ fontSize:8, color:"#3a5068", margin:"6px 0 4px", textTransform:"uppercase", letterSpacing:.5 }}>Próximos 7 días</div>
                    {prox7.map(p => {
                      const d=new Date(p.dob);
                      const bd=new Date(hoy.getFullYear(),d.getMonth(),d.getDate());
                      if(bd<=hoy) bd.setFullYear(hoy.getFullYear()+1);
                      const dias=Math.ceil((bd-hoy)/86400000);
                      return (
                        <div key={p.id} className="pr">
                          <Avatar p={p} size={28} />
                          <div className="pi">
                            <div className="pn" style={{ fontSize:10 }}>{p.nombre} {p.apellido}</div>
                            <div className="ps">{p.cat} · en {dias} día{dias>1?"s":""} · cumplirá {calcAge(p.dob)+1} años</div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })()}
        </>
      );
    }

    // ── AGENDA / CALENDARIO ─────────────────
    if (tab === "agenda") {
      const MESES_N = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
      const DIAS_S  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

      // Parsear fecha "DD Mon YYYY", "DD Mon", o "YYYY-MM-DD" a Date
      function parseEventDate(dateStr) {
        if (!dateStr) return null;
        // Formato ISO YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
          const [y,m,d] = dateStr.trim().split("-").map(Number);
          return new Date(y, m-1, d);
        }
        const meses = { Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11,
          Enero:0,Febrero:1,Marzo:2,Abril:3,Mayo:4,Junio:5,Julio:6,Agosto:7,Septiembre:8,Octubre:9,Noviembre:10,Diciembre:11 };
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length >= 2) {
          const dd  = parseInt(parts[0]);
          const mm  = meses[parts[1]];
          const yy  = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
          if (!isNaN(dd) && mm !== undefined) return new Date(yy, mm, dd);
        }
        return null;
      }

      // Recopilar todos los eventos con fecha
      function getEventosDelDia(date) {
        const eventos = [];
        const dd = date.getDate(), mm = date.getMonth(), yy = date.getFullYear();
        function sameDay(d) { return d && d.getDate()===dd && d.getMonth()===mm && d.getFullYear()===yy; }

        // Partidos
        matches.forEach(m => {
          const d = parseEventDate(m.date);
          if (sameDay(d)) eventos.push({ tipo:"partido", color: m.status==="finalizado"?"#1565C0":"#2196F3",
            icon:"⚽", label: m.home+" vs "+m.away, sub: m.status==="finalizado"? m.scoreH+"-"+m.scoreA : m.time, data:m });
        });

        // Entrenamientos
        trainings.forEach(t => {
          const d = parseEventDate(t.date || t.fecha);
          if (sameDay(d)) eventos.push({ tipo:"entreno", color:"#1976D2", icon:"🏃",
            label: t.tema || "Entrenamiento", sub: (t.cat||"")+" · "+(t.time||t.hora||""), data:t });
        });

        // Torneos externos
        (clubConfig?.torneos||[]).forEach(t => {
          const d = parseEventDate(t.fecha);
          if (sameDay(d)) eventos.push({ tipo:"torneo", color:"#d4b84a", icon:"🌍",
            label: t.nombre, sub: t.lugar||"", data:t });
        });

        // Cumpleaños
        players.forEach(p => {
          if (!p.dob) return;
          const bd = new Date(p.dob);
          if (bd.getDate()===dd && bd.getMonth()===mm)
            eventos.push({ tipo:"bday", color:"#E53935", icon:"🎂",
              label: p.nombre+" "+p.apellido, sub: "Cumple "+(yy-bd.getFullYear())+" años", data:p });
        });

        return eventos;
      }

      // ── VISTA MENSUAL ──
      function renderMensual() {
        const primerDia = new Date(agendaAnio, agendaMes, 1).getDay();
        const diasMes   = new Date(agendaAnio, agendaMes+1, 0).getDate();
        const hoy       = new Date();
        const celdas    = [];
        for (let i=0; i<primerDia; i++) celdas.push(null);
        for (let d=1; d<=diasMes; d++) celdas.push(d);

        return (
          <div>
            {/* Navegación mes */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <button className="btn-sm" onClick={() => {
                if (agendaMes===0) { setAgendaMes(11); setAgendaAnio(agendaAnio-1); }
                else setAgendaMes(agendaMes-1);
              }}>‹</button>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", letterSpacing:1 }}>
                {MESES_N[agendaMes]} {agendaAnio}
              </div>
              <button className="btn-sm" onClick={() => {
                if (agendaMes===11) { setAgendaMes(0); setAgendaAnio(agendaAnio+1); }
                else setAgendaMes(agendaMes+1);
              }}>›</button>
            </div>
            {/* Cabecera días */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
              {DIAS_S.map(d=><div key={d} style={{ textAlign:"center", fontSize:7.5, color:"#3a5068", fontWeight:600, padding:"3px 0" }}>{d}</div>)}
            </div>
            {/* Cuadrícula */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
              {celdas.map((d,i) => {
                if (!d) return <div key={"e"+i}/>;
                const date   = new Date(agendaAnio, agendaMes, d);
                const evs    = getEventosDelDia(date);
                const esHoy  = d===hoy.getDate() && agendaMes===hoy.getMonth() && agendaAnio===hoy.getFullYear();
                const selec  = agendaDia && agendaDia.getDate()===d && agendaDia.getMonth()===agendaMes;
                return (
                  <div key={d} onClick={() => setAgendaDia(selec ? null : date)}
                    style={{ minHeight:44, borderRadius:6, padding:"3px 2px", cursor:"pointer",
                      background: selec?"rgba(21,101,192,.25)": esHoy?"rgba(21,101,192,.12)":"rgba(255,255,255,.02)",
                      border: `1px solid ${selec?"rgba(33,150,243,.5)":esHoy?"rgba(33,150,243,.3)":"rgba(255,255,255,.03)"}`,
                      display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
                    <div style={{ fontSize:9, fontWeight: esHoy?700:400, color: esHoy?"#7ab3e0":"#8a9ab0" }}>{d}</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:1, justifyContent:"center" }}>
                      {evs.slice(0,3).map((e,ei)=>(
                        <div key={ei} style={{ width:5, height:5, borderRadius:"50%", background:e.color }}/>
                      ))}
                      {evs.length>3 && <div style={{ fontSize:6, color:"#4e6a88" }}>+{evs.length-3}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // ── VISTA SEMANAL ──
      function renderSemanal() {
        const hoy    = new Date();
        const lunes  = new Date(hoy);
        lunes.setDate(hoy.getDate() - ((hoy.getDay()||7)-1) + agendaSemana*7);
        const dias   = Array.from({length:7},(_,i) => {
          const d = new Date(lunes); d.setDate(lunes.getDate()+i); return d;
        });
        return (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana-1)}>‹ Sem ant.</button>
              <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600 }}>
                {dias[0].getDate()} {MESES_N[dias[0].getMonth()].slice(0,3)} – {dias[6].getDate()} {MESES_N[dias[6].getMonth()].slice(0,3)}
              </div>
              <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana+1)}>Sig. sem ›</button>
            </div>
            <div style={{ display:"flex", gap:4, overflowX:"auto", paddingBottom:4 }}>
              {dias.map((date,i) => {
                const evs    = getEventosDelDia(date);
                const esHoy  = date.toDateString()===new Date().toDateString();
                const selec  = agendaDia && agendaDia.toDateString()===date.toDateString();
                return (
                  <div key={i} onClick={()=>setAgendaDia(selec?null:date)}
                    style={{ flex:"0 0 calc(14.28% - 4px)", minHeight:80, borderRadius:8, padding:"5px 3px",
                      background: selec?"rgba(21,101,192,.25)":esHoy?"rgba(21,101,192,.1)":"rgba(255,255,255,.02)",
                      border:`1px solid ${selec?"rgba(33,150,243,.5)":esHoy?"rgba(33,150,243,.3)":"rgba(255,255,255,.03)"}`,
                      cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <div style={{ fontSize:7.5, color:"#3a5068", fontWeight:600 }}>{DIAS_S[date.getDay()]}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:esHoy?"#7ab3e0":"#8a9ab0" }}>{date.getDate()}</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:2, width:"100%" }}>
                      {evs.slice(0,3).map((e,ei)=>(
                        <div key={ei} style={{ borderRadius:3, padding:"1px 3px", background:e.color+"22",
                          borderLeft:`2px solid ${e.color}`, fontSize:6.5, color:"var(--txt)", lineHeight:1.3,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {e.icon} {e.label}
                        </div>
                      ))}
                      {evs.length>3 && <div style={{ fontSize:6, color:"#4e6a88", textAlign:"center" }}>+{evs.length-3} más</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // ── DETALLE DEL DÍA ──
      function renderDetalleDia() {
        if (!agendaDia) return null;
        const evs = getEventosDelDia(agendaDia);
        const MESES_C = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
        return (
          <div className="card" style={{ marginTop:10, border:"1px solid rgba(33,150,243,.15)" }}>
            <div className="ch">
              <span className="ct">📋 {agendaDia.getDate()} de {MESES_C[agendaDia.getMonth()]}</span>
              <span className="mx" style={{ cursor:"pointer" }} onClick={()=>setAgendaDia(null)}>✕</span>
            </div>
            {evs.length===0 && (
              <div style={{ fontSize:9, color:"#3a5068", textAlign:"center", padding:"12px 0" }}>Sin actividades este día</div>
            )}
            {evs.map((e,i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"7px 0",
                borderBottom:"1px solid rgba(255,255,255,.03)", alignItems:"center" }}>
                <div style={{ width:3, height:36, borderRadius:2, background:e.color, flexShrink:0 }}/>
                <div style={{ fontSize:16 }}>{e.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, fontWeight:600 }}>{e.label}</div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>{e.sub}</div>
                </div>
                <span className="bg" style={{ fontSize:7, background:e.color+"22", color:e.color, border:`1px solid ${e.color}44` }}>
                  {e.tipo==="partido"?"Partido":e.tipo==="entreno"?"Entreno":e.tipo==="torneo"?"Torneo":"🎂 Cumple"}
                </span>
              </div>
            ))}
          </div>
        );
      }

      return (
        <>
          <div className="st">📆 Agenda</div>
          {/* Selector de vista */}
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {[["mensual","📅 Mensual"],["semanal","📋 Semanal"]].map(([k,l])=>(
              <button key={k} className={"btn-sm"+(agendaVista===k?" ":" ")}
                style={{ flex:1, fontSize:10,
                  background: agendaVista===k?"rgba(33,150,243,.2)":"rgba(255,255,255,.03)",
                  color: agendaVista===k?"#7ab3e0":"#4e6a88",
                  borderColor: agendaVista===k?"rgba(33,150,243,.4)":"rgba(255,255,255,.05)" }}
                onClick={()=>setAgendaVista(k)}>{l}</button>
            ))}
          </div>
          {/* Leyenda */}
          <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
            {[["⚽","#2196F3","Partidos"],["🏃","#1976D2","Entrenos"],["🌍","#d4b84a","Torneos"],["🎂","#E53935","Cumpleaños"]].map(([ic,col,lb])=>(
              <div key={lb} style={{ display:"flex", alignItems:"center", gap:3, fontSize:7.5, color:"#4e6a88" }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:col }}/>{lb}
              </div>
            ))}
          </div>
          {agendaVista==="mensual" ? renderMensual() : renderSemanal()}
          {renderDetalleDia()}
        </>
      );
    }

    // ── JUGADORES ───────────────────────────
    if (tab === "jugadores") {
      // Filtro adicional por año de nacimiento
      const filtPConAno = anoFiltro
        ? filtP.filter(p => p.dob && String(new Date(p.dob).getFullYear()) === anoFiltro)
        : filtP;

      return (
        <>
          <div className="st">👥 Jugadores</div>

          {/* Tabs categoría */}
          <div className="dtabs">
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt" + (catF===c ? " da" : "")} onClick={() => { setCatF(c); setAnoFiltro(""); }}>{c}</div>
            ))}
          </div>

          {/* Tabla de años por categoría */}
          <div style={{ background:"rgba(21,101,192,.06)", border:"1px solid rgba(33,150,243,.1)",
            borderRadius:10, padding:"8px 10px", marginBottom:8 }}>
            <div style={{ fontSize:7.5, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:6 }}>
              📅 Años por categoría ({new Date().getFullYear()})
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {CATS.map(cat => {
                const [min,max] = CAT_RANGES[cat];
                return (
                  <div key={cat} style={{ background:"rgba(21,101,192,.1)", borderRadius:6,
                    padding:"4px 8px", border:"1px solid rgba(33,150,243,.15)" }}>
                    <span style={{ fontSize:8, fontWeight:700, color:"#7ab3e0" }}>{cat}</span>
                    <span style={{ fontSize:7.5, color:"#4e6a88", marginLeft:4 }}>{min}–{max}</span>
                  </div>
                );
              })}
            </div>
            {/* Filtro por año específico */}
            <div style={{ marginTop:7, display:"flex", gap:3, flexWrap:"wrap" }}>
              <button className="btn-sm"
                style={{ fontSize:7, padding:"2px 7px",
                  background:!anoFiltro?"rgba(212,184,74,.2)":"rgba(255,255,255,.03)",
                  color:!anoFiltro?"#d4b84a":"#4e6a88",
                  borderColor:!anoFiltro?"rgba(212,184,74,.4)":"rgba(255,255,255,.05)" }}
                onClick={()=>setAnoFiltro("")}>Todos</button>
              {(() => {
                const years = new Set(filtP.map(p => p.dob ? new Date(p.dob).getFullYear() : null).filter(Boolean));
                return [...years].sort((a,b)=>b-a).map(y => {
                  const cat = getCatByYear(y);
                  return (
                    <button key={y} className="btn-sm"
                      style={{ fontSize:7, padding:"2px 7px",
                        background:anoFiltro===String(y)?"rgba(33,150,243,.25)":"rgba(255,255,255,.03)",
                        color:anoFiltro===String(y)?"#7ab3e0":"#4e6a88",
                        borderColor:anoFiltro===String(y)?"rgba(33,150,243,.4)":"rgba(255,255,255,.05)" }}
                      onClick={()=>setAnoFiltro(String(y))}>
                      {y}{cat ? <span style={{ color:"#d4b84a", marginLeft:2 }}>({cat})</span> : ""}
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          <input className="inp" style={{ marginBottom:8 }} placeholder="🔍 Buscar..."
            value={search} onChange={e => setSearch(e.target.value)}
          />

          {can("jugadores") && (
            <div style={{ display:"flex", gap:6, marginBottom:9 }}>
              <button className="btn" style={{ flex:1 }} onClick={() => { setShowAdd(true); setFormErr(""); setAddOk(false); }}>
                + Agregar Jugador
              </button>
              <button className="btn-sm" style={{ background:"rgba(33,150,243,.1)", color:"#7ab3e0", padding:"8px 12px", fontSize:9 }}
                onClick={() => setShowCsvImport(true)}>
                📥 Importar CSV
              </button>
              <button className="btn-sm"
                style={{ padding:"8px 12px", fontSize:9,
                  background: bulkMode?"rgba(212,184,74,.2)":"rgba(255,255,255,.03)",
                  color: bulkMode?"#d4b84a":"#4e6a88",
                  borderColor: bulkMode?"rgba(212,184,74,.4)":"rgba(255,255,255,.05)" }}
                onClick={() => { setBulkMode(!bulkMode); setBulkSel([]); setBulkVal({}); }}>
                {bulkMode ? "✕ Cancelar" : "✏️ Masivo"}
              </button>
            </div>
          )}

          {/* Panel de edición masiva */}
          {bulkMode && (
            <div style={{ background:"rgba(212,184,74,.07)", border:"1px solid rgba(212,184,74,.25)",
              borderRadius:10, padding:"12px", marginBottom:10 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#d4b84a", marginBottom:8 }}>
                ✏️ Edición Masiva — {bulkSel.length} jugador{bulkSel.length!==1?"es":""} seleccionado{bulkSel.length!==1?"s":""}
              </div>

              {/* Selector de acción */}
              <div style={{ display:"flex", gap:5, marginBottom:10 }}>
                {[["cat","📂 Categoría"],["uniforme","👕 Uniforme"]].map(([k,l])=>(
                  <button key={k} className="btn-sm"
                    style={{ flex:1, fontSize:8.5,
                      background:bulkAction===k?"rgba(33,150,243,.2)":"rgba(255,255,255,.03)",
                      color:bulkAction===k?"#7ab3e0":"#4e6a88",
                      borderColor:bulkAction===k?"rgba(33,150,243,.35)":"rgba(255,255,255,.05)" }}
                    onClick={()=>{ setBulkAction(k); setBulkVal({}); }}>{l}</button>
                ))}
              </div>

              {/* Campos según acción */}
              {bulkAction==="cat" && (
                <div className="inp-wrap" style={{ marginBottom:8 }}>
                  <div className="inp-lbl">Nueva categoría</div>
                  <select className="inp" value={bulkVal.cat||""} onChange={e=>setBulkVal({cat:e.target.value})}>
                    <option value="">— Seleccionar —</option>
                    {CATS.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {bulkAction==="uniforme" && (
                <div className="inp-2" style={{ marginBottom:8 }}>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Talla</div>
                    <select className="inp" value={bulkVal.talla||""} onChange={e=>setBulkVal(v=>({...v,talla:e.target.value}))}>
                      <option value="">— Sin cambio —</option>
                      {["XS","S","M","L","XL","XXL"].map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">N° Camiseta</div>
                    <input className="inp" type="number" min="1" max="99" placeholder="Ej: 10"
                      value={bulkVal.num||""} onChange={e=>setBulkVal(v=>({...v,num:e.target.value}))}/>
                  </div>
                </div>
              )}

              {/* Botones seleccionar todos / aplicar */}
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn-sm" style={{ flex:1, fontSize:8 }}
                  onClick={()=> bulkSel.length===filtPConAno.length ? setBulkSel([]) : setBulkSel(filtPConAno.map(p=>p.id))}>
                  {bulkSel.length===filtPConAno.length ? "✕ Deseleccionar todos" : "☑ Seleccionar todos"}
                </button>
                <button className="btn" style={{ flex:2,
                  opacity: (bulkSel.length===0 || (bulkAction==="cat"&&!bulkVal.cat) || (bulkAction==="uniforme"&&!bulkVal.talla&&!bulkVal.num)) ? 0.4 : 1 }}
                  onClick={() => {
                    if (bulkSel.length===0) return;
                    const updates = {};
                    if (bulkAction==="cat" && bulkVal.cat) {
                      bulkSel.forEach(id => { updates[id]={cat:bulkVal.cat}; });
                    } else if (bulkAction==="uniforme") {
                      bulkSel.forEach(id => {
                        const upd = {};
                        if (bulkVal.talla) upd.talla = bulkVal.talla;
                        if (bulkVal.num)   upd.num   = parseInt(bulkVal.num)||0;
                        updates[id] = upd;
                      });
                    }
                    setConf({
                      title:"EDICIÓN MASIVA",
                      msg:`¿Aplicar cambios a ${bulkSel.length} jugador${bulkSel.length!==1?"es":""}?`,
                      okTxt:"Aplicar",
                      ok: () => {
                        Object.entries(updates).forEach(([id, upd]) => {
                          const pl = players.find(x=>String(x.id)===String(id));
                          if (!pl) return;
                          safeSetDoc(doc(db,"players",String(id)), { ...pl, ...upd });
                        });
                        setBulkMode(false); setBulkSel([]); setBulkVal({});
                      }
                    });
                  }}>
                  ✅ APLICAR A {bulkSel.length} JUGADOR{bulkSel.length!==1?"ES":""}
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="ch">
              <span className="ct">Lista</span>
              <span className="bg bg-b">{filtPConAno.length}</span>
            </div>
            {filtPConAno.map(p => {
              const y = sanc[p.id] && sanc[p.id].yellows > 0;
              const r = sanc[p.id] && sanc[p.id].suspended;
              const isBulkSel = bulkSel.includes(p.id);
              const anoNac = p.dob ? new Date(p.dob).getFullYear() : null;
              const catSugerida = anoNac ? getCatByYear(anoNac) : null;
              return (
                <div key={p.id} className="pr" style={{ alignItems:"flex-start",
                  background: isBulkSel ? "rgba(212,184,74,.06)" : "transparent",
                  border: isBulkSel ? "1px solid rgba(212,184,74,.2)" : "1px solid transparent",
                  borderRadius: isBulkSel ? 8 : 0, marginBottom: isBulkSel ? 4 : 0 }}>
                  {/* Checkbox modo masivo */}
                  {bulkMode && (
                    <div onClick={()=> setBulkSel(sel => sel.includes(p.id) ? sel.filter(x=>x!==p.id) : [...sel, p.id])}
                      style={{ width:22, height:22, borderRadius:5, flexShrink:0, marginRight:4, marginTop:2,
                        background: isBulkSel?"#1565C0":"rgba(255,255,255,.04)",
                        border:`2px solid ${isBulkSel?"#2196F3":"rgba(255,255,255,.15)"}`,
                        display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                      {isBulkSel && <span style={{ color:"#fff", fontSize:12, fontWeight:700 }}>✓</span>}
                    </div>
                  )}
                  <Avatar p={p} size={30} />
                  <div className="pi">
                    <div className="pn">
                      {p.nombre} {p.apellido}
                      {y && " 🟨"}{r && " 🟥"}
                      {/* Badge año y categoría sugerida */}
                      {anoNac && (
                        <span style={{ fontSize:7, marginLeft:5, color:"#4e6a88" }}>{anoNac}</span>
                      )}
                      {catSugerida && catSugerida !== p.cat && (
                        <span style={{ fontSize:7, marginLeft:3, color:"#E53935", background:"rgba(229,57,53,.1)",
                          padding:"1px 4px", borderRadius:3 }}>→{catSugerida}</span>
                      )}
                    </div>
                    <div className="ps">{p.cat}{p.subequipo ? <span style={{ color:"#d4b84a", fontWeight:600 }}> · Equipo {p.subequipo}</span> : ""} · #{p.num} · {calcAge(p.dob)} años · CI: {p.cedula || "—"}</div>

                    <div className="ps">📞 {p.tel}</div>
                    <div className="ps">Rep: {p.repNombre} {p.repApellido} · CI: {p.repCedula || "—"} · {p.repTel}</div>
                    {p.notas && <div className="ps" style={{ fontStyle:"italic", color:"#d4b84a" }}>📝 {p.notas}</div>}
                    <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                      <button className="btn-wa" onClick={() => openWA(p.repTel, "Hola " + p.repNombre + ", mensaje de Rómulo FC sobre " + p.nombre + ".")}>📲 WA Rep.</button>
                      <button className="btn-sm" onClick={() => generatePermisoEscolar(p)}>📄 Permiso</button>
                      <button className="btn-sm" style={{ background:"rgba(212,184,74,.1)", color:"#d4b84a", borderColor:"rgba(212,184,74,.3)" }}
                        onClick={() => generatePerfilPdf(p, pay, att, matches, attMatches, sanc)}>
                        Perfil 📝
                      </button>
                      {can("jugadores") && (
                        <button className="btn-sm" style={{ background:"rgba(33,150,243,.12)", color:"#7ab3e0" }}
                          onClick={() => {
                            setEditPid(p.id);
                            setNp({ ...p, num: String(p.num) });
                            setFormErr(""); setAddOk(false);
                            setShowAdd(true);
                          }}>✏️ Editar</button>
                      )}
                      {can("jugadores") && (
                        <button className="btn-sm" style={{ background:"rgba(212,184,74,.1)", color:"#d4b84a", borderColor:"rgba(212,184,74,.3)" }}
                          onClick={() => {
                            setStatsEditModal(p);
                            setStatsEdit({
                              goles:       p.stats?.goles       || 0,
                              asistencias: p.stats?.asistencias || 0,
                              partidos:    p.stats?.partidos    || 0,
                              mvps:        matches.filter(m=>m.mvp?.playerId===p.id).length,
                              yellows:     sanc[p.id]?.yellows  || 0,
                              reds:        sanc[p.id]?.reds     || 0,
                            });
                          }}>📊 Stats</button>
                      )}
                      {r && can("jugadores") && (
                        <button className="btn-sm" onClick={() => safeSetDoc(doc(db,"sanc",String(p.id)), { ...sanc[p.id], suspended:false })}>
                          Habilitar
                        </button>
                      )}
                      {can("jugadores") && (
                        <button className="btn-sm" onClick={() => setConf({
                          title:"ELIMINAR JUGADOR", danger:true, okTxt:"Eliminar",
                          msg:"¿Eliminar a " + p.nombre + " " + p.apellido + "?",
                          ok: () => {
                            safeDeleteDoc(doc(db, "players", String(p.id)));
                            safeDeleteDoc(doc(db, "pay",     String(p.id)));
                            safeDeleteDoc(doc(db, "sanc",    String(p.id)));
                            safeDeleteDoc(doc(db, "att",     String(p.id)));
                          }
                        })}>🗑 Eliminar</button>
                      )}
                    </div>
                    {/* Historial partidos en ficha admin */}
                    {(() => {
                      const pMatches = matches
                        .filter(m => m.status==="finalizado" && m.cat===p.cat)
                        .sort((a,b) => b.id - a.id)
                        .slice(0,5);
                      if (pMatches.length===0) return null;
                      return (
                        <div style={{ marginTop:8, background:"var(--card)", borderRadius:8, padding:"7px 9px",
                          border:"1px solid rgba(33,150,243,.07)" }}>
                          <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:5 }}>
                            ⚽ Últimos 5 partidos
                          </div>
                          {pMatches.map(m => {
                            const attM    = attMatches.find(a=>a.matchId===m.id);
                            const conv    = attM?.convocados?.includes(p.id);
                            const tit     = attM?.titulares?.includes(p.id);
                            const ps      = m.playerStats?.[p.id] || {};
                            const esMvp   = m.mvp?.playerId === p.id;
                            const esCasa  = m.home==="Rómulo FC"||m.home?.includes("Rómulo");
                            const gRFC    = esCasa ? m.scoreH : m.scoreA;
                            const gRiv    = esCasa ? m.scoreA : m.scoreH;
                            const res     = gRFC>gRiv?"V":gRFC<gRiv?"D":"E";
                            const resCol  = res==="V"?"#2196F3":res==="D"?"#E53935":"#d4b84a";
                            return (
                              <div key={m.id} style={{ display:"flex", alignItems:"center", gap:6,
                                padding:"4px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                                <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14,
                                  color:resCol, width:14, flexShrink:0 }}>{res}</span>
                                <div style={{ flex:1, fontSize:8.5 }}>
                                  {m.home} {m.scoreH}–{m.scoreA} {m.away}
                                  <span style={{ fontSize:7.5, color:"#4e6a88" }}> · {m.date}</span>
                                </div>
                                <div style={{ display:"flex", gap:3 }}>
                                  {esMvp && <span className="bg bg-y" style={{ fontSize:6.5 }}>🏅</span>}
                                  {conv ? <span className="bg bg-b" style={{ fontSize:6.5 }}>{tit?"T":"S"}</span>
                                         : <span className="bg bg-n" style={{ fontSize:6.5 }}>NC</span>}
                                  {(ps.goles>0) && <span className="bg bg-b" style={{ fontSize:6.5 }}>⚽{ps.goles}</span>}
                                  {(ps.asistencias>0) && <span className="bg bg-n" style={{ fontSize:6.5 }}>🎯{ps.asistencias}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          {showAdd && (
            <div className="ov" onClick={e => { if (e.target.className === "ov") { setShowAdd(false); setEditPid(null); setNp(NP_BLANK); } }}>
              <div className="modal">
                <div className="mt2">
                  {editPid ? "✏️ Editar Jugador" : "Nuevo Jugador"}
                  <span className="mx" onClick={() => { setShowAdd(false); setEditPid(null); setNp(NP_BLANK); }}>✕</span>
                </div>
                <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
                  <div className="photo-up" onClick={() => photoRef.current && photoRef.current.click()}>
                    {np.foto ? <img src={np.foto} alt="" /> : "📷"}
                  </div>
                  <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e => {
                      const f = e.target.files && e.target.files[0];
                      if (!f) return;
                      const rdr = new FileReader();
                      rdr.onload = ev => setNp(n => ({ ...n, foto: ev.target.result }));
                      rdr.readAsDataURL(f);
                    }}
                  />
                </div>
                <div className="fsec">Datos del Jugador</div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Nombres *</div>
                    <input className="inp" placeholder="Nombres" value={np.nombre} onChange={e => setNp(n => ({ ...n, nombre:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Apellidos *</div>
                    <input className="inp" placeholder="Apellidos" value={np.apellido} onChange={e => setNp(n => ({ ...n, apellido:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Cédula de Identidad *</div>
                  <input className="inp" placeholder="Ej: V-28100001" value={np.cedula} onChange={e => setNp(n => ({ ...n, cedula:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Fecha de Nacimiento *</div>
                  <input className="inp" type="date" value={np.dob} onChange={e => setNp(n => ({ ...n, dob:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Teléfono</div>
                  <input className="inp" placeholder="04XX-XXXXXXX" value={np.tel} onChange={e => setNp(n => ({ ...n, tel:e.target.value }))} />
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Categoría</div>
                    <select className="inp" value={np.cat} onChange={e => setNp(n => ({ ...n, cat:e.target.value }))}>
                      {CATS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Camiseta #</div>
                    <input className="inp" placeholder="10" value={np.num} onChange={e => setNp(n => ({ ...n, num:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">⚽ Equipo de referencia <span style={{ color:"#3a5068", fontWeight:400 }}>(opcional)</span></div>
                  <input className="inp" placeholder="Ej: 17A, 17B — dejar vacío si no aplica"
                    value={np.subequipo||""}
                    onChange={e => setNp(n => ({ ...n, subequipo:e.target.value }))} />
                </div>

                <div className="div" />
                <div className="fsec">Representante</div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Nombres</div>
                    <input className="inp" placeholder="Nombres" value={np.repNombre} onChange={e => setNp(n => ({ ...n, repNombre:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Apellidos</div>
                    <input className="inp" placeholder="Apellidos" value={np.repApellido} onChange={e => setNp(n => ({ ...n, repApellido:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Cédula del Representante *</div>
                  <input className="inp" placeholder="Ej: V-12000001" value={np.repCedula} onChange={e => setNp(n => ({ ...n, repCedula:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Teléfono WhatsApp</div>
                  <input className="inp" placeholder="04XX-XXXXXXX" value={np.repTel} onChange={e => setNp(n => ({ ...n, repTel:e.target.value }))} />
                </div>
                {formErr && <div className="err">⚠️ {formErr}</div>}
                {addOk   && <div className="ok">{editPid ? "✅ Jugador actualizado" : "✅ Jugador registrado exitosamente"}</div>}
                <div className="inp-wrap">
                  <div className="inp-lbl">📝 Notas / Observaciones</div>
                  <input className="inp" placeholder="Ej: Lesión rodilla, buen rendimiento, etc." value={np.notas||""} onChange={e => setNp(n => ({ ...n, notas:e.target.value }))} />
                </div>
                <div className="div" />
                <div className="fsec">🏥 Ficha Médica</div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Tipo de sangre</div>
                    <select className="inp" value={np.sangre||""} onChange={e => setNp(n => ({ ...n, sangre:e.target.value }))}>
                      <option value="">— —</option>
                      {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Contacto emergencia</div>
                    <input className="inp" placeholder="04XX-XXXXXXX" value={np.telEmergencia||""} onChange={e => setNp(n => ({ ...n, telEmergencia:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Alergias</div>
                  <input className="inp" placeholder="Ej: Penicilina, mariscos — dejar vacío si ninguna" value={np.alergias||""} onChange={e => setNp(n => ({ ...n, alergias:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Condiciones médicas</div>
                  <input className="inp" placeholder="Ej: Asma, diabetes — dejar vacío si ninguna" value={np.condiciones||""} onChange={e => setNp(n => ({ ...n, condiciones:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Medicamentos actuales</div>
                  <input className="inp" placeholder="Ej: Ventolín — dejar vacío si ninguno" value={np.medicamentos||""} onChange={e => setNp(n => ({ ...n, medicamentos:e.target.value }))} />
                </div>
                <div className="div" />
                <div className="fsec">⭐ Evaluación Técnica</div>
                <div style={{ fontSize:8, color:"#4e6a88", marginBottom:8 }}>Califica del 1 al 10 cada aspecto. Solo visible para entrenadores.</div>
                {[
                  ["eval_velocidad",   "⚡ Velocidad"],
                  ["eval_tecnica",     "🎯 Técnica"],
                  ["eval_tactica",     "🧠 Táctica"],
                  ["eval_fisico",      "💪 Físico"],
                  ["eval_actitud",     "❤️ Actitud"],
                  ["eval_trabajo",     "🤝 Trabajo en equipo"],
                ].map(([key, label]) => (
                  <div key={key} className="inp-wrap">
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                      <div className="inp-lbl" style={{ marginBottom:0 }}>{label}</div>
                      <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#d4b84a" }}>
                        {np[key] || "—"}
                      </span>
                    </div>
                    <input type="range" min="1" max="10" step="1"
                      value={np[key] || 5}
                      onChange={e => setNp(n => ({ ...n, [key]: parseInt(e.target.value) }))}
                      style={{ width:"100%", accentColor:"#1565C0", cursor:"pointer" }} />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:7, color:"#3a5068", marginTop:1 }}>
                      <span>1 Bajo</span><span>5 Regular</span><span>10 Excelente</span>
                    </div>
                  </div>
                ))}
                <div className="inp-wrap">
                  <div className="inp-lbl">Comentario del evaluador</div>
                  <input className="inp" placeholder="Ej: Gran potencial, necesita mejorar definición" value={np.eval_comentario||""} onChange={e => setNp(n => ({ ...n, eval_comentario:e.target.value }))} />
                </div>
                <div className="div" />
                <div className="fsec">🩹 Historial de Lesiones</div>
                {(np.lesiones||[]).length > 0 && (
                  <div style={{ marginBottom:8 }}>
                    {(np.lesiones||[]).map((l,i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"5px 8px", background:"var(--inp)", borderRadius:7, marginBottom:4,
                        border:"1px solid rgba(229,57,53,.1)" }}>
                        <div>
                          <div style={{ fontSize:10, color:"#e8a0a0" }}>🩹 {l.tipo}</div>
                          <div style={{ fontSize:8, color:"#4e6a88" }}>{l.fecha} · {l.recuperacion}</div>
                          {l.notas && <div style={{ fontSize:7.5, color:"#3a5068", marginTop:1 }}>{l.notas}</div>}
                        </div>
                        <button className="btn-sm" style={{ color:"#e8a0a0", borderColor:"rgba(229,57,53,.15)" }}
                          onClick={() => setNp(n => ({ ...n, lesiones: (n.lesiones||[]).filter((_,j)=>j!==i) }))}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ background:"var(--inp)", border:"1px solid rgba(33,150,243,.08)", borderRadius:8, padding:"9px", marginBottom:8 }}>
                  <div style={{ fontSize:8, color:"#7ab3e0", fontWeight:600, marginBottom:6 }}>➕ Registrar lesión</div>
                  <div className="inp-2">
                    <div className="inp-wrap">
                      <div className="inp-lbl">Tipo de lesión</div>
                      <input className="inp" style={{ fontSize:9 }} placeholder="Ej: Esguince rodilla"
                        value={np._lTipo||""} onChange={e => setNp(n => ({ ...n, _lTipo:e.target.value }))} />
                    </div>
                    <div className="inp-wrap">
                      <div className="inp-lbl">Fecha</div>
                      <input className="inp" style={{ fontSize:9 }} type="date"
                        value={np._lFecha||""} onChange={e => setNp(n => ({ ...n, _lFecha:e.target.value }))} />
                    </div>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Tiempo de recuperación</div>
                    <input className="inp" style={{ fontSize:9 }} placeholder="Ej: 3 semanas"
                      value={np._lRecup||""} onChange={e => setNp(n => ({ ...n, _lRecup:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Observaciones</div>
                    <input className="inp" style={{ fontSize:9 }} placeholder="Ej: Evitar saltar por 2 semanas"
                      value={np._lNotas||""} onChange={e => setNp(n => ({ ...n, _lNotas:e.target.value }))} />
                  </div>
                  <button className="btn-sm" style={{ width:"100%", padding:8 }}
                    onClick={() => {
                      if (!np._lTipo || !np._lFecha) return;
                      const nueva = { tipo:np._lTipo, fecha:np._lFecha, recuperacion:np._lRecup||"N/A", notas:np._lNotas||"" };
                      setNp(n => ({ ...n, lesiones:[...(n.lesiones||[]), nueva], _lTipo:"", _lFecha:"", _lRecup:"", _lNotas:"" }));
                    }}>➕ Agregar lesión</button>
                </div>
                <button className="btn" style={{ marginTop:4 }} onClick={savePlayer}>
                  {editPid ? "💾 GUARDAR CAMBIOS" : "GUARDAR JUGADOR"}
                </button>
              </div>
            </div>
          )}

          {/* Modal importar CSV */}
          {showCsvImport && (
            <div className="ov" onClick={e => { if (e.target.className === "ov") { setShowCsvImport(false); setCsvPreview([]); setCsvErr(""); } }}>
              <div className="modal">
                <div className="mt2">📥 Importar Jugadores desde CSV
                  <span className="mx" onClick={() => { setShowCsvImport(false); setCsvPreview([]); setCsvErr(""); }}>✕</span>
                </div>

                {/* ── Descargar plantilla ── */}
                <div style={{ background:"rgba(212,184,74,.06)", border:"1px solid rgba(212,184,74,.2)", borderRadius:9, padding:"10px", marginBottom:10 }}>
                  <div style={{ fontSize:9, color:"#d4b84a", fontWeight:600, marginBottom:4 }}>📄 Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize:8, color:"#4e6a88", lineHeight:1.6, marginBottom:8 }}>
                    Descarga el archivo de ejemplo, llénalo con los datos de tus jugadores y luego impórtalo. <strong style={{ color:"var(--txt)" }}>No cambies los nombres de las columnas.</strong>
                  </div>
                  <button className="btn-sm" style={{ width:"100%", padding:9, fontSize:10, color:"#d4b84a", borderColor:"rgba(212,184,74,.3)", background:"rgba(212,184,74,.08)" }}
                    onClick={() => {
                      const plantilla = [
                        "nombre,apellido,cedula,fechaNacimiento,categoria,tel,num,repNombre,repApellido,repCedula,repTel,notas",
                        "Carlos,González,V-28100001,2009-05-14,Sub-17,04141234567,10,María,González,V-12000001,04161234567,Buen rendimiento",
                        "Luis,Martínez,V-28200002,2010-03-22,Sub-15,04241234568,7,Pedro,Martínez,V-13000002,04261234568,",
                        "Andrés,Rodríguez,V-28300003,2011-08-01,Sub-13,04141234569,5,Ana,Rodríguez,V-14000003,04161234569,Lesión rodilla recuperada"
                      ].join("\n");
                      const blob = new Blob([plantilla], { type:"text/csv;charset=utf-8;" });
                      const url  = URL.createObjectURL(blob);
                      const a    = document.createElement("a");
                      a.href     = url;
                      a.download = "plantilla_jugadores_romulo_fc.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}>
                    ⬇️ Descargar plantilla CSV
                  </button>
                </div>

                {/* ── Columnas requeridas ── */}
                <div style={{ fontSize:8, color:"#4e6a88", lineHeight:1.7, marginBottom:10, padding:"8px", background:"var(--inp)", borderRadius:7 }}>
                  <div style={{ color:"#7ab3e0", fontWeight:600, marginBottom:4 }}>📋 Paso 2 — Llena el archivo</div>
                  <div style={{ fontFamily:"monospace", fontSize:7.5, color:"#5a7a94" }}>
                    • <strong style={{ color:"var(--txt)" }}>nombre, apellido, cedula</strong> — obligatorios<br/>
                    • <strong style={{ color:"var(--txt)" }}>fechaNacimiento</strong> — formato AAAA-MM-DD<br/>
                    • <strong style={{ color:"var(--txt)" }}>categoria</strong> — Sub-11, Sub-13, Sub-15, Sub-17, Sub-19<br/>
                    • <strong style={{ color:"var(--txt)" }}>tel, num, rep*, notas</strong> — opcionales
                  </div>
                </div>

                {/* ── Seleccionar archivo ── */}
                <div style={{ fontSize:9, color:"#d4b84a", fontWeight:600, marginBottom:6 }}>📂 Paso 3 — Importa el archivo</div>
                <button className="btn" style={{ marginBottom:8 }} onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = ".csv,.txt";
                  input.onchange = e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const result = parseCSV(ev.target.result);
                      if (result.error) { setCsvErr(result.error); setCsvPreview([]); }
                      else { setCsvPreview(result.players); setCsvErr(""); }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}>📂 Seleccionar archivo CSV</button>
                {csvErr && <div className="err">⚠️ {csvErr}</div>}
                {csvPreview.length > 0 && (
                  <>
                    <div style={{ fontSize:9, color:"#7ab3e0", marginBottom:6 }}>✅ {csvPreview.length} jugadores detectados:</div>
                    <div style={{ maxHeight:160, overflowY:"auto", marginBottom:8 }}>
                      {csvPreview.map((p,i) => (
                        <div key={i} style={{ fontSize:8.5, padding:"4px 0", borderBottom:"1px solid rgba(255,255,255,.03)", display:"flex", justifyContent:"space-between" }}>
                          <span>{p.nombre} {p.apellido} · CI: {p.cedula||"—"}</span>
                          <span className="bg bg-b">{p.cat}</span>
                        </div>
                      ))}
                    </div>
                    <button className="btn" disabled={csvImporting} onClick={importCSVPlayers}>
                      {csvImporting ? "⏳ Importando..." : "✅ IMPORTAR " + csvPreview.length + " JUGADORES"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      );
    }

    // ── ASISTENCIA ──────────────────────────
    if (tab === "asistencia") {
      const hoyISO  = new Date().toISOString().slice(0,10);
      // Entrenamientos ordenados: próximos primero, luego pasados
      const myTrains = [...trainings]
        .filter(t => t.fecha && (user.cat === "Todas" || (t.cats||[]).includes(user.cat)))
        .sort((a,b) => {
          // Próximos arriba, pasados abajo
          const aFut = (a.fecha||"") >= hoyISO ? 0 : 1;
          const bFut = (b.fecha||"") >= hoyISO ? 0 : 1;
          if (aFut !== bFut) return aFut - bFut;
          return aFut === 0 ? (a.fecha||"").localeCompare(b.fecha||"") : (b.fecha||"").localeCompare(a.fecha||"");
        });

      const selTrain    = attSession ? (trainings.find(t => t.id === attSession) || null) : null;
      // Nota: si selTrain es null con attSession activo, simplemente no mostramos nada hasta que Firebase sincronice
      const trainPlayers = selTrain
        ? players.filter(p => (selTrain.cats||[]).includes(p.cat))
        : [];
      const sesCount = selTrain
        ? trainPlayers.filter(p => att[p.id]?.[attSession]?.present).length
        : 0;
      const sesPct = trainPlayers.length ? Math.round(sesCount/trainPlayers.length*100) : 0;

      return (
        <>
          <div className="st">✅ Pase de Lista</div>

          {/* Selector de sesión */}
          {!attSession && (
            <div className="card" style={{ marginBottom:8 }}>
              <div className="ch"><span className="ct">Seleccionar Sesión</span></div>
              {myTrains.length === 0 && (
                <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>
                  No hay entrenamientos. Agrégalos en el módulo Entrenos.
                </p>
              )}
              {myTrains.map(t => {
                const fd = t.fecha ? new Date(t.fecha+"T12:00:00") : null;
                const fechaLeg = fd ? fd.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}) : "—";
                const esPasado = t.fecha < hoyISO;
                const sesP = players.filter(p => (t.cats||[]).includes(p.cat));
                const sesPres = sesP.filter(p => att[p.id]?.[t.id]?.present).length;
                return (
                  <div key={t.id}
                    onClick={() => setAttSession(t.id)}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"10px 12px", marginBottom:6, borderRadius:10, cursor:"pointer",
                      background: esPasado ? "#06091a" : "rgba(21,101,192,.07)",
                      border: esPasado ? "1px solid rgba(255,255,255,.04)" : "1px solid rgba(33,150,243,.2)",
                      opacity: esPasado ? 0.75 : 1 }}>
                    <div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:17, letterSpacing:.5,
                        color: esPasado ? "#4e6a88" : "#7ab3e0" }}>{fechaLeg}</div>
                      <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>
                        ⏰ {t.hora} · 📍 {t.lugar}
                        {t.tema && <span> · {t.tema}</span>}
                      </div>
                      <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                        {(t.cats||[]).map(cat => <span key={cat} className="bg bg-b" style={{ fontSize:7 }}>{cat}</span>)}
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      {sesPres > 0 && <div style={{ fontSize:11, fontWeight:700, color:"#7ab3e0" }}>{sesPres}/{sesP.length}</div>}
                      <span className="bg bg-b" style={{ fontSize:7.5 }}>▸ Pasar lista</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── MODO PASE DE LISTA RÁPIDA ── */}
          {selTrain && (() => {
            const fd = selTrain.fecha ? new Date(selTrain.fecha+"T12:00:00") : null;
            const fechaLeg = fd ? fd.toLocaleDateString("es",{weekday:"long",day:"numeric",month:"long"}) : "—";
            return (
              <>
                {/* Header de la sesión */}
                <div style={{ background:"rgba(21,101,192,.1)", border:"1px solid rgba(33,150,243,.2)",
                  borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", letterSpacing:.5 }}>
                        {fechaLeg}
                      </div>
                      <div style={{ fontSize:8.5, color:"#4e6a88", marginTop:2 }}>
                        ⏰ {selTrain.hora} · 📍 {selTrain.lugar}
                      </div>
                      {selTrain.tema && <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>📋 {selTrain.tema}</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28,
                        color: sesPct>=70?"#7ab3e0":"#e8a0a0" }}>{sesCount}/{trainPlayers.length}</div>
                      <div style={{ fontSize:7.5, color:"#4e6a88" }}>{sesPct}% presentes</div>
                    </div>
                  </div>
                  <div className="pb" style={{ marginTop:8 }}>
                    <div className={"pf "+(sesPct>=70?"pf-b":"pf-r")} style={{ width:sesPct+"%" }}/>
                  </div>
                  <div style={{ display:"flex", gap:6, marginTop:8 }}>
                    <button className="btn-sm" style={{ fontSize:8 }} onClick={() => setAttSession(null)}>← Cambiar sesión</button>
                    <button className="btn-sm" style={{ fontSize:8, background:"rgba(33,150,243,.15)", color:"#7ab3e0" }}
                      onClick={() => {
                        trainPlayers.forEach(p => {
                          const updated = { ...(att[p.id]||{}), [attSession]: { present: true } };
                          safeSetDoc(doc(db,"att",String(p.id)), updated);
                        });
                      }}>✅ Marcar todos</button>
                    <button className="btn-sm" style={{ fontSize:8, background:"rgba(183,28,28,.1)", color:"#e8a0a0" }}
                      onClick={() => {
                        trainPlayers.forEach(p => {
                          const updated = { ...(att[p.id]||{}), [attSession]: { present: false } };
                          safeSetDoc(doc(db,"att",String(p.id)), updated);
                        });
                      }}>✕ Limpiar</button>
                  </div>
                </div>

                {/* Lista compacta de pase de lista rápida */}
                {trainPlayers.length === 0 && (
                  <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Sin jugadores en esta categoría</p></div>
                )}
                {trainPlayers.map(p => {
                  const present = !!(att[p.id]?.[attSession]?.present);
                  return (
                    <div key={p.id}
                      onClick={() => toggleAtt(p.id)}
                      style={{ display:"flex", alignItems:"center", gap:10,
                        padding:"10px 12px", marginBottom:5, borderRadius:10, cursor:"pointer",
                        background: present ? "rgba(21,101,192,.12)" : "#06091a",
                        border: `1px solid ${present ? "rgba(33,150,243,.35)" : "rgba(255,255,255,.04)"}`,
                        transition:"all .15s" }}>
                      {/* Checkbox grande */}
                      <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
                        background: present ? "#1565C0" : "rgba(255,255,255,.04)",
                        border: `2px solid ${present ? "#2196F3" : "rgba(255,255,255,.1)"}`,
                        display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {present && <span style={{ color:"#fff", fontSize:16, fontWeight:700 }}>✓</span>}
                      </div>
                      {/* Foto y nombre */}
                      <Avatar p={p} size={34}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600, color: present?"#7ab3e0":"#c0cfe0" }}>
                          {p.nombre} {p.apellido}
                        </div>
                        <div style={{ fontSize:8, color:"#4e6a88" }}>#{p.num} · {p.cat}</div>
                      </div>
                      {/* Badge estado */}
                      <span className={"bg "+(present?"bg-b":"bg-n")} style={{ fontSize:8, flexShrink:0 }}>
                        {present ? "✓ Presente" : "Ausente"}
                      </span>
                    </div>
                  );
                })}

                {/* Historial de asistencia */}
                {trainPlayers.length > 0 && (
                  <div className="card" style={{ marginTop:8 }}>
                    <div className="ch"><span className="ct">📊 Historial del Mes</span></div>
                    {trainPlayers.map(p => {
                      const sesiones = myTrains.filter(t => (t.cats||[]).includes(p.cat));
                      const total    = sesiones.length;
                      const asistio  = sesiones.filter(t => att[p.id]?.[t.id]?.present).length;
                      const pct      = total ? Math.round(asistio/total*100) : 0;
                      return (
                        <div key={p.id} style={{ marginBottom:8 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:3 }}>
                            <span style={{ fontWeight:500 }}>{p.nombre} {p.apellido}</span>
                            <span style={{ color:pct>=70?"#7ab3e0":"#e8a0a0", fontFamily:"'Bebas Neue',sans-serif", fontSize:14 }}>
                              {asistio}/{total} · {pct}%
                            </span>
                          </div>
                          <div className="pb">
                            <div className={"pf "+(pct>=70?"pf-b":"pf-r")} style={{ width:pct+"%" }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Asistencia a partidos */}
                {(() => {
                  const myAttM = attMatches.filter(m => trainPlayers.some(p => m.convocados?.includes(p.id)));
                  if (myAttM.length === 0) return null;
                  return (
                    <div className="card" style={{ marginTop:8 }}>
                      <div className="ch"><span className="ct">⚽ Asistencia a Partidos</span><span className="bg bg-b">{myAttM.length}</span></div>
                      {trainPlayers.map(p => {
                        const convocadoEn = myAttM.filter(m => m.convocados?.includes(p.id)).length;
                        const titular     = myAttM.filter(m => m.titulares?.includes(p.id)).length;
                        if (convocadoEn===0) return null;
                        return (
                          <div key={p.id} style={{ padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", fontSize:9 }}>
                              <span style={{ fontWeight:500 }}>{p.nombre} {p.apellido}</span>
                              <div style={{ display:"flex", gap:4 }}>
                                <span className="bg bg-b">Conv. {convocadoEn}</span>
                                <span className="bg bg-n">Tit. {titular}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </>
      );
    }

    // ── PAGOS ───────────────────────────────
    if (tab === "pagos") {
      return (
        <>
          <div className="st">💳 Pagos</div>
          <div className="dtabs">
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt" + (catF===c ? " da" : "")} onClick={() => setCatF(c)}>{c}</div>
            ))}
          </div>
          <div className="ptabs">
            {[["mensualidades","📅 Mensual."],["campeonato","🏆 Camp."],["arbitraje","🏁 Arbitraje"]].map(([k,l]) => (
              <div key={k} className={"pt" + (payTab===k ? " pa" : "")} onClick={() => setPayTab(k)}>{l}</div>
            ))}
          </div>
          <div style={{ display:"flex", gap:6, marginBottom:9 }}>
            <button className="btn-wa" style={{ flex:1, justifyContent:"center" }} onClick={() => setShowListWA(true)}>
              📲 Lista WA
            </button>
            <button className="btn-sm" style={{ padding:"10px 14px", background:"rgba(21,101,192,.15)", color:"#7ab3e0" }}
              onClick={() => exportPaymentsPDF()}>
              📄 PDF Mes
            </button>
            <button className="btn-sm" style={{ padding:"10px 14px", background:"rgba(212,184,74,.1)", color:"#d4b84a", borderColor:"rgba(212,184,74,.25)" }}
              onClick={() => {
                // Exportar CSV completo de pagos
                const rows = [];
                const header = ["Nombre","Apellido","Cédula","Categoría","Camiseta",
                  ...ACTIVE_MONTHS.map(m => "Pago_"+m),
                  "Meses_Pagados","Meses_Pendientes","Total_Bs"];
                rows.push(header.join(","));
                const filtExport = catF==="Todas" ? players : players.filter(p=>p.cat===catF);
                filtExport.forEach(p => {
                  const mesesBool = ACTIVE_MONTHS.map(m => pay[p.id]?.months?.[m]?.paid ? "SI" : "NO");
                  const totalPag  = ACTIVE_MONTHS.filter(m => pay[p.id]?.months?.[m]?.paid).length;
                  const totalPend = 12 - totalPag;
                  const totalBsP  = MONTHS.reduce((s,m)=>s+(parseFloat(pay[p.id]?.months?.[m]?.monto)||0),0);
                  rows.push([
                    p.nombre, p.apellido, p.cedula||"", p.cat, p.num||"",
                    ...mesesBool,
                    totalPag, totalPend, totalBsP.toFixed(2)
                  ].join(","));
                });
                // Totales
                rows.push([]);
                const totPag  = filtExport.reduce((s,p)=>s+MONTHS.filter(m=>pay[p.id]?.months?.[m]?.paid).length,0);
                const totBs   = filtExport.reduce((s,p)=>s+MONTHS.reduce((ss,m)=>ss+(parseFloat(pay[p.id]?.months?.[m]?.monto)||0),0),0);
                rows.push(["TOTAL","","","","","","","","","","","","","","","","",totPag,filtExport.length*12-totPag,totBs.toFixed(2)].join(","));

                const blob = new Blob([rows.join("\n")], { type:"text/csv;charset=utf-8;" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href     = url;
                a.download = "pagos_romulo_fc_"+(catF==="Todas"?"todas":catF)+"_"+new Date().getFullYear()+".csv";
                a.click();
                URL.revokeObjectURL(url);
              }}>
              📊 Exportar CSV
            </button>
          </div>

          {payTab === "mensualidades" && filtP.map(p => {
            const paid = ACTIVE_MONTHS.filter(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid).length;
            const pend = ACTIVE_MONTHS.filter(m => !pay[p.id]?.months[m]?.paid && !pay[p.id]?.months[m]?.exento);
            return (
              <div key={p.id} className="card" style={{ marginBottom:8 }}>
                <div className="ch" style={{ marginBottom:6 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <Avatar p={p} size={24} />
                    <div>
                      <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                      <div style={{ fontSize:8, color:"#4e6a88" }}>{p.cat}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                    <span className={"bg " + (paid>=10 ? "bg-g" : paid>=6 ? "bg-y" : "bg-r")}>{paid}/12</span>
                    {pend.length > 0 && (
                      <button className="btn-wa" onClick={() => openWA(p.repTel,
                        "💳 RÓMULO F.C — Hola " + p.repNombre + ", " + p.nombre + " tiene meses pendientes: " + pend.join(", ")
                      )}>📲</button>
                    )}
                  </div>
                </div>
                <div className="mgrid">
                  {MONTHS.map(m => {
                    const mesData = pay[p.id]?.months[m];
                    const ok      = mesData?.paid;
                    const exento  = mesData?.exento;
                    const ref     = mesData?.ref;
                    const esActivo = ACTIVE_MONTHS.includes(m);
                    if (!esActivo && !ok && !exento) return (
                      <div key={m} style={{ background:"rgba(255,255,255,.02)", borderRadius:6,
                        padding:"5px 3px", textAlign:"center", opacity:.35, border:"1px solid rgba(255,255,255,.03)" }}>
                        <div style={{ fontSize:7.5, color:"#3a5068" }}>{m}</div>
                        <div style={{ fontSize:9 }}>—</div>
                      </div>
                    );
                    return (
                      <div key={m}
                        className={"mcell " + (exento ? "mex" : ok ? "mp" : "mup")}
                        style={{}}
                        onClick={() => {
                          if (exento) {
                            // Quitar exención
                            if (can("pagos")) {
                              const upd = { ...pay[p.id], months: { ...pay[p.id].months, [m]: { paid:false, date:null, ref:null, monto:null, metodo:null, exento:false, motivoExento:null } } };
                              safeSetDoc(doc(db,"pay",String(p.id)), upd);
                            }
                          } else {
                            toggleMonth(p.id, m);
                          }
                        }}
                        title={exento ? "Exento: "+mesData?.motivoExento : ok && ref ? "Ref: "+ref : ok ? "Pagado" : "Pendiente"}>
                        <div className="mclbl">{m}</div>
                        <div className="mcico">{exento ? "🔓" : ok ? "✅" : "❌"}</div>
                        {exento && <div style={{ fontSize:5.5, color:"#d4b84a", marginTop:1, lineHeight:1.2,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%" }}>Exento</div>}
                        {!exento && ok && ref && <div style={{ fontSize:6, color:"#7ab3e0", marginTop:1,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%", lineHeight:1.2 }}>#{ref.slice(-6)}</div>}
                        {/* Botón exento — solo aparece en meses no pagados con permiso */}
                        {!ok && !exento && can("pagos") && (
                          <div style={{ fontSize:5.5, color:"#8a7040", marginTop:1, cursor:"pointer",
                            textDecoration:"underline" }}
                            onClick={e=>{ e.stopPropagation(); setExentoModal({pid:p.id,mes:m}); setExentoMotivo(""); }}>
                            exentar
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pay[p.id] && (pay[p.id].history||[]).slice(-3).reverse().map((h,i) => (
                  <div key={i} className="hist-row">
                    <span style={{ color:"#4e6a88" }}>{h.action} {h.item||""}
                      {h.ref ? <span style={{ color:"#7ab3e0" }}> · Ref: {h.ref}</span> : ""}
                    </span>
                    <span style={{ color:"#4e6a88" }}>{h.monto ? "Bs. "+h.monto+" · " : ""}{h.date}</span>
                  </div>
                ))}
              </div>
            );
          })}

          {payTab === "campeonato" && (() => {
            // Campeonatos relevantes para las categorías filtradas
            const visibleChamps = champs.filter(ch =>
              ch.activo && filtP.some(p => ch.cats.includes(p.cat))
            );
            if (visibleChamps.length === 0) return (
              <div className="card">
                <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"12px 0" }}>
                  No hay campeonatos activos para esta categoría.
                </p>
              </div>
            );
            return visibleChamps.map(ch => {
              const champPlayers = filtP.filter(p => ch.cats.includes(p.cat));
              const pagados   = champPlayers.filter(p => pay[p.id]?.championships?.[ch.id]?.paid).length;
              const pendientes = champPlayers.length - pagados;
              return (
                <div key={ch.id} className="card" style={{ marginBottom:8 }}>
                  <div className="ch" style={{ marginBottom:8 }}>
                    <div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:.5 }}>
                        🏆 {ch.nombre}
                      </div>
                      <div style={{ display:"flex", gap:4, marginTop:3, flexWrap:"wrap" }}>
                        {ch.cats.map(c => <span key={c} className="bg bg-b">{c}</span>)}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600 }}>{pagados}/{champPlayers.length}</div>
                      {pendientes > 0 && <span className="bg bg-r">{pendientes} pend.</span>}
                    </div>
                  </div>
                  {/* Barra de progreso */}
                  <div className="pb" style={{ marginBottom:10 }}>
                    <div className="pf pf-b" style={{ width: champPlayers.length ? Math.round(pagados/champPlayers.length*100)+"%" : "0%" }} />
                  </div>
                  {champPlayers.map(p => {
                    const ok = pay[p.id]?.championships?.[ch.id]?.paid;
                    const fecha = pay[p.id]?.championships?.[ch.id]?.date;
                    return (
                      <div key={p.id} className="pr">
                        <Avatar p={p} />
                        <div className="pi">
                          <div className="pn">{p.nombre} {p.apellido}</div>
                          <div className="ps">{p.cat}{fecha ? " · " + fecha : ""}</div>
                        </div>
                        <button className={"ck" + (ok ? " on" : "")} onClick={() => toggleChamp(p.id, ch.id)}>
                          {ok ? "✓" : ""}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {payTab === "arbitraje" && (
            <>
              <div className="card" style={{ marginBottom:8 }}>
                <div className="ch"><span className="ct">Pagos de Arbitraje</span></div>
                <p style={{ fontSize:8.5, color:"#4e6a88", lineHeight:1.6, marginBottom:6 }}>
                  Los pagos se registran automáticamente desde el módulo <strong style={{ color:"var(--txt)" }}>En Vivo</strong> al finalizar cada partido.
                </p>
                <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(33,150,243,.04)", borderRadius:7, padding:"7px 9px" }}>
                  <span style={{ fontSize:14 }}>🏁</span>
                  <span style={{ fontSize:9, color:"#4e6a88", lineHeight:1.5 }}>
                    Al cerrar un partido en vivo, el sistema te pedirá confirmar si el arbitraje fue pagado y el monto.
                  </span>
                </div>
              </div>
              {filtP.map(p => {
                const arbs = (pay[p.id] && pay[p.id].arbitraje) || [];
                const totalPagado = arbs.filter(a => a.paid).reduce((s,a) => s + (a.amount||0), 0);
                const pendientes  = arbs.filter(a => !a.paid).length;
                if (arbs.length === 0) return null;
                return (
                  <div key={p.id} className="card" style={{ marginBottom:7 }}>
                    <div className="ch" style={{ marginBottom:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <Avatar p={p} size={24} />
                        <div>
                          <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                          <div style={{ fontSize:8, color:"#4e6a88" }}>{p.cat}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:4 }}>
                        {pendientes > 0 && <span className="bg bg-r">⚠️ {pendientes} pend.</span>}
                        <span className="bg bg-b">Bs. {totalPagado}</span>
                      </div>
                    </div>
                    {arbs.map((a, i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,.02)", fontSize:9 }}>
                        <div>
                          <div style={{ fontWeight:500 }}>vs {a.rival || "Rival"} · {a.date}</div>
                          <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>Bs. {a.amount || 0}</div>
                        </div>
                        <span className={"bg " + (a.paid ? "bg-b" : "bg-r")}>
                          {a.paid ? "✅ Pagado" : "❌ Pendiente"}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {filtP.every(p => !(pay[p.id]?.arbitraje?.length)) && (
                <div className="card">
                  <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"10px 0" }}>
                    Aún no hay registros de arbitraje. Se generan al finalizar partidos en vivo.
                  </p>
                </div>
              )}
            </>
          )}

          {showListWA && (
            <div className="ov" onClick={e => { if (e.target.className === "ov") setShowListWA(false); }}>
              <div className="modal">
                <div className="mt2">📲 Lista por WhatsApp <span className="mx" onClick={() => setShowListWA(false)}>✕</span></div>
                <div className="ptabs" style={{ marginBottom:8 }}>
                  {[["pendientes","❌ Pendientes"],["pagados","✅ Al día"],["completa","📋 Completa"]].map(([k,l]) => (
                    <div key={k} className={"pt" + (listType===k ? " pa" : "")} onClick={() => setListType(k)}>{l}</div>
                  ))}
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Filtrar categoría</div>
                  <select className="inp" value={listCat} onChange={e => setListCat(e.target.value)}>
                    {["Todas",...CATS].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ background:"var(--bg3)", borderRadius:8, padding:"8px 10px", fontSize:9, color:"#8fa8c8", lineHeight:1.6, maxHeight:180, overflowY:"auto", marginBottom:10, whiteSpace:"pre-wrap" }}>
                  {buildListMsg()}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button className="btn-wa" style={{ flex:1, justifyContent:"center" }} onClick={() => openWA(coaches[0].tel, buildListMsg())}>
                    📲 Enviar a Director
                  </button>
                  <button className="btn-sm" style={{ flex:1, padding:9 }} onClick={() => { navigator.clipboard && navigator.clipboard.writeText(buildListMsg()); }}>
                    📋 Copiar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── CALENDARIO ──────────────────────────
    if (tab === "calendario") {
      return (
        <>
          <div className="st">📅 Partidos</div>

          {/* Toggle vista lista / semanal */}
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            {[["lista","📋 Lista"],["semanal","📆 Semanal"]].map(([k,l])=>(
              <button key={k} className="btn-sm"
                style={{ flex:1, fontSize:9,
                  background: (calVista||"lista")===k?"rgba(33,150,243,.2)":"rgba(255,255,255,.03)",
                  color: (calVista||"lista")===k?"#7ab3e0":"#4e6a88",
                  borderColor: (calVista||"lista")===k?"rgba(33,150,243,.4)":"rgba(255,255,255,.05)" }}
                onClick={()=>setCalVista(k)}>{l}</button>
            ))}
          </div>

          {/* Vista semanal — reutiliza la agenda */}
          {(calVista||"lista")==="semanal" && (() => {
            const MESES_N = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
            const DIAS_S  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
            const hoy = new Date();
            const lunes = new Date(hoy);
            lunes.setDate(hoy.getDate() - ((hoy.getDay()||7)-1) + agendaSemana*7);
            const dias = Array.from({length:7},(_,i)=>{ const d=new Date(lunes); d.setDate(lunes.getDate()+i); return d; });
            function parseD(ds){ if(!ds)return null; if(/^\d{4}-\d{2}-\d{2}$/.test(ds.trim())){const[y,m,d]=ds.trim().split("-").map(Number);return new Date(y,m-1,d);} const mes={Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11,Enero:0,Febrero:1,Marzo:2,Abril:3,Mayo:4,Junio:5,Julio:6,Agosto:7,Septiembre:8,Octubre:9,Noviembre:10,Diciembre:11};const parts=ds.trim().split(/\s+/);if(parts.length>=2){const dd=parseInt(parts[0]),mm=mes[parts[1]],yy=parts[2]?parseInt(parts[2]):new Date().getFullYear();if(!isNaN(dd)&&mm!==undefined)return new Date(yy,mm,dd);}return null;}
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana-1)}>‹</button>
                  <span style={{ fontSize:9, color:"#7ab3e0", fontWeight:600 }}>
                    {dias[0].getDate()} {MESES_N[dias[0].getMonth()].slice(0,3)} – {dias[6].getDate()} {MESES_N[dias[6].getMonth()].slice(0,3)}
                  </span>
                  <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana+1)}>›</button>
                </div>
                <div style={{ display:"flex", gap:3 }}>
                  {dias.map((date,i)=>{
                    const esHoy = date.toDateString()===new Date().toDateString();
                    const partsDia = matches.filter(m=>{ const d=parseD(m.date); return d&&d.toDateString()===date.toDateString(); });
                    return (
                      <div key={i} style={{ flex:1, minHeight:70, borderRadius:8, padding:"4px 3px",
                        background: esHoy?"rgba(21,101,192,.12)":"rgba(255,255,255,.02)",
                        border:`1px solid ${esHoy?"rgba(33,150,243,.3)":"rgba(255,255,255,.04)"}`,
                        display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ fontSize:7, color:"#3a5068", fontWeight:600 }}>{DIAS_S[date.getDay()]}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:esHoy?"#7ab3e0":"#8a9ab0" }}>{date.getDate()}</div>
                        {partsDia.map((m,mi)=>(
                          <div key={mi} style={{ borderRadius:3, padding:"1px 3px", width:"90%",
                            background: m.status==="finalizado"?"rgba(21,101,192,.2)":"rgba(33,150,243,.12)",
                            borderLeft:`2px solid ${m.status==="finalizado"?"#1565C0":"#2196F3"}`,
                            fontSize:6.5, color:"var(--txt)", lineHeight:1.3,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            ⚽ {m.away}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="dtabs">
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt" + (catF===c ? " da" : "")} onClick={() => setCatF(c)}>{c}</div>
            ))}
          </div>
          {can("calendario") && (
            <div style={{ display:"flex", gap:7, marginBottom:9 }}>
              <button className="btn" style={{ flex:2 }} onClick={() => { setShowMForm(true); setFormErr(""); }}>
                + Agregar Partido
              </button>
              <button className="btn" style={{ flex:1, background:"rgba(229,57,53,.08)", border:"1px solid rgba(229,57,53,.2)", color:"#e8a0a0" }}
                onClick={() => { setHistorialModal(true); setHpStep(1); setHpStats({}); }}>
                📋 Historial
              </button>
            </div>
          )}
          {filtM.map(m => (
            <div key={m.id}>
              <MatchCard m={m} champs={champs} />
              {/* MVP badge en partido finalizado */}
              {m.status === "finalizado" && m.mvp && (
                <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(212,184,74,.06)",
                  border:"1px solid rgba(212,184,74,.18)", borderRadius:8, padding:"5px 10px", marginBottom:4 }}>
                  <span style={{ fontSize:14 }}>🏅</span>
                  <div style={{ flex:1 }}>
                    <span style={{ fontSize:8, color:"#8a7040", textTransform:"uppercase", letterSpacing:.5 }}>MVP · </span>
                    <span style={{ fontSize:9.5, color:"#d4b84a", fontWeight:600 }}>
                      {m.mvp.nombre} {m.mvp.apellido}
                    </span>
                  </div>
                  {m.mvpPdfEnviado && <span className="bg bg-b" style={{ fontSize:7 }}>PDF ✓</span>}
                </div>
              )}
              <div style={{ display:"flex", gap:6, marginBottom:9 }}>
                {can("partido") && m.status === "próximo" && (
                  <>
                    <button className="btn" style={{ flex:1, padding:8, fontSize:11 }} onClick={() => setLiveM(m)}>
                      🟢 En Vivo
                    </button>
                    <button className="btn-sm" style={{ flex:1, padding:8, fontSize:10,
                      background:"rgba(212,184,74,.1)", color:"#d4b84a", borderColor:"rgba(212,184,74,.3)" }}
                      onClick={() => { setQuickResult(m); setQr({ scoreH:"", scoreA:"", goleadores:[] }); setQrInput(""); }}>
                      📋 Resultado
                    </button>
                  </>
                )}
                {/* Botón MVP para partidos finalizados */}
                {m.status === "finalizado" && (() => {
                  const votosM      = m.mvpVotos || {};
                  const miVoto      = votosM[user?.id];
                  const hoy         = new Date().toLocaleDateString("es");
                  const pasoDia     = m.date !== hoy;
                  const totalV      = Object.keys(votosM).length;
                  const todosV      = totalV >= coaches.length;
                  const cerrada     = todosV || (pasoDia && totalV > 0);
                  const pdfEnviado  = !!m.mvpPdfEnviado;
                  const label       = pdfEnviado ? "🏅 Ver MVP"
                    : cerrada ? (miVoto ? "📄 Generar PDF" : "🏅 Ver MVP")
                    : miVoto  ? "🏅 Votado ✓"
                    : "🏅 Votar MVP";
                  const color = pdfEnviado ? "rgba(212,184,74,.15)"
                    : !miVoto && !cerrada ? "rgba(212,184,74,.1)" : "rgba(21,101,192,.1)";
                  return (
                    <button className="btn-sm" style={{ flex:1, padding:"8px 10px", fontSize:10,
                      background:color, borderColor:"rgba(212,184,74,.3)", color:"#d4b84a" }}
                      onClick={() => setMvpModal(m.id)}>
                      {label}
                    </button>
                  );
                })()}
                {/* Botón galería */}
                {m.status === "finalizado" && (
                  <button className="btn-sm" style={{ padding:"8px 10px", fontSize:10,
                    background:"rgba(21,101,192,.08)", borderColor:"rgba(33,150,243,.15)", color:"#7ab3e0" }}
                    onClick={() => setGaleriaModal(m.id)}>
                    📸{(m.fotos?.length||0)>0?" "+m.fotos.length:""}
                  </button>
                )}
                {can("calendario") && (
                  <>
                    <button className="btn-sm" style={{ padding:"8px 12px", fontSize:11 }} onClick={() => {
                      setNm({ home: m.home||"Rómulo FC", away: m.away||"", date: m.date||"", time: m.time||"", cat: m.cat||"Sub-11", field: m.field||"", champId: m.champId||"", fase: m.fase||"Normal" });
                      setEditMid(m.id);
                      setShowMForm(true);
                      setFormErr("");
                    }}>✏️ Editar</button>
                    <button className="btn-sm" style={{ padding:"8px 12px", fontSize:11, background:"rgba(183,28,28,.15)", borderColor:"rgba(183,28,28,.3)", color:"#ef9a9a" }} onClick={() => setConfirmDelM(m)}>
                      🗑️
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {filtM.length === 0 && (
            <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"20px 0" }}>Sin partidos para esta categoría</p>
          )}

          {showMForm && (
            <div className="ov" onClick={e => { if (e.target.className === "ov") { setShowMForm(false); setEditMid(null); } }}>
              <div className="modal">
                <div className="mt2">{editMid ? "✏️ Editar Partido" : "Nuevo Partido"} <span className="mx" onClick={() => { setShowMForm(false); setEditMid(null); }}>✕</span></div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Equipo Rival *</div>
                  <input className="inp" placeholder="Nombre del rival" value={nm.away} onChange={e => setNm(n => ({ ...n, away:e.target.value }))} />
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Fecha *</div>
                    <input className="inp" placeholder="29 Mar" value={nm.date} onChange={e => setNm(n => ({ ...n, date:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Hora *</div>
                    <input className="inp" placeholder="10:00" value={nm.time} onChange={e => setNm(n => ({ ...n, time:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Categoría</div>
                    <select className="inp" value={nm.cat} onChange={e => setNm(n => ({ ...n, cat:e.target.value }))}>
                      {CATS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Campo *</div>
                    <input className="inp" placeholder="Campo A" value={nm.field} onChange={e => setNm(n => ({ ...n, field:e.target.value }))} />
                  </div>
                </div>
                {formErr && <div className="err">⚠️ {formErr}</div>}
                <div className="inp-wrap" style={{ marginTop:6 }}>
                  <div className="inp-lbl">Campeonato (opcional)</div>
                  <select className="inp" value={nm.champId} onChange={e => setNm(n => ({ ...n, champId: e.target.value ? parseInt(e.target.value) : "", fase: e.target.value ? n.fase : "Normal" }))}>
                    <option value="">— Sin campeonato (amistoso) —</option>
                    {champs.filter(c => c.activo).map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}{c.cats.length ? " (" + c.cats.join(", ") + ")" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="inp-wrap" style={{ marginTop:6 }}>
                  {nm.champId
                    ? <>
                        <div className="inp-lbl">Fase del partido</div>
                        <select className="inp" value={nm.fase} onChange={e => setNm(n => ({ ...n, fase: e.target.value }))}>
                          <option value="Normal">⚽ Normal (fase de grupos)</option>
                          <option value="Octavos">⚔️ Octavos de final</option>
                          <option value="Cuartos">⚔️ Cuartos de final</option>
                          <option value="Semifinal">🏆 Semifinal</option>
                          <option value="Final">🥇 Final</option>
                        </select>
                      </>
                    : <div style={{ fontSize:8, color:"#3a5068", padding:"5px 0" }}>⚽ Partido amistoso — selecciona un campeonato para definir la fase</div>
                  }
                </div>
                <button className="btn" style={{ marginTop:4 }} onClick={saveMatch}>{editMid ? "💾 GUARDAR CAMBIOS" : "GUARDAR PARTIDO"}</button>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── UNIFORMES ───────────────────────────
    // ── TORNEOS EXTERNOS ────────────────────────
    if (tab === "torneos") {
      const torneos = clubConfig?.torneos || [];

      function saveTorneo() {
        if (!ntT.nombre || !ntT.fecha) return;
        const nuevos = [...torneos];
        if (editTIdx !== null) { nuevos[editTIdx] = ntT; }
        else { nuevos.push({ ...ntT, id: Date.now() }); }
        safeSetDoc(doc(db,"config","club"), { ...clubConfig, torneos: nuevos });
        setShowTFormT(false); setEditTIdx(null); setNtT(T_BLANK_G);
      }

      function delTorneo(idx) {
        const nuevos = torneos.filter((_,i)=>i!==idx);
        safeSetDoc(doc(db,"config","club"), { ...clubConfig, torneos: nuevos });
      }

      return (
        <>
          <div className="st">🌍 Torneos Externos</div>
          {can("config") && (
            <button className="btn" style={{ marginBottom:9 }} onClick={()=>{ setNtT(T_BLANK_G); setEditTIdx(null); setShowTFormT(true); }}>
              + Registrar Torneo
            </button>
          )}

          {torneos.length === 0 && (
            <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:14 }}>Sin torneos registrados</p></div>
          )}

          {[...torneos].reverse().map((t,ri) => {
            const idx = torneos.length-1-ri;
            return (
              <div key={t.id||idx} className="card" style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#7ab3e0" }}>{t.nombre}</div>
                    <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap" }}>
                      <span className="bg bg-n">📅 {t.fecha}</span>
                      {t.lugar && <span className="bg bg-n">📍 {t.lugar}</span>}
                      {t.costo && <span className="bg bg-y">${t.costo}/jugador</span>}
                    </div>
                    {t.cats?.length > 0 && (
                      <div style={{ display:"flex", gap:3, marginTop:4, flexWrap:"wrap" }}>
                        {t.cats.map(cat=><span key={cat} className="bg bg-b">{cat}</span>)}
                      </div>
                    )}
                    {t.resultado && (
                      <div style={{ marginTop:6, fontSize:9, color:"var(--txt)", background:"rgba(21,101,192,.07)",
                        borderRadius:6, padding:"5px 8px" }}>
                        🏆 {t.resultado}
                      </div>
                    )}
                  </div>
                  {can("config") && (
                    <div style={{ display:"flex", gap:4 }}>
                      <button className="btn-sm" onClick={()=>{ setNtT({...t}); setEditTIdx(idx); setShowTFormT(true); }}>✏️</button>
                      <button className="btn-sm" style={{ background:"rgba(183,28,28,.1)", color:"#e8a0a0" }}
                        onClick={()=>setConf({ title:"ELIMINAR TORNEO", danger:true, okTxt:"Eliminar",
                          msg:"¿Eliminar el torneo "+t.nombre+"?", ok:()=>delTorneo(idx) })}>🗑</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {showTFormT && (
            <div className="ov" onClick={e=>{ if(e.target.className==="ov"){ setShowTFormT(false); setEditTIdx(null); }}}>
              <div className="modal">
                <div className="mt2">{editTIdx!==null?"✏️ Editar Torneo":"Nuevo Torneo Externo"}
                  <span className="mx" onClick={()=>{ setShowTFormT(false); setEditTIdx(null); }}>✕</span></div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Nombre del Torneo *</div>
                  <input className="inp" placeholder="Ej: Copa Carabobo 2026" value={ntT.nombre}
                    onChange={e=>setNtT(n=>({...n,nombre:e.target.value}))}/>
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Fecha *</div>
                    <input className="inp" placeholder="15 Mar 2026" value={ntT.fecha}
                      onChange={e=>setNtT(n=>({...n,fecha:e.target.value}))}/>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Lugar</div>
                    <input className="inp" placeholder="Ciudad o cancha" value={ntT.lugar}
                      onChange={e=>setNtT(n=>({...n,lugar:e.target.value}))}/>
                  </div>
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Costo inscripción ($)</div>
                    <input className="inp" type="number" placeholder="0" value={ntT.costo}
                      onChange={e=>setNtT(n=>({...n,costo:e.target.value}))}/>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Categorías</div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:3 }}>
                      {CATS.map(cat=>(
                        <button key={cat} onClick={()=>setNtT(n=>({...n,cats: n.cats.includes(cat)?n.cats.filter(x=>x!==cat):[...n.cats,cat]}))}
                          className={"btn-sm"} style={{ fontSize:8, padding:"3px 6px",
                            background: ntT.cats.includes(cat)?"rgba(21,101,192,.25)":"rgba(255,255,255,.03)",
                            color: ntT.cats.includes(cat)?"#7ab3e0":"#4e6a88" }}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Resultados obtenidos</div>
                  <textarea className="inp" rows={2} placeholder="Ej: Subcampeones, eliminados en cuartos..."
                    value={ntT.resultado} onChange={e=>setNtT(n=>({...n,resultado:e.target.value}))}
                    style={{ resize:"none" }}/>
                </div>
                <button className="btn" style={{ marginTop:4 }} onClick={saveTorneo}>
                  {editTIdx!==null?"💾 GUARDAR CAMBIOS":"AGREGAR TORNEO"}
                </button>
              </div>
            </div>
          )}
        </>
      );
    }

    if (tab === "uniformes") {
      const myP = players.filter(p => user.cat === "Todas" || p.cat === user.cat);

      function saveUniforme(pid, data) {
        const pl = players.find(x => x.id === pid);
        if (!pl) return;
        safeSetDoc(doc(db,"players",String(pid)), { ...pl, uniforme: { ...(pl.uniforme||{}), ...data } });
      }

      const TALLAS = ["XS","S","M","L","XL","XXL"];
      const ESTADOS = ["Bueno","Deteriorado","Extraviado"];
      const TIPOS = ["Camiseta","Short","Medias","Chaqueta","Conjunto completo"];

      return (
        <>
          <div className="st">👕 Control de Uniformes</div>

          {/* Resumen */}
          <div className="sr3" style={{ marginBottom:10 }}>
            <div className="sb">
              <div className="sn" style={{ color:"#2196F3" }}>{myP.filter(p=>p.uniforme?.entregado).length}</div>
              <div className="sl">Entregados</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color:"#E53935" }}>{myP.filter(p=>!p.uniforme?.entregado).length}</div>
              <div className="sl">Pendientes</div>
            </div>
            <div className="sb">
              <div className="sn" style={{ color:"#d4b84a" }}>{myP.filter(p=>p.uniforme?.estado==="Extraviado").length}</div>
              <div className="sl">Extraviados</div>
            </div>
          </div>

          {/* Filtro por categoría */}
          <div className="dtabs" style={{ marginBottom:10 }}>
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt"+(catF===c?" da":"")} onClick={() => setCatF(c)}>{c}</div>
            ))}
          </div>

          {myP.filter(p => catF==="Todas" || p.cat===catF).map(p => {
            const u = p.uniforme || {};
            return (
              <div key={p.id} className="card" style={{ marginBottom:8 }}>
                <div className="ch" style={{ marginBottom:6 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <Avatar p={p} size={30} />
                    <div>
                      <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                      <div style={{ fontSize:8, color:"#3a5068" }}>{p.cat} · #{p.num}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                    {u.entregado
                      ? <span className="bg bg-b">✅ Entregado</span>
                      : <span className="bg bg-r">⏳ Pendiente</span>}
                    {u.estado === "Extraviado" && <span className="bg bg-y">⚠️ Extraviado</span>}
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                  <div>
                    <div className="inp-lbl">Talla</div>
                    <select className="inp" style={{ fontSize:10 }} value={u.talla||""}
                      onChange={e => saveUniforme(p.id, { talla: e.target.value })}>
                      <option value="">— Talla —</option>
                      {TALLAS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="inp-lbl">Tipo</div>
                    <select className="inp" style={{ fontSize:10 }} value={u.tipo||""}
                      onChange={e => saveUniforme(p.id, { tipo: e.target.value })}>
                      <option value="">— Tipo —</option>
                      {TIPOS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                  <div>
                    <div className="inp-lbl">Estado</div>
                    <select className="inp" style={{ fontSize:10 }} value={u.estado||"Bueno"}
                      onChange={e => saveUniforme(p.id, { estado: e.target.value })}>
                      {ESTADOS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="inp-lbl">Número camiseta</div>
                    <input className="inp" style={{ fontSize:10 }} type="number" min="1"
                      placeholder={String(p.num||"")}
                      value={u.numCamiseta||""}
                      onChange={e => saveUniforme(p.id, { numCamiseta: e.target.value })} />
                  </div>
                </div>

                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <button className={"btn"+(u.entregado?"":" btn")}
                    style={{ flex:1, padding:8, fontSize:11,
                      background: u.entregado ? "rgba(183,28,28,.15)" : "rgba(21,101,192,.2)",
                      borderColor: u.entregado ? "rgba(229,57,53,.3)" : "rgba(33,150,243,.3)",
                      color: u.entregado ? "#ef9a9a" : "#7ab3e0" }}
                    onClick={() => saveUniforme(p.id, { entregado: !u.entregado, fechaEntrega: !u.entregado ? new Date().toLocaleDateString("es") : null })}>
                    {u.entregado ? "↩ Marcar pendiente" : "✅ Marcar entregado"}
                  </button>
                  {u.entregado && u.fechaEntrega && (
                    <span style={{ fontSize:7.5, color:"#3a5068" }}>📅 {u.fechaEntrega}</span>
                  )}
                </div>

                {can("jugadores") && (
                  <div style={{ marginTop:6 }}>
                    <div className="inp-lbl">Observaciones</div>
                    <input className="inp" style={{ fontSize:9 }} placeholder="Ej: Devolver al finalizar temporada"
                      value={u.obs||""}
                      onBlur={e => saveUniforme(p.id, { obs: e.target.value })}
                      onChange={e => {
                        const pl = players.find(x=>x.id===p.id);
                        if (pl) pl.uniforme = { ...(pl.uniforme||{}), obs: e.target.value };
                      }} />
                  </div>
                )}
              </div>
            );
          })}
        </>
      );
    }

    // ── CHAT ────────────────────────────────
    if (tab === "chat") {
      const CANALES = ["General", ...CATS];
      const filtMsgs = chatMsgs.filter(m => m.canal === chatCat);

      function sendChatMsg() {
        const txt = chatMsg.trim();
        if (!txt) return;
        const id = "cm_" + Date.now();
        safeSetDoc(doc(db, "chat", id), {
          id,
          canal: chatCat,
          texto: txt,
          autor: user?.name || "Entrenador",
          rol: user?.role || "",
          ts: new Date().toISOString(),
          uid: user?.id || ""
        });
        setChatMsg("");
      }

      return (
        <>
          <div className="st">💬 Chat Interno</div>

          {/* Selector de canal */}
          <div className="dtabs" style={{ marginBottom:10 }}>
            {CANALES.map(c => (
              <div key={c} className={"dt"+(chatCat===c?" da":"")}
                onClick={() => setChatCat(c)}>{c}</div>
            ))}
          </div>

          {/* Mensajes */}
          <div style={{ minHeight:300, maxHeight:"calc(100vh - 340px)", overflowY:"auto",
            background:"var(--card)", borderRadius:10, border:"1px solid rgba(33,150,243,.08)",
            padding:"10px", marginBottom:10, display:"flex", flexDirection:"column", gap:8 }}>
            {filtMsgs.length === 0 && (
              <div style={{ textAlign:"center", color:"#3a5068", fontSize:9, marginTop:40 }}>
                No hay mensajes en {chatCat} aún.<br/>¡Sé el primero en escribir!
              </div>
            )}
            {filtMsgs.map(m => {
              const esPropio = m.uid === user?.id || m.autor === user?.name;
              return (
                <div key={m.id} style={{ display:"flex", flexDirection:"column",
                  alignItems: esPropio ? "flex-end" : "flex-start" }}>
                  {!esPropio && (
                    <div style={{ fontSize:7.5, color:"#3a5068", marginBottom:2, paddingLeft:4 }}>
                      {m.autor} · <span style={{ color:"#4e6a88" }}>{m.rol}</span>
                    </div>
                  )}
                  <div style={{
                    background: esPropio ? "rgba(21,101,192,.25)" : "#090d1a",
                    border: `1px solid ${esPropio ? "rgba(33,150,243,.3)" : "rgba(255,255,255,.05)"}`,
                    borderRadius: esPropio ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    padding:"8px 11px", maxWidth:"85%"
                  }}>
                    <div style={{ fontSize:11, color:"#ccd8e8", lineHeight:1.5 }}>{m.texto}</div>
                    <div style={{ fontSize:7, color:"#3a5068", marginTop:3, textAlign: esPropio?"left":"right" }}>
                      {timeAgo(m.ts)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div style={{ display:"flex", gap:7, alignItems:"flex-end" }}>
            <textarea
              className="inp"
              style={{ flex:1, resize:"none", minHeight:40, maxHeight:100, lineHeight:1.5, paddingTop:9 }}
              placeholder={`Mensaje en ${chatCat}...`}
              value={chatMsg}
              onChange={e => setChatMsg(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMsg(); } }}
            />
            <button className="btn" style={{ width:44, height:44, padding:0, borderRadius:10, fontSize:18, flexShrink:0 }}
              onClick={sendChatMsg}>➤</button>
          </div>
          <div style={{ fontSize:7.5, color:"#3a5068", marginTop:4 }}>Enter para enviar · Shift+Enter para nueva línea</div>
        </>
      );
    }

    // ── STATS ───────────────────────────────
    if (tab === "stats") {
      const total     = players.length;
      const alDia     = players.filter(p => ACTIVE_MONTHS.every(m => pay[p.id]?.months[m]?.paid || pay[p.id]?.months[m]?.exento)).length;
      const yellow    = players.reduce((a,p) => a + ((sanc[p.id] && sanc[p.id].yellows) || 0), 0);
      // Para stats: si filtra por categoría, incluir jugadores de esa cat
      // + jugadores en préstamo que tienen stats en esa categoría
      // Función que obtiene las stats de un jugador para la categoría seleccionada
      function getStatsParaCat(p, cat) {
        if (cat === "Todas") {
          // Suma stats propias + todas las de préstamo
          const propia   = p.stats || { goles:0, asistencias:0, partidos:0 };
          const prestamo = p.statsPorCat || {};
          return {
            goles:       (propia.goles||0)       + Object.values(prestamo).reduce((a,s)=>a+(s.goles||0),0),
            asistencias: (propia.asistencias||0) + Object.values(prestamo).reduce((a,s)=>a+(s.asistencias||0),0),
            partidos:    (propia.partidos||0)    + Object.values(prestamo).reduce((a,s)=>a+(s.partidos||0),0),
          };
        }
        if (p.cat === cat) return p.stats || { goles:0, asistencias:0, partidos:0 };
        // Es préstamo para esa categoría
        return p.statsPorCat?.[cat] || { goles:0, asistencias:0, partidos:0 };
      }

      // Jugadores a mostrar: propios de la cat + préstamos con stats en esa cat
      const filtStat = statCat === "Todas"
        ? players
        : players.filter(p => p.cat === statCat || (p.statsPorCat && p.statsPorCat[statCat]));

      // Enriquecer con stats calculadas para la cat seleccionada
      const filtStatCon = filtStat.map(p => ({ ...p, _stats: getStatsParaCat(p, statCat) }));

      const goleadores = [...filtStatCon]
        .filter(p => (p._stats.goles||0) > 0)
        .sort((a,b) => (b._stats.goles||0) - (a._stats.goles||0))
        .slice(0,10);
      const asistidores = [...filtStatCon]
        .filter(p => (p._stats.asistencias||0) > 0)
        .sort((a,b) => (b._stats.asistencias||0) - (a._stats.asistencias||0))
        .slice(0,10);
      const tarjetados = [...filtStatCon]
        .filter(p => (sanc[p.id]?.yellows||0) > 0 || (sanc[p.id]?.reds||0) > 0)
        .sort((a,b) => (sanc[b.id]?.yellows||0) - (sanc[a.id]?.yellows||0))
        .slice(0,10);
      const masPartidos = [...filtStatCon]
        .filter(p => (p._stats.partidos||0) > 0)
        .sort((a,b) => (b._stats.partidos||0) - (a._stats.partidos||0))
        .slice(0,10);

      return (
        <>
          <div className="st">📊 Estadísticas</div>
          <div className="sr4">
            <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{total}</div><div className="sl">Jugadores</div></div>
            <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{alDia}</div><div className="sl">Al día</div></div>
            <div className="sb"><div className="sn" style={{ color:"#FFD600" }}>{yellow}</div><div className="sl">🟨 Total</div></div>
            <div className="sb"><div className="sn" style={{ color:"#EF9A9A" }}>{players.filter(p=>sanc[p.id]&&sanc[p.id].suspended).length}</div><div className="sl">Susp.</div></div>
          </div>
          {/* Filtro categoría */}
          <div className="dtabs" style={{ marginBottom:8 }}>
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt"+(statCat===c?" da":"")} onClick={()=>setStatCat(c)}>{c}</div>
            ))}
          </div>
          {/* Selector de ranking */}
          <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap" }}>
            {[["goleadores","⚽ Goles"],["asistidores","🎯 Asist."],["tarjetados","🟨 Tarjetas"],["partidos","🏟️ Partidos"],["mvps","🏅 MVPs"]].map(([k,l]) => (
              <button key={k} className={"btn-sm"+(statView===k?" ":" ")} style={{ background: statView===k ? "rgba(33,150,243,.25)" : "rgba(33,150,243,.07)", color: statView===k ? "#7ab3e0" : "#4e6a88", borderColor: statView===k ? "rgba(33,150,243,.4)" : "rgba(33,150,243,.1)" }}
                onClick={()=>setStatView(k)}>{l}</button>
            ))}
          </div>
          {/* Tabla de ranking */}
          <div className="card">
            <div className="ch">
              <span className="ct">
                {statView==="goleadores"?"⚽ Tabla de Goleadores":statView==="asistidores"?"🎯 Tabla de Asistencias":statView==="tarjetados"?"🟨 Tarjetas":statView==="mvps"?"🏅 Ranking MVPs":"🏟️ Partidos Jugados"}
              </span>
              <span className="bg bg-b">{statCat}</span>
            </div>
            {(() => {
              const mvpRanking = [...(statCat==="Todas"?players:players.filter(p=>p.cat===statCat))]
                .map(p => ({ ...p, mvpCount: matches.filter(m=>m.mvp?.playerId===p.id).length }))
                .filter(p=>p.mvpCount>0).sort((a,b)=>b.mvpCount-a.mvpCount);
              const lista = statView==="goleadores" ? goleadores : statView==="asistidores" ? asistidores : statView==="tarjetados" ? tarjetados : statView==="mvps" ? mvpRanking : masPartidos;
              if (lista.length === 0) return <div style={{ fontSize:9, color:"#3a5068", textAlign:"center", padding:"16px 0" }}>Sin datos registrados aún</div>;
              return lista.map((p,i) => {
                // _stats = stats calculadas para la categoría seleccionada (incluye préstamos)
                const _s = p._stats || p.stats || {};
                const valor = statView==="goleadores" ? (_s.goles||0)
                  : statView==="asistidores" ? (_s.asistencias||0)
                  : statView==="tarjetados" ? `🟨${sanc[p.id]?.yellows||0} 🟥${sanc[p.id]?.reds||0}`
                  : statView==="mvps" ? (p.mvpCount||0)
                  : (_s.partidos||0);
                const _g0 = goleadores[0]; const _a0 = asistidores[0]; const _m0 = masPartidos[0];
                const max = statView==="goleadores" ? ((_g0?._stats?.goles||_g0?.stats?.goles)||1)
                  : statView==="asistidores" ? ((_a0?._stats?.asistencias||_a0?.stats?.asistencias)||1)
                  : statView==="tarjetados" ? (sanc[tarjetados[0]?.id]?.yellows||1)
                  : statView==="mvps" ? (mvpRanking[0]?.mvpCount||1)
                  : ((_m0?._stats?.partidos||_m0?.stats?.partidos)||1);
                const pct = statView==="tarjetados" ? Math.round((sanc[p.id]?.yellows||0)/max*100)
                  : statView==="goleadores" ? Math.round((_s.goles||0)/max*100)
                  : statView==="asistidores" ? Math.round((_s.asistencias||0)/max*100)
                  : statView==="mvps" ? Math.round((p.mvpCount||0)/max*100)
                  : Math.round((_s.partidos||0)/max*100);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div style={{ width:18, textAlign:"center", fontSize:9, color: i===0?"#d4b84a":i===1?"#afc4d8":i===2?"#c48a5a":"#3a5068", fontWeight:600 }}>
                      {i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`}
                    </div>
                    <Avatar p={p} size={26} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:10, fontWeight:500 }}>
                        {p.nombre} {p.apellido}
                        {statCat !== "Todas" && p.cat !== statCat && (
                          <span style={{ fontSize:7, color:"#d4b84a", marginLeft:5,
                            background:"rgba(212,184,74,.1)", padding:"1px 4px", borderRadius:3 }}>
                            🔁 {p.cat}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:8, color:"#3a5068" }}>{p.cat} · #{p.num}</div>
                      <div className="pb" style={{ marginTop:3 }}>
                        <div className="pf pf-b" style={{ width:pct+"%" }} />
                      </div>
                    </div>
                    <div style={{ fontSize:16, fontWeight:600, color:"#7ab3e0", minWidth:24, textAlign:"right" }}>{valor}</div>
                    {can("jugadores") && (
                      <button className="btn-sm" style={{ padding:"3px 6px", fontSize:9, background:"rgba(212,184,74,.08)", color:"#d4b84a", borderColor:"rgba(212,184,74,.25)" }}
                        onClick={()=>{ setStatsEditModal(p); setStatsEdit({ goles:p.stats?.goles||0, asistencias:p.stats?.asistencias||0, partidos:p.stats?.partidos||0, mvps:matches.filter(m=>m.mvp?.playerId===p.id).length, yellows:sanc[p.id]?.yellows||0, reds:sanc[p.id]?.reds||0 }); }}>
                        ✏️
                      </button>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          {/* Pagos por categoría */}
          <div className="card">
            <div className="ch"><span className="ct">Pagos por Categoría</span></div>
            {CATS.map(c => {
              const cp  = players.filter(p => p.cat === c);
              const ok  = cp.filter(p => ACTIVE_MONTHS.every(m => pay[p.id]?.months[m]?.paid || pay[p.id]?.months[m]?.exento)).length;
              const pct = cp.length ? Math.round(ok / cp.length * 100) : 0;
              return (
                <div key={c} style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:3 }}>
                    <span>{c}</span>
                    <span style={{ color:"#4e6a88" }}>{ok}/{cp.length} · {pct}%</span>
                  </div>
                  <div className="pb">
                    <div className={"pf " + (pct>=70 ? "pf-b" : "pf-r")} style={{ width: pct + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      );
    }

    // ── ENTRENADORES ────────────────────────
    if (tab === "entrenadores") {
      const isDir = user?.perms?.includes("entrenadores");

      function saveCoach() {
        if (!nc2.name.trim() || !nc2.role.trim() || !nc2.pin || !nc2.tel.trim()) {
          setCoachErr("Nombre, cargo, PIN y teléfono son obligatorios"); return;
        }
        if (!/^\d{4}$/.test(nc2.pin)) { setCoachErr("El PIN debe ser exactamente 4 dígitos"); return; }
        // PIN único
        const pinDup = coaches.find(c => c.pin === nc2.pin && c.id !== editCoachId);
        if (pinDup) { setCoachErr("Ese PIN ya lo usa " + pinDup.name); return; }

        if (editCoachId) {
          safeSetDoc(doc(db, "coaches", String(editCoachId)), { ...nc2, id: String(editCoachId) });
          // Si el entrenador editado es el usuario actual, actualizamos la sesión
          if (user?.id === editCoachId) setUser(u => ({ ...u, ...nc2 }));
        } else {
          const id = String(Date.now());
          safeSetDoc(doc(db, "coaches", id), { ...nc2, id });
        }
        setNc2(COACH_BLANK); setEditCoachId(null); setShowCoachForm(false); setCoachErr("");
      }

      function deleteCoach(c) {
        if (c.perms?.includes("entrenadores")) {
          setCoachErr("No puedes eliminar al Director Técnico"); return;
        }
        setConf({ title:"ELIMINAR ENTRENADOR", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar a " + c.name + "? Esta acción no se puede deshacer.",
          ok: () => safeDeleteDoc(doc(db, "coaches", String(c.id)))
        });
      }

      return (
        <>
          <div className="st">🧑‍💼 Staff Técnico</div>

          {isDir && (
            <button className="btn" style={{ marginBottom:9 }}
              onClick={() => { setNc2(COACH_BLANK); setEditCoachId(null); setCoachErr(""); setShowCoachForm(true); }}>
              + Agregar Entrenador
            </button>
          )}

          <div className="card">
            {coaches.sort((a,b) => a.id > b.id ? 1 : -1).map(c => (
              <div key={c.id} className="crow" style={{ alignItems:"flex-start", paddingBottom:10, marginBottom:6, borderBottom:"1px solid rgba(255,255,255,.03)" }}>
                <div className="av" style={{ background: c.perms?.includes("entrenadores") ? "#0D47A1" : "#1565C0",
                  width:34, height:34, fontSize:14, flexShrink:0 }}>
                  {c.name[0]}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600 }}>{c.name}</div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>{c.role} · {c.cat}</div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>📞 {c.tel}</div>
                  <div className="perms" style={{ marginTop:4 }}>
                    {(c.perms||[]).map(p => <span key={p} className="perm">{p}</span>)}
                  </div>
                  {isDir && (
                    <div style={{ display:"flex", gap:5, marginTop:6 }}>
                      <button className="btn-wa" onClick={() => openWA(c.tel, "Hola " + c.name + ", mensaje del sistema Rómulo FC.")}>📲</button>
                      <button className="btn-sm" style={{ background:"rgba(33,150,243,.12)", color:"#7ab3e0" }}
                        onClick={() => {
                          setNc2({ name:c.name, role:c.role, pin:c.pin, cat:c.cat, tel:c.tel, perms:[...(c.perms||[])] });
                          setEditCoachId(c.id); setCoachErr(""); setShowCoachForm(true);
                        }}>✏️ Editar</button>
                      {!c.perms?.includes("entrenadores") && (
                        <button className="btn-sm" style={{ color:"#e8a0a0" }} onClick={() => deleteCoach(c)}>🗑 Eliminar</button>
                      )}
                    </div>
                  )}
                  {!isDir && (
                    <button className="btn-wa" style={{ marginTop:5 }} onClick={() => openWA(c.tel, "Hola " + c.name + ", mensaje del sistema Rómulo FC.")}>📲</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {coachErr && <div className="err" style={{ marginTop:6 }}>⚠️ {coachErr}</div>}

          {/* ── Modal entrenador ── */}
          {showCoachForm && (
            <div className="ov" onClick={e => { if (e.target.className==="ov") { setShowCoachForm(false); setEditCoachId(null); setNc2(COACH_BLANK); } }}>
              <div className="modal">
                <div className="mt2">
                  {editCoachId ? "✏️ Editar Entrenador" : "➕ Nuevo Entrenador"}
                  <span className="mx" onClick={() => { setShowCoachForm(false); setEditCoachId(null); setNc2(COACH_BLANK); }}>✕</span>
                </div>

                <div className="fsec">Datos personales</div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Nombre completo *</div>
                  <input className="inp" placeholder="Ej: Carlos Mendez" value={nc2.name}
                    onChange={e => setNc2(n => ({ ...n, name:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Cargo / Rol *</div>
                  <input className="inp" placeholder="Ej: Entrenador Sub-11" value={nc2.role}
                    onChange={e => setNc2(n => ({ ...n, role:e.target.value }))} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Teléfono WhatsApp *</div>
                  <input className="inp" placeholder="04XX-XXXXXXX" value={nc2.tel}
                    onChange={e => setNc2(n => ({ ...n, tel:e.target.value }))} />
                </div>

                <div className="fsec">Acceso</div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">PIN (4 dígitos) *</div>
                    <input className="inp" type="password" maxLength={4} placeholder="••••" value={nc2.pin}
                      onChange={e => setNc2(n => ({ ...n, pin:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Categoría</div>
                    <select className="inp" value={nc2.cat} onChange={e => setNc2(n => ({ ...n, cat:e.target.value }))}>
                      <option value="Todas">Todas</option>
                      {CATS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="fsec">Permisos</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
                  {ALL_PERMS.map(p => {
                    const sel = nc2.perms.includes(p);
                    return (
                      <div key={p} className={"dt" + (sel ? " da" : "")} style={{ cursor:"pointer" }}
                        onClick={() => setNc2(n => ({ ...n, perms: sel ? n.perms.filter(x=>x!==p) : [...n.perms, p] }))}>
                        {p}
                      </div>
                    );
                  })}
                </div>

                {coachErr && <div className="err">⚠️ {coachErr}</div>}
                <button className="btn" style={{ marginTop:4 }} onClick={saveCoach}>
                  {editCoachId ? "💾 GUARDAR CAMBIOS" : "✅ AGREGAR ENTRENADOR"}
                </button>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── ENTRENAMIENTOS ──────────────────────
    if (tab === "entrenamientos") {
      const NT_BLANK_T = { fecha:"", hora:"", lugar:"", cats:[], notas:"", tema:"", repetir:false, repetirSemanas:4 };

      function saveTrain() {
        if (!nt.fecha || !nt.hora || !nt.lugar || nt.cats.length===0) {
          setFormErr("Fecha, hora, lugar y categoría son obligatorios"); return;
        }
        if (editTrain) {
          safeSetDoc(doc(db,"trainings",String(editTrain)), { ...nt, id:String(editTrain) });
          setEditTrain(null);
        } else {
          // Crear la sesión principal
          const ids = [];
          if (nt.repetir && nt.repetirSemanas > 1) {
            // Crear N sesiones semanales a partir de la fecha dada
            const [y,m,d] = nt.fecha.split("-").map(Number);
            for (let i=0; i<(parseInt(nt.repetirSemanas)||4); i++) {
              const fd = new Date(y,m-1,d + i*7);
              const fStr = fd.getFullYear()+"-"+String(fd.getMonth()+1).padStart(2,"0")+"-"+String(fd.getDate()).padStart(2,"0");
              const id = String(Date.now()+i);
              safeSetDoc(doc(db,"trainings",id), { ...nt, fecha:fStr, id, repetir:false });
            }
          } else {
            const id = String(Date.now());
            safeSetDoc(doc(db,"trainings",id), { ...nt, id, repetir:false });
          }
        }
        setNt(NT_BLANK_T); setShowTFormT(false); setFormErr(""); setEditTrain(null);
      }

      function deleteTrain(id) {
        setConf({ title:"ELIMINAR ENTRENO", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar esta sesión de entrenamiento?",
          ok: () => safeDeleteDoc(doc(db,"trainings",String(id)))
        });
      }

      function startEdit(t) {
        setNt({ fecha:t.fecha||"", hora:t.hora||"", lugar:t.lugar||"", cats:[...(t.cats||[])],
          notas:t.notas||"", tema:t.tema||"", repetir:false, repetirSemanas:4 });
        setEditTrain(t.id); setShowTFormT(true); setFormErr("");
      }

      const hoy = new Date().toISOString().slice(0,10);
      const proximos = [...trainings].filter(t=>t.fecha&&t.fecha>=hoy).sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
      const pasados  = [...trainings].filter(t=>t.fecha&&t.fecha<hoy).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).slice(0,20);
      const myTrains = user.cat==="Todas" ? proximos : proximos.filter(t=>t.cats?.includes(user.cat));
      const myPast   = user.cat==="Todas" ? pasados  : pasados.filter(t=>t.cats?.includes(user.cat));

      function TrainCard({t}) {
        const esPasado = t.fecha < hoy;
        const fd = t.fecha ? new Date(t.fecha+"T12:00:00") : null;
        const fechaLeg = fd ? fd.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}) : "—";
        return (
          <div className="card" style={{ marginBottom:8, opacity: esPasado ? 0.7 : 1,
            borderLeft: esPasado ? "3px solid rgba(255,255,255,.05)" : "3px solid rgba(33,150,243,.3)" }}>
            <div className="ch" style={{ marginBottom:5 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color: esPasado?"#3a5068":"#afc4d8", letterSpacing:.5 }}>
                    {fechaLeg}
                  </div>
                  {esPasado && <span className="bg bg-n" style={{ fontSize:7 }}>Pasado</span>}
                </div>
                <div style={{ fontSize:8.5, color:"#4e6a88", marginTop:1 }}>⏰ {t.hora} · 📍 {t.lugar}</div>
                {t.tema && <div style={{ fontSize:8.5, color:"#7ab3e0", marginTop:2 }}>📋 {t.tema}</div>}
              </div>
              {can("jugadores") && (
                <div style={{ display:"flex", gap:5 }}>
                  <button className="btn-sm" onClick={()=>startEdit(t)}>✏️</button>
                  <button className="btn-sm" style={{ color:"#e8a0a0" }} onClick={()=>deleteTrain(t.id)}>🗑</button>
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {(t.cats||[]).map(c=><span key={c} className="bg bg-b">{c}</span>)}
            </div>
            {t.notas && <div style={{ fontSize:8, color:"#4e6a88", marginTop:5, borderTop:"1px solid rgba(255,255,255,.03)", paddingTop:5 }}>📝 {t.notas}</div>}
          </div>
        );
      }

      return (
        <>
          <div className="st">🏃 Entrenamientos</div>

          {/* Toggle vista lista / semanal */}
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            {[["lista","📋 Lista"],["semanal","📆 Semanal"]].map(([k,l])=>(
              <button key={k} className="btn-sm"
                style={{ flex:1, fontSize:9,
                  background: (calVista||"lista")===k?"rgba(33,150,243,.2)":"rgba(255,255,255,.03)",
                  color: (calVista||"lista")===k?"#7ab3e0":"#4e6a88",
                  borderColor: (calVista||"lista")===k?"rgba(33,150,243,.4)":"rgba(255,255,255,.05)" }}
                onClick={()=>setCalVista(k)}>{l}</button>
            ))}
          </div>

          {/* Vista semanal de entrenamientos */}
          {(calVista||"lista")==="semanal" && (() => {
            const MESES_N = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
            const DIAS_S  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
            const hoyD = new Date();
            const lunes = new Date(hoyD);
            lunes.setDate(hoyD.getDate() - ((hoyD.getDay()||7)-1) + agendaSemana*7);
            const dias = Array.from({length:7},(_,i)=>{ const d=new Date(lunes); d.setDate(lunes.getDate()+i); return d; });
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana-1)}>‹</button>
                  <span style={{ fontSize:9, color:"#7ab3e0", fontWeight:600 }}>
                    {dias[0].getDate()} {MESES_N[dias[0].getMonth()].slice(0,3)} – {dias[6].getDate()} {MESES_N[dias[6].getMonth()].slice(0,3)}
                  </span>
                  <button className="btn-sm" onClick={()=>setAgendaSemana(agendaSemana+1)}>›</button>
                </div>
                <div style={{ display:"flex", gap:3 }}>
                  {dias.map((date,i)=>{
                    const esHoy = date.toDateString()===hoyD.toDateString();
                    const isoD  = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
                    const entrsDia = (user.cat==="Todas"?trainings:trainings.filter(t=>(t.cats||[]).includes(user.cat)))
                      .filter(t=>t.fecha===isoD);
                    return (
                      <div key={i} style={{ flex:1, minHeight:70, borderRadius:8, padding:"4px 3px",
                        background: esHoy?"rgba(21,101,192,.12)":"rgba(255,255,255,.02)",
                        border:`1px solid ${esHoy?"rgba(33,150,243,.3)":"rgba(255,255,255,.04)"}`,
                        display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ fontSize:7, color:"#3a5068", fontWeight:600 }}>{DIAS_S[date.getDay()]}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:esHoy?"#7ab3e0":"#8a9ab0" }}>{date.getDate()}</div>
                        {entrsDia.map((t,ti)=>(
                          <div key={ti} style={{ borderRadius:3, padding:"1px 3px", width:"90%",
                            background:"rgba(21,101,192,.15)",
                            borderLeft:"2px solid #1976D2",
                            fontSize:6.5, color:"var(--txt)", lineHeight:1.3,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            🏃 {t.tema||t.hora}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {can("jugadores") && (
            <button className="btn" style={{ marginBottom:9 }} onClick={()=>{ setShowTFormT(true); setEditTrain(null); setNt(NT_BLANK_T); setFormErr(""); }}>
              + Agregar Sesión
            </button>
          )}

          {myTrains.length===0 && myPast.length===0 && (
            <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"10px 0" }}>Sin entrenamientos registrados</p></div>
          )}

          {myTrains.length>0 && (
            <>
              <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, marginBottom:5 }}>Próximos</div>
              {myTrains.map(t=><TrainCard key={t.id} t={t}/>)}
            </>
          )}

          {myPast.length>0 && (
            <>
              <div style={{ fontSize:8, color:"#3a5068", textTransform:"uppercase", letterSpacing:.5, margin:"10px 0 5px" }}>Historial</div>
              {myPast.map(t=><TrainCard key={t.id} t={t}/>)}
            </>
          )}

          {showTFormT && (
            <div className="ov" onClick={e=>{ if(e.target.className==="ov"){ setShowTFormT(false); setEditTrain(null); } }}>
              <div className="modal">
                <div className="mt2">{editTrain?"✏️ Editar Sesión":"Nueva Sesión de Entrenamiento"}
                  <span className="mx" onClick={()=>{ setShowTFormT(false); setEditTrain(null); }}>✕</span></div>

                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Fecha *</div>
                    <input className="inp" type="date" value={nt.fecha} onChange={e=>setNt(n=>({...n,fecha:e.target.value}))}/>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Hora *</div>
                    <input className="inp" type="time" value={nt.hora} onChange={e=>setNt(n=>({...n,hora:e.target.value}))}/>
                  </div>
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Lugar *</div>
                    <input className="inp" placeholder="Campo A" value={nt.lugar} onChange={e=>setNt(n=>({...n,lugar:e.target.value}))}/>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Tema</div>
                    <input className="inp" placeholder="Ej: Definición, táctica..." value={nt.tema} onChange={e=>setNt(n=>({...n,tema:e.target.value}))}/>
                  </div>
                </div>

                <div className="inp-wrap">
                  <div className="inp-lbl">Categorías * (selecciona una o varias)</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:3 }}>
                    {CATS.map(cat=>{ const sel=(nt.cats||[]).includes(cat); return (
                      <div key={cat} className={"dt"+(sel?" da":"")} style={{ cursor:"pointer" }}
                        onClick={()=>setNt(n=>({...n,cats:sel?n.cats.filter(x=>x!==cat):[...n.cats,cat]}))}>
                        {cat}
                      </div>
                    ); })}
                  </div>
                </div>

                <div className="inp-wrap">
                  <div className="inp-lbl">Notas (opcional)</div>
                  <input className="inp" placeholder="Ej: Traer peto, trabajo físico..." value={nt.notas} onChange={e=>setNt(n=>({...n,notas:e.target.value}))}/>
                </div>

                {!editTrain && (
                  <div style={{ background:"rgba(21,101,192,.06)", borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600 }}>🔁 Repetir semanalmente</div>
                      <div style={{ display:"flex", gap:6 }}>
                        {["no","si"].map(v=>(
                          <button key={v} onClick={()=>setNt(n=>({...n,repetir:v==="si"}))}
                            className={((nt.repetir&&v==="si")||(!nt.repetir&&v==="no"))?"btn":"btn-sm"}
                            style={{ fontSize:8, padding:"3px 10px" }}>
                            {v==="si"?"Sí":"No"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {nt.repetir && (
                      <div className="inp-wrap">
                        <div className="inp-lbl">¿Cuántas semanas?</div>
                        <select className="inp" value={nt.repetirSemanas} onChange={e=>setNt(n=>({...n,repetirSemanas:e.target.value}))}>
                          {[2,3,4,6,8,12].map(n=><option key={n} value={n}>{n} semanas ({n} sesiones)</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {formErr && <div className="err">⚠️ {formErr}</div>}
                <button className="btn" style={{ marginTop:4 }} onClick={saveTrain}>
                  {editTrain ? "GUARDAR CAMBIOS" : nt.repetir ? `CREAR ${nt.repetirSemanas} SESIONES` : "AGREGAR SESIÓN"}
                </button>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── TORNEO RÁPIDO ───────────────────────
    if (tab === "torneo-rapido") {
      // Estados locales del torneo (todo en memoria + guardado en clubConfig)
      const TR_BLANK = { nombre:"", fecha:"", cat:"Sub-15", equipos:[], partidos:[], fase:"setup" };
      const tr = torneoRapido || (clubConfig?.torneoRapido) || null;

      function crearTorneo(data) {
        // Generar todos los partidos: todos contra todos
        const equips = data.equipos;
        const partidos = [];
        let pid = 1;
        for (let i=0; i<equips.length; i++) {
          for (let j=i+1; j<equips.length; j++) {
            partidos.push({ id: pid++, home: equips[i], away: equips[j],
              scoreH: null, scoreA: null, goleadores: [], jugado: false });
          }
        }
        const nuevo = { ...data, partidos, fase:"partidos", creado: Date.now() };
        setTorneoRapido(nuevo);
        safeSetDoc(doc(db,"config","club"), { ...clubConfig, torneoRapido: nuevo });
        setTrStep(2);
      }

      function guardarResultado(pid, scoreH, scoreA, goleadores) {
        const nuevos = tr.partidos.map(p => p.id===pid
          ? { ...p, scoreH, scoreA, goleadores, jugado:true } : p);
        const upd = { ...tr, partidos: nuevos };
        setTorneoRapido(upd);
        safeSetDoc(doc(db,"config","club"), { ...clubConfig, torneoRapido: upd });
      }

      function cerrarTorneo() {
        setTorneoRapido(null);
        safeSetDoc(doc(db,"config","club"), { ...clubConfig, torneoRapido: null });
        setTrStep(1);
      }

      // Calcular tabla de posiciones
      function calcTabla(equipos, partidos) {
        const tabla = {};
        equipos.forEach(e => { tabla[e] = { pj:0, g:0, emp:0, p:0, gf:0, gc:0, pts:0 }; });
        partidos.filter(p=>p.jugado).forEach(p => {
          const { home, away, scoreH, scoreA } = p;
          if (!tabla[home] || !tabla[away]) return;
          tabla[home].pj++; tabla[away].pj++;
          tabla[home].gf += scoreH; tabla[home].gc += scoreA;
          tabla[away].gf += scoreA; tabla[away].gc += scoreH;
          if (scoreH > scoreA) { tabla[home].g++; tabla[home].pts+=3; tabla[away].p++; }
          else if (scoreH < scoreA) { tabla[away].g++; tabla[away].pts+=3; tabla[home].p++; }
          else { tabla[home].emp++; tabla[home].pts++; tabla[away].emp++; tabla[away].pts++; }
        });
        return Object.entries(tabla)
          .map(([eq,s])=>({eq,...s,dg:s.gf-s.gc}))
          .sort((a,b)=>b.pts-a.pts||b.dg-a.dg||b.gf-a.gf);
      }

      // ── SETUP ──
      if (!tr || trStep===1) {
        return (
          <>
            <div className="st">⚡ Torneo Rápido</div>
            {tr && (
              <div style={{ background:"rgba(212,184,74,.08)", border:"1px solid rgba(212,184,74,.2)",
                borderRadius:8, padding:"8px 10px", marginBottom:10,
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:600, color:"#d4b84a" }}>{tr.nombre}</div>
                  <div style={{ fontSize:8, color:"#8a7040" }}>{tr.fecha} · {tr.cat}</div>
                </div>
                <button className="btn-sm" style={{ color:"#d4b84a", borderColor:"rgba(212,184,74,.3)" }}
                  onClick={()=>setTrStep(2)}>▸ Continuar</button>
              </div>
            )}
            <div className="card">
              <div className="ch"><span className="ct">⚡ Nuevo Torneo</span></div>
              <div className="inp-wrap">
                <div className="inp-lbl">Nombre del torneo *</div>
                <input className="inp" placeholder="Ej: Copa Interna Sub-15" value={trNombre} onChange={e=>setTrNombre(e.target.value)}/>
              </div>
              <div className="inp-2">
                <div className="inp-wrap">
                  <div className="inp-lbl">Fecha</div>
                  <input className="inp" placeholder="22 Mar 2026" value={trFecha} onChange={e=>setTrFecha(e.target.value)}/>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Categoría</div>
                  <select className="inp" value={trCat} onChange={e=>setTrCat(e.target.value)}>
                    {CATS.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="inp-wrap">
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                  <div className="inp-lbl">Equipos * (4 a 8)</div>
                  {trEquips.length < 8 && (
                    <button className="btn-sm" style={{ fontSize:8, padding:"2px 8px" }}
                      onClick={()=>setTrEquips(e=>[...e,""])}>+ Equipo</button>
                  )}
                </div>
                {trEquips.map((eq,i) => (
                  <div key={i} style={{ display:"flex", gap:5, marginBottom:5 }}>
                    <input className="inp" style={{ flex:1 }} placeholder={"Equipo "+(i+1)}
                      value={eq} onChange={e=>setTrEquips(prev=>prev.map((x,j)=>j===i?e.target.value:x))}/>
                    {trEquips.length > 2 && (
                      <button className="btn-sm" style={{ color:"#e8a0a0", padding:"0 8px" }}
                        onClick={()=>setTrEquips(prev=>prev.filter((_,j)=>j!==i))}>✕</button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize:7.5, color:"#3a5068", marginTop:3 }}>
                  {trEquips.filter(e=>e.trim()).length >= 2
                    ? `${Math.round(trEquips.filter(e=>e.trim()).length*(trEquips.filter(e=>e.trim()).length-1)/2)} partidos en total`
                    : "Agrega al menos 2 equipos"}
                </div>
              </div>
              {trErr && <div className="err">⚠️ {trErr}</div>}
              <button className="btn" style={{ marginTop:6 }} onClick={()=>{
                const equips = trEquips.map(e=>e.trim()).filter(Boolean);
                if (!trNombre.trim()) { setTrErr("Ingresa el nombre del torneo"); return; }
                if (equips.length < 2) { setTrErr("Agrega al menos 2 equipos"); return; }
                if (equips.length > 8) { setTrErr("Máximo 8 equipos"); return; }
                crearTorneo({ nombre:trNombre.trim(), fecha:trFecha, cat:trCat, equipos:equips });
              }}>
                ⚡ CREAR TORNEO ({trEquips.filter(e=>e.trim()).length} equipos)
              </button>
            </div>
          </>
        );
      }

      // ── PARTIDOS Y TABLA ──
      const tabla = calcTabla(tr.equipos, tr.partidos);
      const jugados = tr.partidos.filter(p=>p.jugado).length;
      const total   = tr.partidos.length;

      return (
        <>
          <div className="st">⚡ {tr.nombre}</div>

          {/* Header */}
          <div style={{ background:"rgba(212,184,74,.08)", border:"1px solid rgba(212,184,74,.2)",
            borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:8, color:"#8a7040" }}>{tr.fecha} · {tr.cat}</div>
                <div style={{ fontSize:9, color:"#4e6a88", marginTop:2 }}>{jugados}/{total} partidos jugados</div>
              </div>
              <div style={{ display:"flex", gap:5 }}>
                <button className="btn-sm" style={{ fontSize:8 }} onClick={()=>setTrStep(trStep===2?3:2)}>
                  {trStep===2?"📊 Ver tabla":"⚽ Ver partidos"}
                </button>
                <button className="btn-sm" style={{ fontSize:8, color:"#e8a0a0" }}
                  onClick={()=>setConf({ title:"CERRAR TORNEO", danger:true, okTxt:"Cerrar",
                    msg:"¿Cerrar el torneo "+tr.nombre+"?", ok:cerrarTorneo })}>
                  ✕ Cerrar
                </button>
              </div>
            </div>
            <div className="pb" style={{ marginTop:8 }}>
              <div className="pf pf-b" style={{ width:(jugados/total*100)+"%" }}/>
            </div>
          </div>

          {/* Vista partidos */}
          {trStep===2 && tr.partidos.map(p => (
            <TrPartidoCard key={p.id} p={p} canEdit={can("partido")} onSave={guardarResultado}/>
          ))}

          {/* Vista tabla */}
          {trStep===3 && (
            <div className="card">
              <div className="ch"><span className="ct">📊 Tabla de Posiciones</span></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 30px 30px 30px 30px 30px 35px",
                gap:3, fontSize:7.5, color:"#3a5068", padding:"4px 0", borderBottom:"1px solid rgba(255,255,255,.05)",
                fontWeight:600, textTransform:"uppercase", letterSpacing:.3 }}>
                <span>Equipo</span><span style={{textAlign:"center"}}>PJ</span>
                <span style={{textAlign:"center"}}>G</span><span style={{textAlign:"center"}}>E</span>
                <span style={{textAlign:"center"}}>P</span><span style={{textAlign:"center"}}>DG</span>
                <span style={{textAlign:"center",color:"#d4b84a"}}>PTS</span>
              </div>
              {tabla.map((row,i)=>(
                <div key={row.eq} style={{ display:"grid",
                  gridTemplateColumns:"1fr 30px 30px 30px 30px 30px 35px",
                  gap:3, padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.03)",
                  alignItems:"center",
                  background: i===0?"rgba(212,184,74,.05)":"transparent" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14,
                      color: i===0?"#d4b84a":i===1?"#afc4d8":i===2?"#c48a5a":"#4e6a88" }}>
                      {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                    </span>
                    <span style={{ fontSize:9, fontWeight: i===0?600:400 }}>{row.eq}</span>
                  </div>
                  <span style={{textAlign:"center",fontSize:8.5,color:"#7ab3e0"}}>{row.pj}</span>
                  <span style={{textAlign:"center",fontSize:8.5,color:"#2196F3"}}>{row.g}</span>
                  <span style={{textAlign:"center",fontSize:8.5,color:"#4e6a88"}}>{row.emp}</span>
                  <span style={{textAlign:"center",fontSize:8.5,color:"#E53935"}}>{row.p}</span>
                  <span style={{textAlign:"center",fontSize:8.5,color:row.dg>0?"#7ab3e0":row.dg<0?"#e8a0a0":"#4e6a88"}}>
                    {row.dg>0?"+":""}{row.dg}
                  </span>
                  <span style={{textAlign:"center",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#d4b84a"}}>
                    {row.pts}
                  </span>
                </div>
              ))}
              {jugados < total && (
                <div style={{ fontSize:8, color:"#3a5068", textAlign:"center", marginTop:8 }}>
                  Quedan {total-jugados} partido{total-jugados>1?"s":""} por jugar
                </div>
              )}
              {jugados === total && tabla[0] && (
                <div style={{ background:"rgba(212,184,74,.08)", borderRadius:8, padding:"10px",
                  marginTop:8, textAlign:"center" }}>
                  <div style={{ fontSize:11 }}>🏆</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#d4b84a" }}>
                    {tabla[0].eq}
                  </div>
                  <div style={{ fontSize:8, color:"#8a7040" }}>Campeón del torneo</div>
                </div>
              )}
            </div>
          )}
        </>
      );
    }

    // ── CAMPEONATOS ─────────────────────────
    if (tab === "campeonatos") {

      function saveChamp() {
        if (!nc.nombre.trim()) { setFormErr("El nombre es obligatorio"); return; }
        const id = String(Date.now());
        safeSetDoc(doc(db, "champs", id), { ...nc, id, nombre: nc.nombre.trim(), standings:[], fase:"grupos", llaves:[] });
        setNc({ nombre:"", cats:[], activo:true, link:"", minET:5 });
        setShowCForm(false); setFormErr("");
        addNotif("🏆 Nuevo campeonato: " + nc.nombre.trim() + " · " + (nc.cats||[]).join(", "), "campeonatos", "all", "campeonato");
      }
      function toggleChampActive(id) {
        const ch = champs.find(c => c.id === id);
        if (ch) safeSetDoc(doc(db, "champs", String(id)), { ...ch, activo: !ch.activo });
      }
      function deleteChamp(id) {
        setConf({ title:"ELIMINAR CAMPEONATO", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar este campeonato? Se perderán los datos.",
          ok: () => { safeDeleteDoc(doc(db, "champs", String(id))); if (expandChamp===id) setExpandChamp(null); }
        });
      }
      function saveRow(champId) {
        if (!nsRow.equipo.trim()) return;
        const row = { ...nsRow, equipo: nsRow.equipo.trim(),
          pj: parseInt(nsRow.pj)||0, g: parseInt(nsRow.g)||0,
          e: parseInt(nsRow.e)||0,   p: parseInt(nsRow.p)||0,
          gf: parseInt(nsRow.gf)||0, gc: parseInt(nsRow.gc)||0 };
        row.pts = row.g * 3 + row.e;
        row.dg  = row.gf - row.gc;
        const ch = champs.find(c => c.id === champId);
        if (!ch) return;
        let standings;
        if (editStanding && editStanding.equipo) {
          standings = ch.standings.map(r => r.equipo === editStanding.equipo ? row : r).sort((a,b) => b.pts - a.pts || b.dg - a.dg);
        } else {
          standings = [...ch.standings, row].sort((a,b) => b.pts - a.pts || b.dg - a.dg);
        }
        safeSetDoc(doc(db, "champs", String(champId)), { ...ch, standings });
        setNsRow({ equipo:"", pj:0, g:0, e:0, p:0, gf:0, gc:0 });
        setEditStanding(null);
      }
      function deleteRow(champId, equipo) {
        const ch = champs.find(c => c.id === champId);
        if (!ch) return;
        safeSetDoc(doc(db, "champs", String(champId)), { ...ch, standings: ch.standings.filter(r => r.equipo !== equipo) });
      }
      function startEditRow(champId, row) {
        setEditStanding({ champId, equipo: row.equipo });
        setNsRow({ equipo:row.equipo, pj:row.pj, g:row.g, e:row.e, p:row.p, gf:row.gf, gc:row.gc });
      }

      // ── Fase eliminatoria ──
      const RONDAS_KO = [
        { key:"Octavos",   label:"⚔️ Octavos de Final",   partidos:8 },
        { key:"Cuartos",   label:"⚔️ Cuartos de Final",   partidos:4 },
        { key:"Semifinal", label:"🏆 Semifinal",           partidos:2 },
        { key:"Final",     label:"🥇 Final",               partidos:1 },
      ];
      const RONDA_ORDER = ["Octavos","Cuartos","Semifinal","Final"];

      function iniciarEliminatoria(ch, rondaInicio) {
        const nPartidos = { Octavos:8, Cuartos:4, Semifinal:2, Final:1 }[rondaInicio];
        const llaves = Array.from({ length: nPartidos }, (_,i) => ({
          id: String(Date.now()) + i,
          local: "", visitante: "", ronda: rondaInicio,
          scoreLocal: null, scoreVisitante: null, ganador: null
        }));
        safeSetDoc(doc(db, "champs", String(ch.id)), { ...ch, fase:"eliminatoria", rondaActual: rondaInicio, llaves });
        setConf(null);
      }

      function avanzarRonda(ch) {
        const idx = RONDA_ORDER.indexOf(ch.rondaActual);
        if (idx === -1 || idx >= RONDA_ORDER.length - 1) return;
        const siguienteRonda = RONDA_ORDER[idx + 1];
        const nPartidos = { Octavos:4, Cuartos:2, Semifinal:1, Final:0 }[ch.rondaActual];
        const nuevasLlaves = Array.from({ length: nPartidos }, (_,i) => ({
          id: String(Date.now()) + i,
          local: "", visitante: "", ronda: siguienteRonda,
          scoreLocal: null, scoreVisitante: null, ganador: null
        }));
        const llavesAnt = (ch.llaves || []).map(l => ({ ...l }));
        safeSetDoc(doc(db, "champs", String(ch.id)), {
          ...ch, rondaActual: siguienteRonda,
          llaves: [...llavesAnt, ...nuevasLlaves]
        });
      }

      function saveLlave(ch, llave) {
        const llaves = (ch.llaves || []).map(l => l.id === llave.id ? llave : l);
        safeSetDoc(doc(db, "champs", String(ch.id)), { ...ch, llaves });
      }

      const thS = { fontSize:7.5, color:"#3a5068", textAlign:"center", padding:"4px 3px", fontWeight:500, letterSpacing:.3, textTransform:"uppercase" };
      const tdS = (isRFC, bold) => ({ fontSize:bold?10:9, textAlign:"center", padding:"5px 3px", color: isRFC ? "#7ab3e0" : "#afc4d8", fontWeight: bold ? 700 : 400 });
      const tdTeam = (isRFC) => ({ fontSize:9.5, padding:"5px 4px", color: isRFC ? "#7ab3e0" : "#afc4d8", fontWeight: isRFC ? 700 : 400, maxWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" });

      return (
        <>
          <div className="st">🏆 Campeonatos</div>
          {can("pagos") && (
            <button className="btn" style={{ marginBottom:9 }} onClick={() => { setShowCForm(v => !v); setFormErr(""); setNc({ nombre:"", cats:[], activo:true, link:"", minET:5 }); }}>
              {showCForm ? "✕ Cancelar" : "+ Agregar Campeonato"}
            </button>
          )}

          {showCForm && (
            <div className="card" style={{ marginBottom:9, border:"1px solid rgba(33,150,243,.18)" }}>
              <div className="ch" style={{ marginBottom:8 }}>
                <span className="ct">Nuevo Campeonato</span>
                <span className="mx" style={{ cursor:"pointer" }} onClick={() => { setShowCForm(false); setNc({ nombre:"", cats:[], activo:true, link:"", minET:5 }); }}>✕</span>
              </div>
              <div className="inp-wrap">
                <div className="inp-lbl">Nombre *</div>
                <input className="inp" placeholder="Ej: Liga Regional 2026" value={nc.nombre} onChange={e => setNc(n => ({ ...n, nombre:e.target.value }))} />
              </div>
              <div className="inp-wrap">
                <div className="inp-lbl">Categorías (opcional)</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:3 }}>
                  {CATS.map(c => {
                    const sel = nc.cats.includes(c);
                    return (
                      <div key={c} className={"dt" + (sel ? " da" : "")} style={{ cursor:"pointer" }}
                        onClick={() => setNc(n => ({ ...n, cats: sel ? n.cats.filter(x=>x!==c) : [...n.cats,c] }))}>
                        {c}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="inp-wrap">
                <div className="inp-lbl">⚡ Duración del tiempo extra (minutos)</div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  {[3,5,7,10].map(m => (
                    <div key={m} className={"dt" + (nc.minET===m ? " da" : "")} style={{ cursor:"pointer", minWidth:36, textAlign:"center" }}
                      onClick={() => setNc(n => ({ ...n, minET:m }))}>
                      {m} min
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:8, color:"#4e6a88", marginTop:4 }}>
                  Se aplica en fases eliminatorias al terminar empatados
                </div>
              </div>
              <div className="inp-wrap">
                <div className="inp-lbl">Link oficial (opcional)</div>
                <input className="inp" placeholder="https://..." value={nc.link} onChange={e => setNc(n => ({ ...n, link:e.target.value }))} />
              </div>
              {formErr && <div className="err">⚠️ {formErr}</div>}
              <button className="btn" style={{ marginTop:6 }} onClick={saveChamp}>GUARDAR CAMPEONATO</button>
            </div>
          )}

          {champs.length === 0 && !showCForm && (
            <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"10px 0" }}>Sin campeonatos registrados</p></div>
          )}

          {champs.map(ch => {
            const champPlayers = players.filter(p => ch.cats.length === 0 || ch.cats.includes(p.cat));
            const paid   = champPlayers.filter(p => pay[p.id]?.championships?.[ch.id]?.paid).length;
            const total  = champPlayers.length;
            const pct    = total ? Math.round(paid / total * 100) : 0;
            const isOpen = expandChamp === ch.id;
            const isEditingThis = editStanding && editStanding.champId === ch.id;
            const esEliminatoria = ch.fase === "eliminatoria";
            const equipos = (ch.standings || []).map(s => s.equipo);

            return (
              <div key={ch.id} className={"card" + (ch.activo ? "" : " card-r")} style={{ marginBottom:8 }}>

                {/* ── CABECERA ── */}
                <div className="ch" style={{ marginBottom:6 }}>
                  <div style={{ flex:1, cursor:"pointer" }} onClick={() => setExpandChamp(isOpen ? null : ch.id)}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:17, letterSpacing:.5, color: ch.activo ? "#afc4d8" : "#4e6a88" }}>
                      {isOpen ? "▾ " : "▸ "}{ch.nombre}
                    </div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
                      {ch.cats.length > 0 ? ch.cats.map(c => <span key={c} className="bg bg-b">{c}</span>) : <span className="bg bg-n">Todas</span>}
                      <span className={"bg " + (ch.activo ? "bg-b" : "bg-n")}>{ch.activo ? "Activo" : "Inactivo"}</span>
                      <span className="bg" style={{ background: esEliminatoria ? "rgba(212,184,74,.15)" : "rgba(33,150,243,.1)", color: esEliminatoria ? "#d4b84a" : "#7ab3e0", border: esEliminatoria ? "1px solid rgba(212,184,74,.3)" : "1px solid rgba(33,150,243,.2)" }}>
                        {esEliminatoria ? "⚔️ " + (ch.rondaActual || "Eliminatoria") : "📊 Grupos"}
                      </span>
                      {!esEliminatoria && ch.standings && ch.standings.length > 0 && <span className="bg bg-y">📊 {ch.standings.length} equipos</span>}
                    </div>
                  </div>
                  {can("pagos") && (
                    <div style={{ display:"flex", gap:5 }}>
                      <button className="btn-sm" onClick={() => toggleChampActive(ch.id)}>{ch.activo ? "Pausar" : "Activar"}</button>
                      <button className="btn-sm" style={{ color:"#e8a0a0" }} onClick={() => deleteChamp(ch.id)}>🗑</button>
                    </div>
                  )}
                </div>

                {/* ── CONTENIDO EXPANDIDO ── */}
                {isOpen && (
                  <>
                    {/* Link oficial */}
                    {(ch.link || can("pagos")) && (
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:9 }}>
                        {ch.link
                          ? <button className="btn-wa" style={{ flex:1, justifyContent:"center" }}
                              onClick={() => window.open(ch.link, "_blank")}>
                              🌐 Ver tabla oficial
                            </button>
                          : can("pagos") && <span style={{ fontSize:8, color:"#3a5068" }}>Sin link oficial</span>
                        }
                        {can("pagos") && (
                          <input className="inp" style={{ flex:2, fontSize:9 }} placeholder="Pegar link oficial..."
                            value={ch.link || ""}
                            onChange={e => setChamps(cs => cs.map(c => c.id===ch.id ? { ...c, link:e.target.value } : c))}
                          />
                        )}
                      </div>
                    )}

                    {/* ═══ FASE GRUPOS ═══ */}
                    {!esEliminatoria && (
                      <>
                        <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600, letterSpacing:.5, marginBottom:6, textTransform:"uppercase" }}>
                          📊 Tabla de Posiciones
                        </div>

                        {ch.standings && ch.standings.length > 0 ? (
                          <div style={{ overflowX:"auto", marginBottom:8 }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                              <thead>
                                <tr style={{ borderBottom:"1px solid rgba(33,150,243,.1)" }}>
                                  <th style={{ ...thS, textAlign:"left", width:24 }}>#</th>
                                  <th style={{ ...thS, textAlign:"left" }}>Equipo</th>
                                  <th style={thS}>PJ</th>
                                  <th style={thS}>G</th>
                                  <th style={thS}>E</th>
                                  <th style={thS}>P</th>
                                  <th style={thS}>GF</th>
                                  <th style={thS}>GC</th>
                                  <th style={thS}>DG</th>
                                  <th style={{ ...thS, color:"#d4b84a" }}>PTS</th>
                                  {can("pagos") && <th style={thS}></th>}
                                </tr>
                              </thead>
                              <tbody>
                                {ch.standings.map((row, idx) => {
                                  const isRFC = row.equipo === "Rómulo FC";
                                  const isFirst = idx === 0;
                                  return (
                                    <tr key={row.equipo} style={{ borderBottom:"1px solid rgba(255,255,255,.02)", background: isRFC ? "rgba(21,101,192,.06)" : "transparent" }}>
                                      <td style={{ ...tdS(isRFC), textAlign:"left", fontSize:9 }}>
                                        {isFirst ? "🥇" : idx===1 ? "🥈" : idx===2 ? "🥉" : idx+1}
                                      </td>
                                      <td style={tdTeam(isRFC)}>{row.equipo}{isRFC ? " ⚽" : ""}</td>
                                      <td style={tdS(isRFC)}>{row.pj}</td>
                                      <td style={tdS(isRFC)}>{row.g}</td>
                                      <td style={tdS(isRFC)}>{row.e}</td>
                                      <td style={tdS(isRFC)}>{row.p}</td>
                                      <td style={tdS(isRFC)}>{row.gf}</td>
                                      <td style={tdS(isRFC)}>{row.gc}</td>
                                      <td style={tdS(isRFC)}>{row.dg > 0 ? "+"+row.dg : row.dg}</td>
                                      <td style={{ ...tdS(isRFC, true), color: isFirst ? "#d4b84a" : isRFC ? "#7ab3e0" : "#afc4d8" }}>{row.pts}</td>
                                      {can("pagos") && (
                                        <td style={{ textAlign:"center" }}>
                                          <button className="btn-sm" style={{ padding:"2px 5px", fontSize:8 }} onClick={() => startEditRow(ch.id, row)}>✏️</button>
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"8px 0", marginBottom:8 }}>Sin equipos en la tabla aún</p>
                        )}

                        {/* Formulario agregar/editar equipo */}
                        {can("pagos") && (
                          <div style={{ background:"var(--inp)", borderRadius:9, padding:"10px", border:"1px solid rgba(33,150,243,.08)", marginBottom:9 }}>
                            <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600, marginBottom:7, textTransform:"uppercase", letterSpacing:.3 }}>
                              {isEditingThis ? "✏️ Editar equipo" : "+ Agregar equipo"}
                            </div>
                            <div className="inp-wrap">
                              <input className="inp" style={{ fontSize:10 }} placeholder="Nombre del equipo" value={nsRow.equipo} onChange={e => setNsRow(n => ({ ...n, equipo:e.target.value }))} />
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:4, marginBottom:7 }}>
                              {[["pj","PJ"],["g","G"],["e","E"],["p","P"],["gf","GF"],["gc","GC"]].map(([k,l]) => (
                                <div key={k}>
                                  <div style={{ fontSize:7, color:"#3a5068", textAlign:"center", marginBottom:2 }}>{l}</div>
                                  <input className="inp" style={{ textAlign:"center", padding:"5px 2px", fontSize:11 }} type="number" min="0"
                                    value={nsRow[k]} onChange={e => setNsRow(n => ({ ...n, [k]: e.target.value }))} />
                                </div>
                              ))}
                            </div>
                            <div style={{ display:"flex", gap:6 }}>
                              <button className="btn" style={{ flex:1, padding:8, fontSize:11 }} onClick={() => saveRow(ch.id)}>
                                {isEditingThis ? "GUARDAR CAMBIOS" : "AGREGAR"}
                              </button>
                              {isEditingThis && (
                                <>
                                  <button className="btn-sm" style={{ color:"#e8a0a0", padding:"8px 10px" }}
                                    onClick={() => deleteRow(ch.id, editStanding.equipo)}>🗑</button>
                                  <button className="btn-sm" style={{ padding:"8px 10px" }}
                                    onClick={() => { setEditStanding(null); setNsRow({ equipo:"", pj:0, g:0, e:0, p:0, gf:0, gc:0 }); }}>✕</button>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Botón iniciar fase eliminatoria */}
                        {can("pagos") && ch.standings && ch.standings.length >= 2 && (
                          <div style={{ background:"rgba(212,184,74,.06)", border:"1px solid rgba(212,184,74,.2)", borderRadius:9, padding:"10px", marginBottom:9 }}>
                            <div style={{ fontSize:9, color:"#d4b84a", fontWeight:600, marginBottom:6 }}>⚔️ Iniciar Fase Eliminatoria</div>
                            <div style={{ fontSize:8, color:"#4e6a88", marginBottom:8 }}>Selecciona desde qué ronda empieza la fase KO:</div>
                            <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                              {RONDAS_KO.map(r => (
                                <div key={r.key}
                                  className={"dt" + (nsRow._rondaKO === r.key ? " da" : "")}
                                  style={{ cursor:"pointer", fontSize:9, borderColor: nsRow._rondaKO === r.key ? "#d4b84a" : undefined, color: nsRow._rondaKO === r.key ? "#d4b84a" : undefined }}
                                  onClick={() => setNsRow(n => ({ ...n, _rondaKO: r.key }))}>
                                  {r.label}
                                </div>
                              ))}
                            </div>
                            {nsRow._rondaKO && (
                              <button className="btn" style={{ width:"100%", background:"rgba(212,184,74,.15)", borderColor:"rgba(212,184,74,.4)", color:"#d4b84a" }}
                                onClick={() => setConf({
                                  title:"¿Iniciar Fase Eliminatoria?",
                                  msg:"La tabla de grupos quedará guardada pero la vista cambiará al formato copa desde " + nsRow._rondaKO + ". Esta acción no se puede deshacer fácilmente.",
                                  okTxt:"Iniciar ⚔️", danger:false,
                                  ok: () => { iniciarEliminatoria(ch, nsRow._rondaKO); setNsRow(n => ({ ...n, _rondaKO: null })); }
                                })}>
                                ⚔️ Confirmar inicio de fase eliminatoria
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* ═══ FASE ELIMINATORIA ═══ */}
                    {esEliminatoria && (
                      <>
                        {/* Tabs por ronda */}
                        <div className="dtabs" style={{ marginBottom:10 }}>
                          {RONDA_ORDER.filter(r => {
                            const idxR = RONDA_ORDER.indexOf(r);
                            const idxAct = RONDA_ORDER.indexOf(ch.rondaActual || "Final");
                            const idxInicio = RONDA_ORDER.indexOf((ch.llaves||[]).find(()=>true)?.ronda || ch.rondaActual);
                            return idxR >= idxInicio && idxR <= idxAct;
                          }).map(r => (
                            <div key={r}
                              className={"dt" + ((nsRow._tabRonda || ch.rondaActual) === r ? " da" : "")}
                              style={{ cursor:"pointer" }}
                              onClick={() => setNsRow(n => ({ ...n, _tabRonda: r }))}>
                              {r === "Octavos" ? "8vos" : r === "Cuartos" ? "4tos" : r === "Semifinal" ? "Semi" : "Final"}
                            </div>
                          ))}
                        </div>

                        {/* Llaves de la ronda seleccionada */}
                        {(() => {
                          const rondaVista = nsRow._tabRonda || ch.rondaActual;
                          const llavesRonda = (ch.llaves || []).filter(l => l.ronda === rondaVista);
                          return (
                            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:10 }}>
                              {llavesRonda.map((ll, idx) => (
                                <div key={ll.id} style={{ background:"var(--inp)", borderRadius:9, padding:"10px", border:"1px solid rgba(33,150,243,.1)" }}>
                                  <div style={{ fontSize:8, color:"#4e6a88", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 }}>
                                    Llave {idx+1} · {rondaVista}
                                    {ll.ganador && <span style={{ color:"#d4b84a", marginLeft:6 }}>🏆 {ll.ganador}</span>}
                                  </div>
                                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                    {/* Local */}
                                    <div style={{ flex:1 }}>
                                      {can("pagos") ? (
                                        <select className="inp" style={{ fontSize:10 }} value={ll.local}
                                          onChange={e => saveLlave(ch, { ...ll, local: e.target.value })}>
                                          <option value="">— Equipo local —</option>
                                          {equipos.map(eq => <option key={eq} value={eq}>{eq}</option>)}
                                        </select>
                                      ) : (
                                        <div style={{ fontSize:11, color:"var(--txt)", fontWeight:600, padding:"6px 0" }}>{ll.local || "Por definir"}</div>
                                      )}
                                    </div>

                                    {/* Marcador */}
                                    <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                                      {can("pagos") ? (
                                        <>
                                          <input type="number" min="0" className="inp" style={{ width:36, textAlign:"center", padding:"5px 3px", fontSize:14, fontFamily:"'Bebas Neue',sans-serif", color:"#2196F3" }}
                                            value={ll.scoreLocal ?? ""}
                                            onChange={e => saveLlave(ch, { ...ll, scoreLocal: e.target.value === "" ? null : parseInt(e.target.value) })} />
                                          <span style={{ color:"#4e6a88", fontFamily:"'Bebas Neue',sans-serif", fontSize:14 }}>–</span>
                                          <input type="number" min="0" className="inp" style={{ width:36, textAlign:"center", padding:"5px 3px", fontSize:14, fontFamily:"'Bebas Neue',sans-serif", color:"#E53935" }}
                                            value={ll.scoreVisitante ?? ""}
                                            onChange={e => saveLlave(ch, { ...ll, scoreVisitante: e.target.value === "" ? null : parseInt(e.target.value) })} />
                                        </>
                                      ) : (
                                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0" }}>
                                          {ll.scoreLocal !== null && ll.scoreVisitante !== null ? `${ll.scoreLocal} – ${ll.scoreVisitante}` : "vs"}
                                        </div>
                                      )}
                                    </div>

                                    {/* Visitante */}
                                    <div style={{ flex:1 }}>
                                      {can("pagos") ? (
                                        <select className="inp" style={{ fontSize:10 }} value={ll.visitante}
                                          onChange={e => saveLlave(ch, { ...ll, visitante: e.target.value })}>
                                          <option value="">— Equipo visitante —</option>
                                          {equipos.map(eq => <option key={eq} value={eq}>{eq}</option>)}
                                        </select>
                                      ) : (
                                        <div style={{ fontSize:11, color:"var(--txt)", fontWeight:600, padding:"6px 0", textAlign:"right" }}>{ll.visitante || "Por definir"}</div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Ganador */}
                                  {can("pagos") && ll.local && ll.visitante && ll.scoreLocal !== null && ll.scoreVisitante !== null && (
                                    <div style={{ display:"flex", gap:5, marginTop:7 }}>
                                      <div style={{ fontSize:8, color:"#4e6a88", alignSelf:"center" }}>Ganador:</div>
                                      {[ll.local, ll.visitante].map(eq => (
                                        <button key={eq} className="btn-sm"
                                          style={{ flex:1, fontSize:9, padding:"5px 6px",
                                            background: ll.ganador === eq ? "rgba(212,184,74,.2)" : "rgba(33,150,243,.07)",
                                            borderColor: ll.ganador === eq ? "rgba(212,184,74,.5)" : "rgba(33,150,243,.15)",
                                            color: ll.ganador === eq ? "#d4b84a" : "#7ab3e0" }}
                                          onClick={() => saveLlave(ch, { ...ll, ganador: ll.ganador === eq ? null : eq })}>
                                          {ll.ganador === eq ? "🏆 " : ""}{eq}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {/* Avanzar ronda */}
                        {can("pagos") && ch.rondaActual !== "Final" && (
                          <button className="btn" style={{ width:"100%", marginBottom:9, background:"rgba(212,184,74,.12)", borderColor:"rgba(212,184,74,.3)", color:"#d4b84a" }}
                            onClick={() => setConf({
                              title:"¿Avanzar a siguiente ronda?",
                              msg:"Se crearán las llaves de la siguiente ronda. Podrás asignar los equipos manualmente.",
                              okTxt:"Avanzar ⚔️", danger:false,
                              ok: () => avanzarRonda(ch)
                            })}>
                            ⚔️ Avanzar a siguiente ronda
                          </button>
                        )}

                        {/* Campeón */}
                        {ch.rondaActual === "Final" && (() => {
                          const finalLlave = (ch.llaves||[]).find(l => l.ronda === "Final");
                          return finalLlave?.ganador ? (
                            <div style={{ textAlign:"center", padding:"12px", background:"rgba(212,184,74,.08)", borderRadius:9, border:"1px solid rgba(212,184,74,.3)", marginBottom:9 }}>
                              <div style={{ fontSize:28, marginBottom:4 }}>🏆</div>
                              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#d4b84a", letterSpacing:1 }}>CAMPEÓN</div>
                              <div style={{ fontSize:16, color:"#fff", fontWeight:700, marginTop:4 }}>{finalLlave.ganador}</div>
                            </div>
                          ) : null;
                        })()}
                      </>
                    )}

                    {/* Pagos inscripción */}
                    {total > 0 && (
                      <>
                        <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600, letterSpacing:.5, marginBottom:6, textTransform:"uppercase" }}>
                          💳 Inscripciones
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:4 }}>
                          <span style={{ color:"#4e6a88" }}>Pagadas</span>
                          <span style={{ color:"#7ab3e0", fontWeight:500 }}>{paid}/{total} · {pct}%</span>
                        </div>
                        <div className="pb" style={{ marginBottom:8 }}>
                          <div className="pf pf-b" style={{ width: pct + "%" }} />
                        </div>
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {champPlayers.map(p => {
                            const ok = pay[p.id]?.championships?.[ch.id]?.paid;
                            return (
                              <div key={p.id} title={p.nombre + " " + p.apellido}
                                onClick={() => can("pagos") && toggleChamp(p.id, ch.id)}
                                style={{ width:28, height:28, borderRadius:"50%",
                                  background: ok ? "#1565C0" : "rgba(229,57,53,.15)",
                                  border: ok ? "2px solid #2196F3" : "2px solid rgba(229,57,53,.3)",
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                  fontSize:10, fontWeight:600, cursor: can("pagos") ? "pointer" : "default",
                                  color: ok ? "#fff" : "#e8a0a0" }}>
                                {p.nombre[0]}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ fontSize:7.5, color:"#3a5068", marginTop:5 }}>Toca el avatar para marcar/desmarcar pago</div>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>
      );
    }

    // ── CONFIGURACIÓN ───────────────────────
    if (tab === "config") {
      const cfgView = editConfig ? cfgDraft : clubConfig;

      function generateMonthlyReport() {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        script.onload = () => {
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
          const W = 210, pad = 16;
          const mesActual = new Date().toLocaleString("es",{month:"long",year:"numeric"}).replace(/^\w/,c=>c.toUpperCase());
          const myP = players.filter(p => user.cat==="Todas" || p.cat===user.cat);
          const mesKey = new Date().toLocaleString("es",{month:"short"}).replace(/^\w/,c=>c.toUpperCase()).slice(0,3);

          // ── Encabezado ──
          pdf.setFillColor(21,101,192); pdf.rect(0,0,W,36,"F");
          pdf.setFillColor(183,28,28);  pdf.rect(0,0,5,36,"F");
          pdf.setTextColor(255,255,255);
          pdf.setFont("helvetica","bold"); pdf.setFontSize(22);
          pdf.text("RÓMULO F.C", pad, 16);
          pdf.setFontSize(9); pdf.setFont("helvetica","normal");
          pdf.text("Reporte Mensual — " + mesActual, pad, 24);
          pdf.text("Generado por: " + (user?.name||"Admin") + "  ·  " + new Date().toLocaleDateString("es"), pad, 30);

          let y = 46;

          // ── Resumen pagos ──
          const pagados  = myP.filter(p => pay[p.id]?.months?.[mesKey]?.paid).length;
          const pendient = myP.length - pagados;
          const totalBs  = myP.reduce((s,p) => s + (parseFloat(pay[p.id]?.months?.[mesKey]?.monto)||0), 0);
          const pct      = myP.length ? Math.round(pagados/myP.length*100) : 0;

          pdf.setFillColor(240,245,255); pdf.rect(pad,y,W-pad*2,28,"F");
          pdf.setTextColor(21,101,192); pdf.setFont("helvetica","bold"); pdf.setFontSize(11);
          pdf.text("RESUMEN DE PAGOS — " + mesKey, pad+4, y+8);
          pdf.setTextColor(40,40,40); pdf.setFont("helvetica","normal"); pdf.setFontSize(9);
          pdf.text(`Jugadores totales: ${myP.length}   |   Pagados: ${pagados}   |   Pendientes: ${pendient}   |   Recaudado: Bs. ${totalBs.toFixed(2)}   |   ${pct}%`, pad+4, y+17);
          y += 34;

          // ── Tabla jugadores ──
          pdf.setFont("helvetica","bold"); pdf.setFontSize(8);
          pdf.setFillColor(21,101,192); pdf.rect(pad,y,W-pad*2,7,"F");
          pdf.setTextColor(255,255,255);
          const cols = [pad+2, pad+52, pad+82, pad+112, pad+148, pad+168];
          ["Jugador","Categoría","Camiseta","Pago "+mesKey,"Amarillas","Partidos"].forEach((h,i) => pdf.text(h, cols[i], y+5));
          y += 8;

          pdf.setFont("helvetica","normal"); pdf.setFontSize(7.5);
          myP.forEach((p,i) => {
            if (y > 265) { pdf.addPage(); y = 20; }
            const bg = i%2===0 ? [248,250,255] : [255,255,255];
            pdf.setFillColor(...bg); pdf.rect(pad,y,W-pad*2,6,"F");
            pdf.setTextColor(40,40,40);
            const nombre = (p.nombre+" "+p.apellido).slice(0,22);
            const pagado = pay[p.id]?.months?.[mesKey]?.paid ? "✓ Pagado" : "✗ Pendiente";
            const amarillas = sanc[p.id]?.yellows || 0;
            const partidos  = p.stats?.partidos || 0;
            pdf.text(nombre, cols[0], y+4.5);
            pdf.text(p.cat, cols[1], y+4.5);
            pdf.text(String(p.num||"—"), cols[2], y+4.5);
            pdf.setTextColor(pagado.includes("✓") ? 21 : 183, pagado.includes("✓") ? 101 : 28, pagado.includes("✓") ? 192 : 28);
            pdf.text(pagado, cols[3], y+4.5);
            pdf.setTextColor(40,40,40);
            pdf.text(String(amarillas), cols[4], y+4.5);
            pdf.text(String(partidos), cols[5], y+4.5);
            y += 6;
          });

          // ── Partidos del mes ──
          y += 6;
          if (y > 250) { pdf.addPage(); y = 20; }
          const partMes = matches.filter(m => m.status==="finalizado" && (user.cat==="Todas"||m.cat===user.cat));
          pdf.setFont("helvetica","bold"); pdf.setFontSize(10);
          pdf.setTextColor(21,101,192);
          pdf.text("PARTIDOS JUGADOS (" + partMes.length + ")", pad, y); y += 6;
          pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(40,40,40);
          partMes.slice(0,10).forEach(m => {
            if (y > 270) return;
            const res = m.scoreH > m.scoreA ? "V" : m.scoreH < m.scoreA ? "D" : "E";
            pdf.text(`${m.date}  ${m.home} ${m.scoreH}–${m.scoreA} ${m.away}  [${m.cat}]  [${res}]`, pad+2, y); y += 5.5;
          });

          pdf.save("reporte_mensual_romulo_fc_" + mesActual.replace(/\s/g,"_") + ".pdf");
        };
        document.head.appendChild(script);
      }

      return (
        <>
          <div className="st">⚙️ Configuración</div>

          {/* ── REPORTE MENSUAL ── */}
          <div className="card" style={{ marginBottom:8 }}>
            <div className="ch"><span className="ct">📊 Reporte Mensual</span></div>
            <p style={{ fontSize:9, color:"#4e6a88", marginBottom:10, lineHeight:1.6 }}>
              Genera un PDF con el resumen del mes: pagos, asistencia, partidos jugados y estadísticas por jugador.
            </p>
            <button className="btn" onClick={generateMonthlyReport}>
              📄 Generar Reporte del Mes
            </button>
          </div>

          {/* ── REGISTRAR PARTIDOS ANTERIORES (desde Config) ── */}
          {can("calendario") && (
            <div className="card" style={{ marginBottom:8, border:"1px solid rgba(229,57,53,.12)" }}>
              <div className="ch"><span className="ct">📋 Partidos Anteriores</span></div>
              <p style={{ fontSize:9, color:"#4e6a88", marginBottom:10, lineHeight:1.6 }}>
                Registra partidos jugados antes de usar la app para tener el historial completo en la base de datos.
              </p>
              <button className="btn" style={{ background:"rgba(229,57,53,.08)", border:"1px solid rgba(229,57,53,.2)", color:"#e8a0a0" }}
                onClick={() => { setHistorialModal(true); setHpStep(1); setHpStats({}); }}>
                📋 Registrar Partido Anterior
              </button>
            </div>
          )}

          {/* ── TEMPORADAS ── */}
          {can("config") && (() => {
            const tempActual = clubConfig?.temporada || new Date().getFullYear();
            const champActivo = champs.some(ch => ch.activo);
            return (
              <div className="card" style={{ marginBottom:8, border:"1px solid rgba(33,150,243,.1)" }}>
                <div className="ch">
                  <span className="ct">📅 Temporada</span>
                  <span className="bg bg-b">{tempActual}</span>
                </div>
                <div style={{ fontSize:9, color:"#4e6a88", marginBottom:8, lineHeight:1.6 }}>
                  La temporada cambia automáticamente el 1 de enero. Al iniciar una nueva temporada se
                  reinician pagos, estadísticas y sanciones. <strong style={{ color:"#d4b84a" }}>
                  Si hay un campeonato activo, los datos no se reinician hasta que finalice.</strong>
                </div>
                {champActivo ? (
                  <div style={{ background:"rgba(212,184,74,.07)", border:"1px solid rgba(212,184,74,.2)",
                    borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
                    <div style={{ fontSize:9, color:"#d4b84a" }}>
                      ⚠️ Hay un campeonato activo — los datos se conservarán hasta que finalice
                    </div>
                  </div>
                ) : (
                  <div style={{ background:"rgba(21,101,192,.06)", borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
                    <div style={{ fontSize:9, color:"#7ab3e0" }}>
                      ✅ Sin campeonatos activos — el reinicio de temporada procederá normalmente
                    </div>
                  </div>
                )}
                <button className="btn" style={{ background:"rgba(33,150,243,.08)",
                  border:"1px solid rgba(33,150,243,.15)", color:"#7ab3e0" }}
                  onClick={() => setConf({
                    title:"NUEVA TEMPORADA",
                    msg: champActivo
                      ? "Hay un campeonato activo. ¿Cerrar temporada " + tempActual + " y archivar sin reiniciar datos hasta finalizar el campeonato?"
                      : "¿Cerrar temporada " + tempActual + " e iniciar " + (parseInt(tempActual)+1) + "? Se reiniciarán pagos, estadísticas y sanciones.",
                    danger: true, okTxt: "Iniciar Nueva Temporada",
                    ok: () => {
                      if (!champActivo) {
                        // Reiniciar pagos, stats, sanciones de todos los jugadores
                        players.forEach(p => {
                          safeSetDoc(doc(db,"pay",String(p.id)), { id:p.id, months:{}, history:[], arbitraje:[] });
                          safeSetDoc(doc(db,"sanc",String(p.id)), { id:p.id, yellows:0, reds:0, suspended:false });
                          const upd = { ...p, stats:{ goles:0, asistencias:0, partidos:0 } };
                          safeSetDoc(doc(db,"players",String(p.id)), upd);
                        });
                      }
                      const nuevaTemp = parseInt(tempActual)+1;
                      safeSetDoc(doc(db,"config","club"), { ...clubConfig, temporada: nuevaTemp,
                        champBlockReinicio: champActivo });
                    }
                  })}>
                  🔄 Iniciar Temporada {parseInt(tempActual)+1}
                </button>
              </div>
            );
          })()}

          {/* ── PERFIL DEL ENTRENADOR ── */}
          <div className="card" style={{ marginBottom:8 }}>
            <div className="ch"><span className="ct">Mi Perfil</span></div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
              <div className="av" style={{ width:48, height:48, fontSize:20, background: user.id===1 ? "#C62828" : "#1565C0", flexShrink:0 }}>
                {user.name[0]}
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:600 }}>{user.name}</div>
                <div style={{ fontSize:9, color:"#4e6a88", marginTop:2 }}>{user.role} · Categoría: {user.cat}</div>
                <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                  {user.perms.map(p => <span key={p} className="perm">{p}</span>)}
                </div>
              </div>
            </div>

            {/* Cambiar PIN */}
            <div style={{ borderTop:"1px solid rgba(255,255,255,.04)", paddingTop:10 }}>
              <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600, textTransform:"uppercase", letterSpacing:.5, marginBottom:7 }}>Cambiar PIN</div>
              <div className="inp-2" style={{ marginBottom:6 }}>
                <div className="inp-wrap">
                  <div className="inp-lbl">Nuevo PIN</div>
                  <input className="inp" type="password" maxLength={4} placeholder="4 dígitos"
                    value={newPin} onChange={e => { setNewPin(e.target.value); setPinOk(""); }} />
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Confirmar PIN</div>
                  <input className="inp" type="password" maxLength={4} placeholder="Repetir"
                    value={newPin2} onChange={e => { setNewPin2(e.target.value); setPinOk(""); }} />
                </div>
              </div>
              {pinOk && <div className={pinOk === "ok" ? "ok" : "err"}>{pinOk === "ok" ? "✅ PIN actualizado" : "⚠️ " + pinOk}</div>}
              <button className="btn" style={{ marginTop:6, padding:8, fontSize:11 }} onClick={() => {
                if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) { setPinOk("El PIN debe ser 4 dígitos numéricos"); return; }
                if (newPin !== newPin2) { setPinOk("Los PINs no coinciden"); return; }
                setPinOk("ok"); setNewPin(""); setNewPin2("");
              }}>ACTUALIZAR PIN</button>
            </div>
          </div>

          {/* ── DATOS DEL CLUB (solo Director Técnico) ── */}
          {can("entrenadores") && (
            <div className="card" style={{ marginBottom:8 }}>
              <div className="ch">
                <span className="ct">Club</span>
                {!editConfig
                  ? <button className="btn-sm" onClick={() => { setCfgDraft({ ...clubConfig }); setEditConfig(true); }}>✏️ Editar</button>
                  : <div style={{ display:"flex", gap:5 }}>
                      <button className="btn-sm" style={{ color:"#7ab3e0" }} onClick={() => { safeSetDoc(doc(db,"config","club"), cfgDraft); setEditConfig(false); }}>✅ Guardar</button>
                      <button className="btn-sm" onClick={() => setEditConfig(false)}>✕</button>
                    </div>
                }
              </div>
              {!editConfig ? (
                <div>
                  {[
                    ["Nombre",     clubConfig.nombre],
                    ["Temporada",  clubConfig.temporada],
                    ["Ciudad",     clubConfig.ciudad],
                    ["Teléfono",   clubConfig.tel],
                    ["Colores",    clubConfig.colores],
                    ["Máx. jugadores/cat.", clubConfig.maxJugadoresCat],
                    ["Directora",  clubConfig.directora],
                    ["C.I. Directora", clubConfig.directoraCedula],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,.02)", fontSize:10 }}>
                      <span style={{ color:"#4e6a88" }}>{k}</span>
                      <span style={{ fontWeight:500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {[
                    ["nombre","Nombre del club","text"],
                    ["temporada","Temporada","text"],
                    ["ciudad","Ciudad","text"],
                    ["tel","Teléfono","text"],
                    ["colores","Colores","text"],
                    ["maxJugadoresCat","Máx. jugadores por cat.","number"],
                    ["directora","Directora de la Academia","text"],
                    ["directoraCedula","C.I. Directora","text"],
                  ].map(([k,l,t]) => (
                    <div key={k} className="inp-wrap">
                      <div className="inp-lbl">{l}</div>
                      <input className="inp" type={t} value={cfgDraft[k]}
                        onChange={e => setCfgDraft(d => ({ ...d, [k]: t==="number" ? parseInt(e.target.value)||0 : e.target.value }))} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── MESES ACTIVOS (solo Director) ── */}
          {can("entrenadores") && (
            <div className="card" style={{ marginBottom:8 }}>
              <div className="ch"><span className="ct">Meses de Temporada</span><span className="bg bg-b">{clubConfig.mesesActivos.length}/12</span></div>
              <p style={{ fontSize:8, color:"#4e6a88", marginBottom:8, lineHeight:1.5 }}>Toca para activar o desactivar los meses que se cobran esta temporada.</p>
              <div className="mgrid">
                {ACTIVE_MONTHS.map(m => {
                  const on = clubConfig.mesesActivos.includes(m);
                  return (
                    <div key={m} className={"mcell " + (on ? "mp" : "")} style={{ cursor:"pointer" }}
                      onClick={() => setClubConfig(c => ({
                        ...c,
                        mesesActivos: on ? c.mesesActivos.filter(x=>x!==m) : [...c.mesesActivos, m]
                      }))}>
                      <div className="mclbl">{m}</div>
                      <div className="mcico">{on ? "✅" : "–"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── CATEGORÍAS ── */}
          <div className="card" style={{ marginBottom:8 }}>
            <div className="ch"><span className="ct">Categorías Activas</span><span className="bg bg-b">{CATS.length}</span></div>
            {CATS.map(c => {
              const cnt = players.filter(p=>p.cat===c).length;
              const pct = clubConfig.maxJugadoresCat ? Math.round(cnt / clubConfig.maxJugadoresCat * 100) : 0;
              return (
                <div key={c} style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:3 }}>
                    <span style={{ fontWeight:600 }}>{c}</span>
                    <span style={{ color:"#4e6a88" }}>{cnt} / {clubConfig.maxJugadoresCat} jugadores</span>
                  </div>
                  <div className="pb">
                    <div className={"pf " + (pct>=90?"pf-r":"pf-b")} style={{ width: Math.min(pct,100) + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── CERRAR SESIÓN ── */}
          <div className="card card-r">
            <div className="ch"><span className="ct">Sesión Activa</span></div>
            <p style={{ fontSize:9, color:"#4e6a88", marginBottom:10, lineHeight:1.5 }}>
              Conectado como <strong style={{ color:"var(--txt)" }}>{user.name}</strong> · {user.role}
            </p>
            <button className="btn btn-red" onClick={logout}>🚪 CERRAR SESIÓN</button>
          </div>
        </>
      );
    }

    return null;
  }

  // ── ADMIN RENDER ───────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <div className="logo"><span className="lb">RÓMULO</span> <span className="lr">F.C</span></div>
              <div className="hdr-sub">{user?.role} · {user?.cat}</div>
            </div>
            <div className="hdr-right">
              <span className="badge badge-b">ADMIN</span>
              <div className="ico-btn" style={{ position:"relative" }} onClick={() => setShowNotif(v => !v)}>
                🔔{unread > 0 && <span className="rdot" />}
              </div>
              <div className="ico-btn" onClick={()=>setDarkMode(d=>!d)} style={{fontSize:14}}>{darkMode?"☀️":"🌙"}</div>
              <div className="ico-btn" onClick={logout}>🚪</div>
            </div>
          </div>
          <div className="nav">
            {ADMIN_TABS.map(([k,ic,lb]) => (
              <button key={k} className={"nb" + (tab===k ? " ab" : "")} onClick={() => { setTab(k); setShowNotif(false); }}>
                {ic} {lb}
              </button>
            ))}
          </div>
        </div>

        {showNotif && (
          <div className="card" style={{ margin:"8px 14px 0", zIndex:90, position:"relative" }}>
            <div className="ch">
              <span className="ct">🔔 Notificaciones</span>
              <button className="btn-sm" onClick={() => notifs.filter(n=>!n.read).forEach(n => updateDoc(doc(db,"notifs",n.id),{read:true}))}>Marcar leídas</button>
            </div>
            {notifs.length === 0 && <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center" }}>Sin notificaciones</p>}
            {notifs.map(n => (
              <div key={n.id} className="notif-row" onClick={() => {
                updateDoc(doc(db, "notifs", n.id), { read: true });
                if (n.link) { setTab(n.link); setShowNotif(false); }
              }}>
                <span style={{ width:6, height:6, borderRadius:"50%", flexShrink:0, marginTop:5, display:"block",
                  background: n.read ? "#4e6a88" : n.live ? "#E53935" : "#2196F3" }} />
                <div style={{ opacity: n.read ? 0.55 : 1, flex:1 }}>
                  {n.live && !n.read && (
                    <span style={{ fontSize:7, background:"rgba(229,57,53,.18)", color:"#ef9a9a",
                      borderRadius:3, padding:"1px 5px", marginBottom:2, display:"inline-block",
                      border:"1px solid rgba(229,57,53,.3)", letterSpacing:.5 }}>🔴 EN VIVO</span>
                  )}
                  <div style={{ fontSize:10.5 }}>{n.txt}</div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>{timeAgo(n.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Banner sin conexión ── */}
        {!isOnline && (
          <div style={{ background:"rgba(212,184,74,.12)", borderBottom:"1px solid rgba(212,184,74,.3)",
            padding:"6px 14px", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14 }}>📴</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, fontWeight:600, color:"#d4b84a" }}>Sin conexión — Modo offline</div>
              <div style={{ fontSize:7.5, color:"#8a7040" }}>Los cambios se sincronizarán automáticamente al recuperar la señal.</div>
            </div>
          </div>
        )}

        {/* ── Banner Live Match minimizado ── */}
        {liveM && liveMMinimized && (() => {
          // Calcular marcador y tiempo actual
          const liveScore = liveM;
          return (
            <div style={{ background:"rgba(229,57,53,.12)", borderBottom:"1px solid rgba(229,57,53,.35)",
              padding:"8px 14px", display:"flex", alignItems:"center", gap:10, zIndex:999,
              cursor:"pointer" }}
              onClick={() => setLiveMMinimized(false)}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:"#E53935",
                animation:"livePulse 1s ease-in-out infinite", flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9.5, fontWeight:700, color:"#e8a0a0" }}>
                  🔴 EN VIVO — {liveM.home} vs {liveM.away}
                </div>
                <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>
                  {liveM.cat} · Toca para volver al partido
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setLiveMMinimized(false); }}
                style={{ background:"#E53935", border:"none", borderRadius:8, color:"#fff",
                  fontSize:9, fontWeight:600, padding:"6px 12px", cursor:"pointer", flexShrink:0 }}>
                ▶ Volver
              </button>
            </div>
          );
        })()}
        <style>{`@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>

        {/* ── Banner de actualización disponible ── */}
        {swUpdate && (
          <div style={{ background:"rgba(21,101,192,.18)", borderBottom:"1px solid rgba(33,150,243,.35)",
            padding:"8px 14px", display:"flex", alignItems:"center", gap:10, zIndex:999 }}>
            <span style={{ fontSize:16 }}>🔄</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9.5, fontWeight:600, color:"#7ab3e0" }}>Nueva versión disponible</div>
              <div style={{ fontSize:7.5, color:"#4e6a88" }}>Hay una actualización de Rómulo F.C lista para instalar.</div>
            </div>
            <button
              onClick={() => {
                setSwUpdate(false);
                window.location.reload();
              }}
              style={{ background:"#1565C0", border:"none", borderRadius:8, color:"#fff",
                fontSize:9, fontWeight:600, padding:"6px 12px", cursor:"pointer", flexShrink:0 }}>
              Actualizar ↑
            </button>
            <button onClick={() => setSwUpdate(false)}
              style={{ background:"none", border:"none", color:"#4e6a88", fontSize:16,
                cursor:"pointer", padding:"0 4px", flexShrink:0 }}>
              ✕
            </button>
          </div>
        )}

        {/* ── Banner Live Match minimizado ── */}
        {liveM && liveMMinimized && (() => {
          const liveSecs = secs; // viene del estado del LiveMatch via closure
          const liveMin  = Math.floor(liveSecs / 60);
          const liveSec2 = liveSecs % 60;
          const pad = n => String(n).padStart(2,"0");
          return (
            <div style={{ background:"rgba(183,28,28,.18)", borderBottom:"2px solid #E53935",
              padding:"8px 14px", display:"flex", alignItems:"center", gap:10, zIndex:100 }}>
              {/* Indicador en vivo parpadeante */}
              <div style={{ width:8, height:8, borderRadius:"50%", background:"#E53935",
                flexShrink:0, animation:"liveBlink 1s ease-in-out infinite" }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9.5, fontWeight:700, color:"#e8a0a0", whiteSpace:"nowrap",
                  overflow:"hidden", textOverflow:"ellipsis" }}>
                  🔴 EN VIVO · {liveM.home} vs {liveM.away}
                </div>
                <div style={{ fontSize:8, color:"#b05060", marginTop:1 }}>
                  {running ? "⏱ " : "⏸ "}{pad(liveMin)}:{pad(liveSec2)} · {liveM.cat}
                  {scoreUs !== undefined ? " · " + scoreUs + "–" + scoreThem : ""}
                </div>
              </div>
              <button
                onClick={() => setLiveMMinimized(false)}
                style={{ background:"#B71C1C", border:"none", borderRadius:8, color:"#fff",
                  fontSize:9, fontWeight:700, padding:"6px 12px", cursor:"pointer",
                  flexShrink:0, letterSpacing:.5 }}>
                ▶ Volver
              </button>
            </div>
          );
        })()}

        <div className="cnt">
          {renderAdminContent()}
        </div>

        <div className="bnav">
          {ADMIN_TABS.map(([k,ic,lb]) => (
            <div key={k} className={"bn" + (tab===k ? " ba" : "")} onClick={() => { setTab(k); setShowNotif(false); }}>
              <span className="bi">{ic}</span>{lb}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog cfg={conf} onClose={() => setConf(null)} />

      {/* ── MODAL PARTIDO HISTÓRICO ── */}
      {historialModal && (() => {
        // Todos los jugadores disponibles — primero los de la categoría del partido, luego el resto
        const catPlayers = [...players].sort((a,b) => {
          const aP = a.cat === hp.cat ? 0 : 1;
          const bP = b.cat === hp.cat ? 0 : 1;
          return aP - bP;
        });

        function saveHistorial() {
          const id = String(Date.now());
          // Construir playerStats y events desde hpStats
          const playerStats = {};
          const events = [];
          Object.entries(hpStats).forEach(([pid, s]) => {
            if ((s.goles||0)>0 || (s.asistencias||0)>0 || (s.amarilla||false) || (s.roja||false)) {
              playerStats[pid] = { goles: s.goles||0, asistencias: s.asistencias||0 };
              const pl = players.find(x=>String(x.id)===String(pid));
              const nombre = pl ? pl.nombre+" "+pl.apellido : "Jugador";
              for(let i=0;i<(s.goles||0);i++) events.push({ type:"goal_us", txt:nombre+" anota", ico:"⚽" });
              if (s.amarilla) events.push({ type:"y_us", txt:nombre+" tarjeta amarilla", ico:"🟨" });
              if (s.roja)     events.push({ type:"r_us", txt:nombre+" tarjeta roja",     ico:"🟥" });
            }
          });

          const matchData = {
            id, home: hp.home||"Rómulo FC", away: hp.away, date: hp.date,
            time:"", cat: hp.cat, field: hp.field||"",
            scoreH: parseInt(hp.scoreH)||0, scoreA: parseInt(hp.scoreA)||0,
            status:"finalizado", fase: hp.fase||"Normal",
            champId: hp.champId||"", events, playerStats, historico: true
          };
          safeSetDoc(doc(db,"matches",id), matchData);

          // Actualizar stats acumuladas de los jugadores
          Object.entries(hpStats).forEach(([pid, s]) => {
            const pl = players.find(x=>String(x.id)===String(pid));
            if (!pl) return;
            if (!(s.goles||0) && !(s.asistencias||0) && !s.amarilla && !s.roja && !s.jugó) return;
            const esPrestamo = pl.cat !== hp.cat;
            const curSanc = sanc[pl.id] || { yellows:0, reds:0 };

            if (!esPrestamo) {
              // Jugó en su categoría propia → suma a stats principal
              const cur = pl.stats || { goles:0, asistencias:0, partidos:0 };
              safeSetDoc(doc(db,"players",String(pl.id)), { ...pl,
                stats: {
                  goles:       (cur.goles||0)       + (s.goles||0),
                  asistencias: (cur.asistencias||0) + (s.asistencias||0),
                  partidos:    (cur.partidos||0)    + (s.jugó ? 1 : 0),
                },
                statsPorCat: pl.statsPorCat || {}
              });
            } else {
              // Jugó en préstamo → suma SOLO a statsPorCat[hp.cat]
              const curPorCat = pl.statsPorCat || {};
              const curEsa = curPorCat[hp.cat] || { goles:0, asistencias:0, partidos:0 };
              safeSetDoc(doc(db,"players",String(pl.id)), { ...pl,
                stats: pl.stats || { goles:0, asistencias:0, partidos:0 },
                statsPorCat: {
                  ...curPorCat,
                  [hp.cat]: {
                    goles:       (curEsa.goles||0)       + (s.goles||0),
                    asistencias: (curEsa.asistencias||0) + (s.asistencias||0),
                    partidos:    (curEsa.partidos||0)    + (s.jugó ? 1 : 0),
                  }
                }
              });
            }

            if (s.amarilla || s.roja) {
              safeSetDoc(doc(db,"sanc",String(pl.id)), {
                ...curSanc,
                yellows: (curSanc.yellows||0) + (s.amarilla ? 1 : 0),
                reds:    (curSanc.reds||0)    + (s.roja    ? 1 : 0),
              });
            }
          });

          // Reset
          setHistorialModal(false);
          setHp({ home:"Rómulo FC", away:"", date:"", cat:"Sub-15", field:"", scoreH:"", scoreA:"", fase:"Normal", champId:"" });
          setHpStats({});
          setHpStep(1);
        }

        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setHistorialModal(false); }}>
            <div className="modal" style={{ borderTop:"3px solid #E53935", maxHeight:"92vh", overflowY:"auto" }}>
              <div className="mt2" style={{ color:"#e8a0a0" }}>
                📋 Registrar Partido Anterior
                <span className="mx" onClick={()=>setHistorialModal(false)}>✕</span>
              </div>

              {/* Indicador de paso */}
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {[["1","Datos del partido"],["2","Jugadores"]].map(([n,l])=>(
                  <div key={n} style={{ flex:1, padding:"5px 8px", borderRadius:6, textAlign:"center",
                    background: hpStep===parseInt(n)?"rgba(229,57,53,.15)":"rgba(255,255,255,.02)",
                    border:`1px solid ${hpStep===parseInt(n)?"rgba(229,57,53,.3)":"rgba(255,255,255,.04)"}` }}>
                    <div style={{ fontSize:7.5, color: hpStep===parseInt(n)?"#e8a0a0":"#3a5068" }}>{n}. {l}</div>
                  </div>
                ))}
              </div>

              {hpStep===1 && (
                <>
                  <div className="inp-2">
                    <div className="inp-wrap">
                      <div className="inp-lbl">Equipo local</div>
                      <input className="inp" value={hp.home} onChange={e=>setHp(h=>({...h,home:e.target.value}))} placeholder="Rómulo FC"/>
                    </div>
                    <div className="inp-wrap">
                      <div className="inp-lbl">Rival *</div>
                      <input className="inp" value={hp.away} onChange={e=>setHp(h=>({...h,away:e.target.value}))} placeholder="Nombre del rival"/>
                    </div>
                  </div>
                  <div className="inp-2">
                    <div className="inp-wrap">
                      <div className="inp-lbl">Fecha * (DD Mes YYYY)</div>
                      <input className="inp" value={hp.date} onChange={e=>setHp(h=>({...h,date:e.target.value}))} placeholder="15 Mar 2025"/>
                    </div>
                    <div className="inp-wrap">
                      <div className="inp-lbl">Campo</div>
                      <input className="inp" value={hp.field} onChange={e=>setHp(h=>({...h,field:e.target.value}))} placeholder="Campo A"/>
                    </div>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Categoría</div>
                    <select className="inp" value={hp.cat} onChange={e=>setHp(h=>({...h,cat:e.target.value}))}>
                      {CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="inp-2">
                    <div className="inp-wrap">
                      <div className="inp-lbl">Goles Rómulo FC *</div>
                      <input className="inp" type="number" min="0" value={hp.scoreH}
                        onChange={e=>setHp(h=>({...h,scoreH:e.target.value}))} placeholder="0"/>
                    </div>
                    <div className="inp-wrap">
                      <div className="inp-lbl">Goles rival *</div>
                      <input className="inp" type="number" min="0" value={hp.scoreA}
                        onChange={e=>setHp(h=>({...h,scoreA:e.target.value}))} placeholder="0"/>
                    </div>
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Campeonato (opcional)</div>
                    <select className="inp" value={hp.champId} onChange={e=>setHp(h=>({...h,champId:e.target.value}))}>
                      <option value="">— Amistoso —</option>
                      {champs.map(ch=><option key={ch.id} value={ch.id}>{ch.nombre}</option>)}
                    </select>
                  </div>
                  <button className="btn" disabled={!hp.away||hp.scoreH===""||hp.scoreA===""||!hp.date}
                    onClick={()=>setHpStep(2)} style={{ marginTop:4 }}>
                    SIGUIENTE → Jugadores
                  </button>
                </>
              )}

              {hpStep===2 && (
                <>
                  <div style={{ background:"rgba(229,57,53,.05)", border:"1px solid rgba(229,57,53,.15)",
                    borderRadius:8, padding:"7px 10px", marginBottom:10 }}>
                    <div style={{ fontSize:10, fontWeight:600 }}>{hp.home} {hp.scoreH} – {hp.scoreA} {hp.away}</div>
                    <div style={{ fontSize:8, color:"#4e6a88" }}>{hp.date} · {hp.cat}</div>
                  </div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginBottom:8 }}>
                    Marca los jugadores que participaron y sus estadísticas. Solo lo que recuerdes.
                  </div>

                  {catPlayers.map(p => {
                    const s = hpStats[p.id] || {};
                    const jugó = s.jugó || false;
                    return (
                      <div key={p.id} style={{ borderBottom:"1px solid rgba(255,255,255,.03)",
                        padding:"7px 0", opacity: jugó ? 1 : 0.5 }}>
                        {/* Fila nombre + toggle jugó */}
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: jugó ? 7 : 0 }}>
                          <Avatar p={p} size={26}/>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:9.5, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                            <div style={{ fontSize:7.5, color:"#4e6a88" }}>#{p.num} · {p.cat}</div>
                          </div>
                          <button className={"ck"+(jugó?" on":"")}
                            onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),jugó:!jugó}}))}>
                            {jugó?"✓ Jugó":""}
                          </button>
                        </div>
                        {jugó && (
                          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", paddingLeft:34 }}>
                            {/* Goles */}
                            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                              <span style={{ fontSize:8, color:"#4e6a88" }}>⚽</span>
                              <button className="btn-sm" style={{ width:22, height:22, padding:0, fontSize:12 }}
                                onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),goles:Math.max(0,((prev[p.id]?.goles)||0)-1)}}))}>−</button>
                              <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#7ab3e0", minWidth:16, textAlign:"center" }}>{s.goles||0}</span>
                              <button className="btn-sm" style={{ width:22, height:22, padding:0, fontSize:12 }}
                                onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),goles:((prev[p.id]?.goles)||0)+1}}))}>+</button>
                            </div>
                            {/* Asistencias */}
                            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                              <span style={{ fontSize:8, color:"#4e6a88" }}>🎯</span>
                              <button className="btn-sm" style={{ width:22, height:22, padding:0, fontSize:12 }}
                                onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),asistencias:Math.max(0,((prev[p.id]?.asistencias)||0)-1)}}))}>−</button>
                              <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#7ab3e0", minWidth:16, textAlign:"center" }}>{s.asistencias||0}</span>
                              <button className="btn-sm" style={{ width:22, height:22, padding:0, fontSize:12 }}
                                onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),asistencias:((prev[p.id]?.asistencias)||0)+1}}))}>+</button>
                            </div>
                            {/* Tarjetas */}
                            <button className={"btn-sm"+(s.amarilla?" ":"")}
                              style={{ padding:"3px 7px", fontSize:10,
                                background:s.amarilla?"rgba(212,184,74,.25)":"rgba(255,255,255,.03)",
                                borderColor:s.amarilla?"rgba(212,184,74,.5)":"rgba(255,255,255,.05)",
                                color:s.amarilla?"#d4b84a":"#4e6a88" }}
                              onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),amarilla:!s.amarilla}}))}>
                              🟨
                            </button>
                            <button className={"btn-sm"+(s.roja?" ":"")}
                              style={{ padding:"3px 7px", fontSize:10,
                                background:s.roja?"rgba(183,28,28,.25)":"rgba(255,255,255,.03)",
                                borderColor:s.roja?"rgba(183,28,28,.4)":"rgba(255,255,255,.05)",
                                color:s.roja?"#e8a0a0":"#4e6a88" }}
                              onClick={()=>setHpStats(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),roja:!s.roja}}))}>
                              🟥
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ display:"flex", gap:7, marginTop:12 }}>
                    <button className="btn-sm" style={{ flex:1 }} onClick={()=>setHpStep(1)}>← Atrás</button>
                    <button className="btn" style={{ flex:2 }} onClick={saveHistorial}>
                      💾 GUARDAR PARTIDO
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── MODAL EDICIÓN DE STATS ── */}
      {statsEditModal && (() => {
        const p = statsEditModal;
        function saveStats() {
          const updP = { ...p, stats: { goles: parseInt(statsEdit.goles)||0, asistencias: parseInt(statsEdit.asistencias)||0, partidos: parseInt(statsEdit.partidos)||0 } };
          safeSetDoc(doc(db,"players",String(p.id)), updP);
          const updS = { ...(sanc[p.id]||{}), yellows: parseInt(statsEdit.yellows)||0, reds: parseInt(statsEdit.reds)||0, suspended: sanc[p.id]?.suspended||false };
          safeSetDoc(doc(db,"sanc",String(p.id)), updS);
          // MVPs: actualizar campo mvpCount en el jugador (referencia)
          const updM = { ...updP, mvpCount: parseInt(statsEdit.mvps)||0 };
          safeSetDoc(doc(db,"players",String(p.id)), updM);
          setStatsEditModal(null);
        }
        const fields = [
          { key:"goles",       label:"⚽ Goles",            color:"#2196F3" },
          { key:"asistencias", label:"🎯 Asistencias",       color:"#7ab3e0" },
          { key:"partidos",    label:"🏟️ Partidos jugados",  color:"var(--txt)" },
          { key:"mvps",        label:"🏅 MVPs ganados",      color:"#d4b84a" },
          { key:"yellows",     label:"🟨 Tarjetas amarillas",color:"#d4b84a" },
          { key:"reds",        label:"🟥 Tarjetas rojas",    color:"#E53935" },
        ];
        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setStatsEditModal(null); }}>
            <div className="modal" style={{ borderTop:"3px solid #d4b84a" }}>
              <div className="mt2" style={{ color:"#d4b84a" }}>
                📊 Editar Estadísticas
                <span className="mx" onClick={()=>setStatsEditModal(null)}>✕</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12,
                background:"var(--card)", borderRadius:8, padding:"8px 10px" }}>
                <Avatar p={p} size={32}/>
                <div>
                  <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                  <div style={{ fontSize:8, color:"#4e6a88" }}>{p.cat} · #{p.num}</div>
                </div>
              </div>
              <div style={{ fontSize:8, color:"#4e6a88", marginBottom:10, lineHeight:1.6 }}>
                ⚠️ Editar manualmente sobreescribe las estadísticas acumuladas automáticamente.
              </div>
              {fields.map(({key,label,color}) => (
                <div key={key} className="inp-wrap" style={{ marginBottom:8 }}>
                  <div className="inp-lbl" style={{ color }}>{label}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <button className="btn-sm" style={{ width:32, height:32, padding:0, fontSize:16, flexShrink:0 }}
                      onClick={()=>setStatsEdit(s=>({...s,[key]:Math.max(0,(parseInt(s[key])||0)-1)}))}>−</button>
                    <input className="inp" type="number" min="0" style={{ textAlign:"center", fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color }}
                      value={statsEdit[key]} onChange={e=>setStatsEdit(s=>({...s,[key]:e.target.value}))}/>
                    <button className="btn-sm" style={{ width:32, height:32, padding:0, fontSize:16, flexShrink:0 }}
                      onClick={()=>setStatsEdit(s=>({...s,[key]:(parseInt(s[key])||0)+1}))}>+</button>
                  </div>
                </div>
              ))}
              <button className="btn" style={{ marginTop:8 }} onClick={saveStats}>💾 GUARDAR ESTADÍSTICAS</button>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL ENCUESTA POST-ENTRENAMIENTO ── */}
      {surveyTarget && (() => {
        const { pid, nombre, session } = surveyTarget;
        function saveSurvey() {
          const surveyDoc = {
            pid, nombre, session,
            sentido: svSentido,
            practico: svPractico,
            molestia: svMolestia,
            zona: svMolestia==="si" ? svZona : "",
            proximo: svProximo,
            fecha: new Date().toLocaleDateString("es"),
            ts: Date.now()
          };
          if (!isDemo) safeSetDoc(doc(db,"surveys",pid+"_"+session), surveyDoc);
          setSurveyTarget(null);
          setSvSentido(0); setSvPractico(""); setSvMolestia("no"); setSvZona(""); setSvProximo("si");
        }

        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setSurveyTarget(null); }}>
            <div className="modal" style={{ borderTop:"3px solid #1976D2" }}>
              <div className="mt2" style={{ color:"#7ab3e0" }}>
                📋 Encuesta Post-Entreno
                <span className="mx" onClick={() => setSurveyTarget(null)}>✕</span>
              </div>
              <div style={{ fontSize:9, color:"#4e6a88", marginBottom:12 }}>
                {nombre} · {session}
              </div>

              {/* ¿Cómo te sentiste? */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:9, color:"#7ab3e0", marginBottom:6, fontWeight:600 }}>
                  ⭐ ¿Cómo te sentiste hoy?
                </div>
                <div style={{ display:"flex", justifyContent:"center", gap:8 }}>
                  {[1,2,3,4,5].map(n => (
                    <div key={n} onClick={()=>setSvSentido(n)}
                      style={{ fontSize:24, cursor:"pointer", opacity: svSentido>=n?1:.25,
                        filter: svSentido>=n?"none":"grayscale(1)" }}>
                      ⭐
                    </div>
                  ))}
                </div>
              </div>

              {/* ¿Qué practicamos? */}
              <div className="inp-wrap" style={{ marginBottom:10 }}>
                <div className="inp-lbl">📝 ¿Qué practicamos hoy?</div>
                <input className="inp" placeholder="Ej: Definición, pases cortos..." value={svPractico}
                  onChange={e=>setSvPractico(e.target.value)}/>
              </div>

              {/* ¿Molestia física? */}
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, color:"#7ab3e0", marginBottom:6, fontWeight:600 }}>
                  🩹 ¿Tienes alguna molestia física?
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {["no","si"].map(v=>(
                    <button key={v} onClick={()=>setSvMolestia(v)}
                      className={svMolestia===v?"btn":"btn-sm"}
                      style={{ flex:1, fontSize:9, background: svMolestia===v?(v==="si"?"rgba(183,28,28,.15)":"rgba(21,101,192,.15)"):"rgba(255,255,255,.03)" }}>
                      {v==="si"?"😟 Sí, tengo molestia":"✅ No, todo bien"}
                    </button>
                  ))}
                </div>
                {svMolestia==="si" && (
                  <input className="inp" style={{ marginTop:6 }} placeholder="¿Qué zona? Ej: Rodilla derecha"
                    value={svZona} onChange={e=>setSvZona(e.target.value)}/>
                )}
              </div>

              {/* ¿Estarás en el próximo? */}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:9, color:"#7ab3e0", marginBottom:6, fontWeight:600 }}>
                  📅 ¿Estarás en el próximo entreno?
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {["si","no","talvez"].map(v=>(
                    <button key={v} onClick={()=>setSvProximo(v)}
                      className={svProximo===v?"btn":"btn-sm"}
                      style={{ flex:1, fontSize:9,
                        background: svProximo===v?"rgba(21,101,192,.2)":"rgba(255,255,255,.03)" }}>
                      {v==="si"?"✅ Sí":v==="no"?"❌ No":"🤔 Tal vez"}
                    </button>
                  ))}
                </div>
              </div>

              <button className="btn" onClick={saveSurvey}>💾 ENVIAR RESPUESTAS</button>
              <button className="btn-sm" style={{ width:"100%", marginTop:6, textAlign:"center" }}
                onClick={()=>setSurveyTarget(null)}>Saltar encuesta</button>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL COMPARATIVA ── */}
      {compareModal && (() => {
        const allP = players;
        const pA = allP.find(x => String(x.id) === String(cmpA));
        const pB = allP.find(x => String(x.id) === String(cmpB));

        function getMvpCount(p) {
          return p ? matches.filter(m => m.mvp?.playerId === p.id).length : 0;
        }
        function getAttPct(p) {
          if (!p) return 0;
          const aRec = att[p.id];
          if (!aRec) return 0;
          const total = Object.keys(aRec).filter(k=>k!=="id"&&k!=="playerId").length;
          const pres  = Object.values(aRec).filter(v=>v===true).length;
          return total > 0 ? Math.round(pres/total*100) : 0;
        }
        function getStat(p, key) {
          return p?.stats?.[key] || 0;
        }

        const stats = pA && pB ? [
          { label:"⚽ Goles",           vA: getStat(pA,"goles"),       vB: getStat(pB,"goles") },
          { label:"🎯 Asistencias",     vA: getStat(pA,"asistencias"), vB: getStat(pB,"asistencias") },
          { label:"🏅 MVPs",            vA: getMvpCount(pA),           vB: getMvpCount(pB) },
          { label:"✅ Asistencia %",    vA: getAttPct(pA),             vB: getAttPct(pB) },
        ] : [];

        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setCompareModal(false); }}>
            <div className="modal" style={{ borderTop:"3px solid #d4b84a" }}>
              <div className="mt2" style={{ color:"#d4b84a" }}>
                ⚖️ Comparar Jugadores
                <span className="mx" onClick={() => setCompareModal(false)}>✕</span>
              </div>
              <div className="inp-2" style={{ marginBottom:10 }}>
                <div className="inp-wrap">
                  <div className="inp-lbl">Jugador A</div>
                  <select className="inp" value={cmpA} onChange={e=>setCmpA(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {allP.map(p=><option key={p.id} value={String(p.id)}>#{p.num} {p.nombre} {p.apellido} ({p.cat})</option>)}
                  </select>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Jugador B</div>
                  <select className="inp" value={cmpB} onChange={e=>setCmpB(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {allP.map(p=><option key={p.id} value={String(p.id)}>#{p.num} {p.nombre} {p.apellido} ({p.cat})</option>)}
                  </select>
                </div>
              </div>

              {pA && pB && (
                <>
                  {/* Encabezados */}
                  <div style={{ display:"flex", marginBottom:8 }}>
                    <div style={{ flex:1, textAlign:"center" }}>
                      <Avatar p={pA} size={36} />
                      <div style={{ fontSize:9, fontWeight:600, marginTop:3 }}>{pA.nombre} {pA.apellido}</div>
                      <div style={{ fontSize:7.5, color:"#4e6a88" }}>{pA.cat} · #{pA.num}</div>
                    </div>
                    <div style={{ width:20 }}/>
                    <div style={{ flex:1, textAlign:"center" }}>
                      <Avatar p={pB} size={36} />
                      <div style={{ fontSize:9, fontWeight:600, marginTop:3 }}>{pB.nombre} {pB.apellido}</div>
                      <div style={{ fontSize:7.5, color:"#4e6a88" }}>{pB.cat} · #{pB.num}</div>
                    </div>
                  </div>
                  {/* Barras comparativas */}
                  {stats.map(({label, vA, vB}) => {
                    const maxV = Math.max(vA, vB, 1);
                    const pctA = Math.round(vA/maxV*100);
                    const pctB = Math.round(vB/maxV*100);
                    const winA = vA > vB, winB = vB > vA;
                    return (
                      <div key={label} style={{ marginBottom:10 }}>
                        <div style={{ textAlign:"center", fontSize:8, color:"#7ab3e0", marginBottom:4,
                          textTransform:"uppercase", letterSpacing:.5 }}>{label}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          {/* Barra A invertida */}
                          <div style={{ flex:1, display:"flex", justifyContent:"flex-end", alignItems:"center", gap:4 }}>
                            <span style={{ fontSize:11, fontWeight:600,
                              color: winA?"#d4b84a":"#4e6a88" }}>{vA}</span>
                            <div style={{ height:8, width: pctA+"%", maxWidth:"100%", borderRadius:4,
                              background: winA ? "#d4b84a" : "rgba(33,150,243,.3)" }}/>
                          </div>
                          <div style={{ width:2, height:16, background:"rgba(255,255,255,.05)" }}/>
                          {/* Barra B */}
                          <div style={{ flex:1, display:"flex", alignItems:"center", gap:4 }}>
                            <div style={{ height:8, width: pctB+"%", maxWidth:"100%", borderRadius:4,
                              background: winB ? "#d4b84a" : "rgba(33,150,243,.3)" }}/>
                            <span style={{ fontSize:11, fontWeight:600,
                              color: winB?"#d4b84a":"#4e6a88" }}>{vB}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Veredicto */}
                  {(() => {
                    const wins = { A:0, B:0 };
                    stats.forEach(({vA,vB}) => { if(vA>vB) wins.A++; else if(vB>vA) wins.B++; });
                    const winner = wins.A > wins.B ? pA : wins.B > wins.A ? pB : null;
                    return (
                      <div style={{ textAlign:"center", marginTop:8, padding:"8px",
                        background: "rgba(212,184,74,.06)", borderRadius:8, border:"1px solid rgba(212,184,74,.15)" }}>
                        {winner
                          ? <><span style={{ fontSize:14 }}>🏆</span>
                              <div style={{ fontSize:10, color:"#d4b84a", fontWeight:600 }}>
                                {winner.nombre} {winner.apellido} gana en {Math.max(wins.A,wins.B)}/{stats.length} categorías
                              </div></>
                          : <div style={{ fontSize:9, color:"#7ab3e0" }}>⚖️ Estadísticas parejas</div>}
                      </div>
                    );
                  })()}
                </>
              )}
              {(!pA || !pB) && (
                <div style={{ textAlign:"center", padding:"20px 0", fontSize:9, color:"#4e6a88" }}>
                  Selecciona dos jugadores para comparar
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── MODAL GALERÍA DE FOTOS ── */}
      {galeriaModal && (() => {
        const match = matches.find(m=>m.id===galeriaModal);
        if (!match) return null;
        const fotos = match.fotos || [];
        const MAX_FOTOS = 3;
        const puedeSubir = isAdmin;

        function subirFoto(e) {
          const f = e.target.files && e.target.files[0];
          if (!f || fotos.length >= MAX_FOTOS) return;
          const rdr = new FileReader();
          rdr.onload = ev => {
            const nuevas = [...fotos, { url: ev.target.result, subidaPor: user?.name, fecha: new Date().toLocaleDateString("es") }];
            safeSetDoc(doc(db,"matches",String(match.id)), { ...match, fotos: nuevas });
          };
          rdr.readAsDataURL(f);
        }

        function eliminarFoto(idx) {
          const nuevas = fotos.filter((_,i)=>i!==idx);
          safeSetDoc(doc(db,"matches",String(match.id)), { ...match, fotos: nuevas });
        }

        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setGaleriaModal(null); }}>
            <div className="modal" style={{ borderTop:"3px solid #1565C0" }}>
              <div className="mt2" style={{ color:"#7ab3e0" }}>
                📸 Fotos del Partido
                <span className="mx" onClick={()=>setGaleriaModal(null)}>✕</span>
              </div>
              <div style={{ fontSize:8.5, color:"#4e6a88", marginBottom:10 }}>
                {match.home} vs {match.away} · {match.date}
              </div>

              {/* Grid de fotos */}
              {fotos.length > 0 ? (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
                  {fotos.map((f,i) => (
                    <div key={i} style={{ position:"relative", borderRadius:8, overflow:"hidden",
                      border:"1px solid rgba(33,150,243,.15)" }}>
                      <img src={f.url} alt="" style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                      <div style={{ position:"absolute", bottom:0, left:0, right:0,
                        background:"rgba(4,6,12,.7)", padding:"3px 4px", fontSize:7, color:"#7ab3e0" }}>
                        {f.subidaPor}
                      </div>
                      {puedeSubir && (
                        <button onClick={()=>eliminarFoto(i)}
                          style={{ position:"absolute", top:3, right:3, background:"rgba(183,28,28,.8)",
                            border:"none", borderRadius:4, color:"#fff", fontSize:10, cursor:"pointer",
                            width:18, height:18, display:"flex", alignItems:"center", justifyContent:"center" }}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {/* Slot vacío para subir */}
                  {puedeSubir && fotos.length < MAX_FOTOS && (
                    <label style={{ aspectRatio:"1", border:"1px dashed rgba(33,150,243,.25)", borderRadius:8,
                      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                      cursor:"pointer", color:"#4e6a88", fontSize:8, gap:3 }}>
                      <span style={{ fontSize:20 }}>📷</span>
                      <span>Agregar</span>
                      <input type="file" accept="image/*" capture="environment"
                        style={{ display:"none" }} onChange={subirFoto}/>
                    </label>
                  )}
                </div>
              ) : (
                <div style={{ textAlign:"center", padding:"20px 0" }}>
                  {puedeSubir ? (
                    <label style={{ cursor:"pointer" }}>
                      <div style={{ fontSize:36 }}>📷</div>
                      <div style={{ fontSize:9, color:"#4e6a88", marginTop:6 }}>
                        Toca para agregar la primera foto
                      </div>
                      <div style={{ fontSize:8, color:"#3a5068", marginTop:3 }}>
                        Máximo {MAX_FOTOS} fotos por partido
                      </div>
                      <input type="file" accept="image/*" capture="environment"
                        style={{ display:"none" }} onChange={subirFoto}/>
                    </label>
                  ) : (
                    <div style={{ fontSize:9, color:"#3a5068" }}>Sin fotos aún</div>
                  )}
                </div>
              )}

              {/* Indicador cantidad */}
              {fotos.length > 0 && (
                <div style={{ textAlign:"center", fontSize:8, color:"#3a5068", marginBottom:10 }}>
                  {fotos.length}/{MAX_FOTOS} fotos
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── MODAL MVP ── */}
      {mvpModal && (() => {
        const match   = matches.find(m => m.id === mvpModal);
        if (!match) return null;

        // Convocados del partido (guardados en att_matches)
        const attM    = attMatches.find(a => a.matchId === mvpModal);
        const convIds = attM?.convocados || [];
        const convPls = convIds.map(id => players.find(p => p.id === id)).filter(Boolean);

        // Votos actuales
        const votosActuales = match.mvpVotos || {};
        const misVoto       = votosActuales[user?.id] || null;

        // Lógica de cierre: pasó el día del partido?
        const hoy       = new Date().toLocaleDateString("es");
        const pasoDia   = match.date !== hoy;
        const votosEmit = Object.keys(votosActuales).length;

        // ¿Puede votar este entrenador?
        const puedeVotar = !misVoto;

        // Calcular MVP ganador
        const conteo = {};
        Object.values(votosActuales).forEach(pid => { conteo[pid] = (conteo[pid]||0)+1; });
        const mvpId  = Object.entries(conteo).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
        const mvpP   = mvpId ? players.find(x=>x.id===mvpId) : null;

        // ¿Votación cerrada? (todos votaron O pasó el día)
        const totalCoaches   = coaches.length;
        const todosVotaron   = votosEmit >= totalCoaches;
        const votacionCerrada = todosVotaron || (pasoDia && votosEmit > 0);

        // ¿Ya fue enviado el PDF?
        const pdfEnviado = !!match.mvpPdfEnviado;

        // ¿Puede generar PDF este entrenador?
        const puedeGenerar = votacionCerrada && !!misVoto && !pdfEnviado;

        function castVoto(playerId) {
          if (!puedeVotar) return;
          const updated = { ...match, mvpVotos: { ...votosActuales, [user.id]: playerId } };
          safeSetDoc(doc(db,"matches",String(match.id)), updated);
        }

        function generateAndSendMvpPdf(mvpPlayer, onReady) {
          loadPdfLibs().then(() => {
            const { jsPDF } = window.jspdf;

            // Stats del jugador
            const ps      = match.playerStats?.[mvpPlayer.id] || {};
            const hazanas = [];
            if (ps.goles>0)       hazanas.push("⚽ "+ps.goles+" gol"+(ps.goles>1?"es":"")+" anotado"+(ps.goles>1?"s":""));
            if (ps.asistencias>0) hazanas.push("🎯 "+ps.asistencias+" asistencia"+(ps.asistencias>1?"s":""));
            const sancsEv = (match.events||[]).filter(e=>(e.type==="y_us"||e.type==="r_us")&&e.txt?.includes(mvpPlayer.nombre));
            if (sancsEv.length===0) hazanas.push("✅ Juego limpio — sin tarjetas");
            if (hazanas.length===0) hazanas.push("⭐ Desempeño destacado durante todo el partido");
            const misV = Object.values(votosActuales).filter(v=>v===mvpPlayer.id).length;

            // Crear un div HTML oculto con el diseño del certificado
            const div = document.createElement("div");
            div.style.cssText = [
              "position:fixed","top:-9999px","left:-9999px",
              "width:794px","height:1123px",
              "background:#04060c",
              "font-family:'Segoe UI',Arial,sans-serif",
              "overflow:hidden","box-sizing:border-box"
            ].join(";");

            div.innerHTML = `
              <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#d4b84a;"></div>
              <div style="position:absolute;bottom:0;left:0;right:0;height:18px;background:#d4b84a;"></div>
              <div style="position:absolute;top:0;left:0;width:16px;height:100%;background:#E53935;"></div>
              <div style="position:absolute;top:0;right:0;width:16px;height:100%;background:#1565C0;"></div>

              <div style="margin:28px 50px 0;text-align:center;">
                <div style="font-size:52px;font-weight:900;color:#2196F3;letter-spacing:6px;line-height:1.1;">RÓMULO</div>
                <div style="font-size:42px;font-weight:900;color:#E53935;letter-spacing:8px;margin-top:-6px;">F.C</div>
                <div style="font-size:14px;color:#6a8aa8;margin-top:4px;letter-spacing:2px;">Academia de Fútbol Sala · Temporada 2026</div>
                <div style="height:2px;background:#d4b84a;margin:18px auto;width:80%;border-radius:1px;"></div>
              </div>

              <div style="text-align:center;margin-top:10px;">
                <div style="font-size:18px;color:#d4b84a;letter-spacing:6px;font-weight:600;">✦ ✦ ✦</div>
                <div style="font-size:56px;font-weight:900;color:#d4b84a;letter-spacing:4px;margin:8px 0 4px;">MVP DEL PARTIDO</div>
                <div style="font-size:60px;margin:6px 0 10px;">🏅</div>
              </div>

              <div style="text-align:center;margin:0 50px;display:flex;flex-direction:column;align-items:center;">
                ${mvpPlayer.foto ? `
                  <div style="width:130px;height:130px;border-radius:50%;overflow:hidden;border:4px solid #d4b84a;box-shadow:0 0 24px rgba(212,184,74,.4);margin-bottom:14px;flex-shrink:0;">
                    <img src="${mvpPlayer.foto}" style="width:100%;height:100%;object-fit:cover;" crossorigin="anonymous"/>
                  </div>
                ` : `
                  <div style="width:110px;height:110px;border-radius:50%;background:rgba(33,150,243,.15);border:4px solid #d4b84a;display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:48px;">
                    ⚽
                  </div>
                `}
                <div style="font-size:44px;font-weight:900;color:#ffffff;letter-spacing:2px;line-height:1.1;">
                  ${mvpPlayer.nombre.toUpperCase()} ${mvpPlayer.apellido.toUpperCase()}
                </div>
                <div style="font-size:17px;color:#2196F3;margin-top:8px;letter-spacing:1px;">
                  ${mvpPlayer.cat} · Camiseta #${mvpPlayer.num}
                </div>
                <div style="height:1px;background:rgba(33,150,243,.3);margin:14px auto;width:70%;"></div>
              </div>

              <div style="text-align:center;margin:0 50px;">
                <div style="font-size:16px;color:#9ab8cc;margin-bottom:4px;">
                  ${match.home} ${match.scoreH} – ${match.scoreA} ${match.away}
                </div>
                <div style="font-size:13px;color:#6a8aa8;">
                  ${match.date}${match.field?" · "+match.field:""}
                </div>
              </div>

              <div style="text-align:center;margin:22px 60px 0;">
                <div style="font-size:16px;font-weight:700;color:#d4b84a;letter-spacing:3px;margin-bottom:14px;">DESTACADO DEL PARTIDO</div>
                ${hazanas.map(h=>`<div style="font-size:15px;color:#dde8f0;margin-bottom:8px;padding:7px 20px;background:rgba(33,150,243,.06);border-radius:8px;border-left:3px solid rgba(33,150,243,.3);">${h}</div>`).join("")}
              </div>

              <div style="text-align:center;margin:20px 60px 0;padding:14px 20px;background:rgba(212,184,74,.07);border-top:1px solid rgba(212,184,74,.2);border-bottom:1px solid rgba(212,184,74,.2);">
                <div style="font-size:14px;color:#b0bec5;font-style:italic;line-height:1.8;">
                  Tu esfuerzo y dedicación en cada entrenamiento y partido<br>
                  son el reflejo del verdadero espíritu de Rómulo F.C.<br>
                  <strong style="color:#d4b84a;">¡Sigue brillando, el equipo está orgulloso de ti!</strong>
                </div>
              </div>

              <div style="text-align:center;margin-top:14px;">
                <div style="font-size:13px;color:#2196F3;">
                  Votación: ${misV} de ${votosEmit} entrenadores
                </div>
              </div>

              <div style="position:absolute;bottom:32px;left:0;right:0;text-align:center;">
                <div style="display:inline-block;border-top:1px solid rgba(180,180,180,.3);padding-top:8px;min-width:200px;">
                  <div style="font-size:12px;color:#9ab8cc;">Director Técnico — Rómulo García</div>
                  <div style="font-size:11px;color:#6a8aa8;margin-top:2px;">Rómulo F.C · ${match.date}</div>
                </div>
              </div>
            `;

            document.body.appendChild(div);
            const filename = "mvp_"+mvpPlayer.nombre+"_"+mvpPlayer.apellido+"_"+match.date.replace(/\//g,"-")+".pdf";
            divToPdf(div, filename, onReady);
          });
        }

        return (
          <div className="ov" onClick={e => { if(e.target.className==="ov") setMvpModal(null); }}>
            <div className="modal" style={{ borderTop:"3px solid #d4b84a", maxHeight:"92vh", overflowY:"auto" }}>
              <div className="mt2" style={{ color:"#d4b84a" }}>
                🏅 MVP — {match.home} vs {match.away}
                <span className="mx" onClick={() => setMvpModal(null)}>✕</span>
              </div>
              <div style={{ fontSize:8, color:"#4e6a88", marginBottom:10 }}>
                {match.date} · {match.cat} · {match.scoreH}–{match.scoreA}
              </div>

              {/* Estado de votación */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                background:"var(--inp)", borderRadius:8, padding:"8px 10px", marginBottom:10 }}>
                <div style={{ fontSize:9 }}>
                  Votos emitidos: <strong style={{ color:"#7ab3e0" }}>{votosEmit}</strong> / {totalCoaches}
                </div>
                <span className={"bg " + (votacionCerrada ? "bg-b" : "bg-y")}>
                  {votacionCerrada ? "✅ Cerrada" : "⏳ En curso"}
                </span>
              </div>

              {/* MVP actual / ganador */}
              {mvpP && (
                <div style={{ background:"rgba(212,184,74,.08)", border:"1px solid rgba(212,184,74,.25)",
                  borderRadius:10, padding:"12px", marginBottom:10, textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#8a7040", marginBottom:3, textTransform:"uppercase", letterSpacing:.5 }}>
                    {votacionCerrada ? "🏆 MVP del Partido" : "Líder actual"}
                  </div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#d4b84a" }}>
                    {mvpP.nombre} {mvpP.apellido}
                  </div>
                  <div style={{ fontSize:9, color:"#7ab3e0" }}>#{mvpP.num} · {mvpP.cat}</div>
                  <div style={{ fontSize:8, color:"#4e6a88", marginTop:3 }}>
                    {Object.values(votosActuales).filter(v=>v===mvpId).length} voto{Object.values(votosActuales).filter(v=>v===mvpId).length>1?"s":""}
                  </div>
                </div>
              )}

              {/* Si no votó aún → mostrar botones para votar */}
              {puedeVotar && !votacionCerrada && (
                <>
                  <div style={{ fontSize:9, color:"#7ab3e0", fontWeight:600, marginBottom:6 }}>
                    Tu voto — ¿Quién fue el mejor?
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
                    {convPls.map(p => (
                      <button key={p.id}
                        style={{ background:"rgba(21,101,192,.1)", border:"1px solid rgba(33,150,243,.2)",
                          borderRadius:8, padding:"7px 10px", color:"#7ab3e0", fontSize:9, cursor:"pointer" }}
                        onClick={() => castVoto(p.id)}>
                        #{p.num} {p.nombre} {p.apellido}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Si ya votó → mostrar a quién votó */}
              {misVoto && (() => {
                const vP = players.find(x=>x.id===misVoto);
                return vP ? (
                  <div style={{ background:"rgba(21,101,192,.08)", borderRadius:8, padding:"7px 10px", marginBottom:10,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#4e6a88" }}>Tu voto:</span>
                    <span style={{ fontSize:10, color:"#7ab3e0", fontWeight:600 }}>#{vP.num} {vP.nombre} {vP.apellido}</span>
                    {!votacionCerrada && (
                      <button className="btn-sm" style={{ fontSize:8 }}
                        onClick={() => {
                          const upd = { ...match, mvpVotos: { ...votosActuales } };
                          delete upd.mvpVotos[user.id];
                          safeSetDoc(doc(db,"matches",String(match.id)), upd);
                        }}>Cambiar</button>
                    )}
                  </div>
                ) : null;
              })()}

              {/* Si no votó y votación cerrada → aviso */}
              {!misVoto && votacionCerrada && (
                <div style={{ background:"rgba(229,57,53,.07)", border:"1px solid rgba(229,57,53,.15)",
                  borderRadius:8, padding:"8px 10px", marginBottom:10 }}>
                  <div style={{ fontSize:9, color:"#e8a0a0" }}>
                    ⚠️ No emitiste tu voto antes del cierre. No puedes generar el certificado PDF.
                  </div>
                </div>
              )}

              {/* Marcador de todos los votos */}
              {votosEmit > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:8, color:"#3a5068", marginBottom:5, textTransform:"uppercase", letterSpacing:.5 }}>
                    Marcador de votos
                  </div>
                  {Object.entries(conteo).sort((a,b)=>b[1]-a[1]).map(([pid,v]) => {
                    const p = players.find(x=>x.id===pid);
                    if (!p) return null;
                    const pct = Math.round(v/votosEmit*100);
                    return (
                      <div key={pid} style={{ marginBottom:6 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:2 }}>
                          <span>#{p.num} {p.nombre} {p.apellido}</span>
                          <span style={{ color:"#d4b84a", fontFamily:"'Bebas Neue',sans-serif", fontSize:14 }}>{v} voto{v>1?"s":""}</span>
                        </div>
                        <div className="pb"><div className="pf" style={{ width:pct+"%", background:"#d4b84a" }}/></div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Botón generar + enviar PDF */}
              {puedeGenerar && mvpP && (
                <div style={{ background:"rgba(212,184,74,.06)", border:"1px solid rgba(212,184,74,.2)",
                  borderRadius:10, padding:"12px", marginTop:4 }}>
                  <div style={{ fontSize:9, color:"#d4b84a", fontWeight:600, marginBottom:8, textAlign:"center" }}>
                    🏅 {mvpP.nombre} {mvpP.apellido} es el MVP
                  </div>
                  <button className="btn" style={{ width:"100%", marginBottom:8, background:"rgba(212,184,74,.15)",
                    border:"1px solid rgba(212,184,74,.4)", color:"#d4b84a" }}
                    onClick={() => {
                      generateAndSendMvpPdf(mvpP, () => {
                        // Marcar como enviado en Firebase
                        const upd = { ...match,
                          mvp: { playerId:mvpP.id, nombre:mvpP.nombre, apellido:mvpP.apellido, votos:votosActuales },
                          mvpPdfEnviado: true,
                          mvpPdfEnviadoPor: user?.name,
                          mvpPdfFecha: new Date().toLocaleDateString("es")
                        };
                        safeSetDoc(doc(db,"matches",String(match.id)), upd);
                        setMvpPdfSent(true);
                      });
                    }}>
                    📄 GENERAR CERTIFICADO PDF
                  </button>

                  {/* WhatsApp al jugador y representante */}
                  <div style={{ fontSize:8, color:"#4e6a88", marginBottom:6, textAlign:"center" }}>
                    Envía la felicitación por WhatsApp:
                  </div>
                  <div style={{ display:"flex", gap:7 }}>
                    <button className="btn-wa" style={{ flex:1, justifyContent:"center" }}
                      onClick={() => {
                        const msg = "🏅 ¡Felicitaciones "+mvpP.nombre+"! Has sido elegido MVP del partido "+match.home+" "+match.scoreH+"-"+match.scoreA+" "+match.away+" del "+match.date+". ¡El equipo Rómulo F.C está orgulloso de tu desempeño! ⚽🔵";
                        if (mvpP.tel) openWA(mvpP.tel, msg);
                      }}>
                      📲 WA Jugador
                    </button>
                    <button className="btn-wa" style={{ flex:1, justifyContent:"center" }}
                      onClick={() => {
                        const msg = "🏅 Hola "+mvpP.repNombre+", nos complace informarle que "+mvpP.nombre+" "+mvpP.apellido+" fue elegido MVP del partido "+match.home+" "+match.scoreH+"-"+match.scoreA+" "+match.away+" del "+match.date+". ¡El equipo Rómulo F.C reconoce su esfuerzo y dedicación! ⚽🔵";
                        openWA(mvpP.repTel, msg);
                      }}>
                      📲 WA Representante
                    </button>
                  </div>
                </div>
              )}

              {/* PDF ya enviado */}
              {pdfEnviado && (
                <div style={{ background:"rgba(21,101,192,.06)", border:"1px solid rgba(33,150,243,.15)",
                  borderRadius:8, padding:"9px 10px", marginTop:8, textAlign:"center" }}>
                  <div style={{ fontSize:9, color:"#7ab3e0" }}>
                    ✅ Certificado PDF generado y enviado por <strong>{match.mvpPdfEnviadoPor}</strong> el {match.mvpPdfFecha}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── MODAL RESULTADO RÁPIDO ── */}
      {quickResult && (
        <QuickResultModal
          m={quickResult}
          players={players}
          onClose={()=>{ setQuickResult(null); setQr({scoreH:"",scoreA:"",goleadores:[]}); }}
          onSave={(sH,sA,playerStats,events)=>{
            const matchData={...quickResult,scoreH:sH,scoreA:sA,status:"finalizado",events,playerStats};
            safeSetDoc(doc(db,"matches",String(quickResult.id)),matchData);
            // Actualizar stats de cada jugador
            const catPls=players.filter(p=>p.cat===quickResult.cat);
            catPls.forEach(pl=>{
              const ps=playerStats[pl.id]||{};
              const cur=pl.stats||{goles:0,asistencias:0,partidos:0};
              safeSetDoc(doc(db,"players",String(pl.id)),{...pl,stats:{
                goles:(cur.goles||0)+(ps.goles||0),
                asistencias:(cur.asistencias||0)+(ps.asistencias||0),
                partidos:(cur.partidos||0)+1,
              }});
              // Tarjetas
              if (ps.amarilla||ps.roja) {
                const sc=sanc[pl.id]||{yellows:0,reds:0,suspended:false};
                safeSetDoc(doc(db,"sanc",String(pl.id)),{
                  ...sc,
                  yellows:(sc.yellows||0)+(ps.amarilla?1:0),
                  reds:(sc.reds||0)+(ps.roja?1:0),
                  suspended:ps.roja?true:sc.suspended,
                });
              }
            });
            const res=sH>sA?"🏆 VICTORIA":sH<sA?"😔 DERROTA":"🤝 EMPATE";
            addNotif(res+" · "+quickResult.home+" "+sH+"-"+sA+" "+quickResult.away,"calendario","cat:"+quickResult.cat,"resultado");
            setQuickResult(null);
          }}
        />
      )}

      {/* ── MODAL EXENCIÓN DE MES ── */}
      {exentoModal && (() => {
        const { pid, mes } = exentoModal;
        const pl = players.find(x => String(x.id) === String(pid));
        if (!pl) return null;
        function saveExento() {
          if (!exentoMotivo.trim()) return;
          const mesData = { paid:false, date:null, ref:null, monto:null, metodo:null,
            exento:true, motivoExento:exentoMotivo.trim(),
            exentoBy: user?.name, exentoDate: new Date().toLocaleDateString("es") };
          const upd = {
            ...pay[pid],
            months: { ...pay[pid]?.months, [mes]: mesData },
            history: [...(pay[pid]?.history||[]), {
              action:"Exención", item:mes,
              date: new Date().toLocaleDateString("es"),
              ref: exentoMotivo.trim()
            }]
          };
          safeSetDoc(doc(db,"pay",String(pid)), upd);
          setExentoModal(null); setExentoMotivo("");
        }
        return (
          <div className="ov" onClick={e=>{ if(e.target.className==="ov") setExentoModal(null); }}>
            <div className="modal" style={{ borderTop:"3px solid #d4b84a" }}>
              <div className="mt2" style={{ color:"#d4b84a" }}>
                🔓 Marcar como Exento
                <span className="mx" onClick={()=>setExentoModal(null)}>✕</span>
              </div>
              {/* Info del jugador y mes */}
              <div style={{ background:"rgba(212,184,74,.07)", border:"1px solid rgba(212,184,74,.2)",
                borderRadius:8, padding:"9px 12px", marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#fff" }}>{pl.nombre} {pl.apellido}</div>
                <div style={{ fontSize:9, color:"#8a7040", marginTop:2 }}>
                  {mes} — {pl.cat} · #{pl.num}
                </div>
              </div>
              <div style={{ fontSize:8.5, color:"#4e6a88", marginBottom:10, lineHeight:1.6 }}>
                El mes quedará marcado como <strong style={{ color:"#d4b84a" }}>🔓 Exento</strong> — 
                no contará como deuda ni como pago. Se registrará en el historial.
              </div>
              {/* Motivo obligatorio */}
              <div className="inp-wrap" style={{ marginBottom:12 }}>
                <div className="inp-lbl">Motivo de exención <span style={{ color:"#E53935" }}>*</span></div>
                <textarea className="inp" rows={3} style={{ resize:"none" }}
                  placeholder="Ej: Beca deportiva, lesión de larga duración, acuerdo especial..."
                  value={exentoMotivo}
                  onChange={e=>setExentoMotivo(e.target.value)}/>
                {exentoMotivo.trim().length === 0 && (
                  <div style={{ fontSize:7.5, color:"#E53935", marginTop:3 }}>El motivo es obligatorio</div>
                )}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-sm" style={{ flex:1 }} onClick={()=>setExentoModal(null)}>Cancelar</button>
                <button className="btn" style={{ flex:2, background:"rgba(212,184,74,.15)",
                  border:"1px solid rgba(212,184,74,.4)", color:"#d4b84a",
                  opacity: exentoMotivo.trim() ? 1 : 0.4 }}
                  onClick={saveExento}>
                  🔓 CONFIRMAR EXENCIÓN
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL REGISTRO DE PAGO MENSUAL ── */}
      {payModal && (() => {
        const p          = players.find(x => x.id === payModal.pid);
        if (!p) return null;
        const esDivisa   = ["Efectivo USD","Zelle","Binance"].includes(payMetodo);
        const esEfectivo = ["Efectivo Bs.","Efectivo USD"].includes(payMetodo);
        const tasa       = parseFloat(tasaCambio) || 1;
        const montoNum   = parseFloat(payMonto) || 0;
        const equivalente = esDivisa && montoNum > 0
          ? (montoNum * tasa).toFixed(2)
          : null;

        return (
          <div className="ov" onClick={e => { if (e.target.className==="ov") setPayModal(null); }}>
            <div className="modal">
              <div className="mt2">
                💳 Registrar Pago · {payModal.mes}
                <span className="mx" onClick={() => setPayModal(null)}>✕</span>
              </div>

              {/* Datos del jugador */}
              <div style={{ display:"flex", alignItems:"center", gap:9, background:"var(--inp)",
                borderRadius:8, padding:"8px 10px", marginBottom:12 }}>
                <Avatar p={p} size={32} />
                <div>
                  <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre} {p.apellido}</div>
                  <div style={{ fontSize:8, color:"#4e6a88" }}>{p.cat} · CI: {p.cedula}</div>
                  <div style={{ fontSize:8, color:"#4e6a88" }}>Rep: {p.repNombre} {p.repApellido} · {p.repTel}</div>
                </div>
              </div>

              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                <div style={{ flex:1, background:"rgba(21,101,192,.08)", borderRadius:7, padding:"7px 10px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#4e6a88" }}>Mes</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", letterSpacing:.5 }}>{payModal.mes}</div>
                </div>
                <div style={{ flex:1, background:"rgba(21,101,192,.08)", borderRadius:7, padding:"7px 10px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#4e6a88" }}>Registrado por</div>
                  <div style={{ fontSize:9, fontWeight:600, color:"var(--txt)", marginTop:3 }}>{user?.name}</div>
                </div>
              </div>

              {/* Método de pago */}
              <div className="inp-wrap" style={{ marginBottom:10 }}>
                <div className="inp-lbl">Método de Pago</div>
                <select className="inp" value={payMetodo}
                  onChange={e => { setPayMetodo(e.target.value); setPayRef(""); setPayMonto(""); setPayErr(""); }}>
                  <optgroup label="Bolívares">
                    <option>Transferencia</option>
                    <option>Pago Móvil</option>
                    <option>Efectivo Bs.</option>
                  </optgroup>
                  <optgroup label="Divisas">
                    <option>Efectivo USD</option>
                    <option>Zelle</option>
                    <option>Binance</option>
                  </optgroup>
                </select>
              </div>

              {/* Tasa de cambio — solo si es divisa */}
              {esDivisa && (
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(212,184,74,.06)",
                  border:"1px solid rgba(212,184,74,.15)", borderRadius:8, padding:"8px 10px", marginBottom:10 }}>
                  <span style={{ fontSize:14 }}>💱</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:8, color:"#d4b84a", fontWeight:600, marginBottom:3 }}>TASA DE CAMBIO (Bs. / $1)</div>
                    <input className="inp" type="number" value={tasaCambio}
                      onChange={e => setTasaCambio(e.target.value)}
                      style={{ background:"rgba(212,184,74,.07)", border:"1px solid rgba(212,184,74,.2)" }} />
                  </div>
                </div>
              )}

              {/* Referencia — solo si NO es efectivo */}
              {!esEfectivo && (
                <div className="inp-wrap">
                  <div className="inp-lbl">N° de Referencia *</div>
                  <input className="inp" placeholder={
                    payMetodo === "Zelle" ? "Ej: zelle@correo.com o confirmación" :
                    payMetodo === "Binance" ? "Ej: Hash / TxID" :
                    "Ej: 00123456789"
                  } value={payRef}
                    onChange={e => { setPayRef(e.target.value); setPayErr(""); }} />
                </div>
              )}
              {esEfectivo && (
                <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(33,150,243,.04)",
                  borderRadius:7, padding:"7px 9px", marginBottom:8 }}>
                  <span style={{ fontSize:12 }}>ℹ️</span>
                  <span style={{ fontSize:8, color:"#4e6a88" }}>Pago en efectivo — no se requiere referencia.</span>
                </div>
              )}

              {/* Monto */}
              <div className="inp-wrap">
                <div className="inp-lbl">
                  {esDivisa ? "Monto en USD ($) *" : "Monto en Bolívares (Bs.) *"}
                </div>
                <input className="inp" type="number" step="0.01"
                  placeholder={esDivisa ? "Ej: 5.00" : "Ej: 2500.00"}
                  value={payMonto}
                  onChange={e => { setPayMonto(e.target.value); setPayErr(""); }} />
              </div>

              {/* Equivalente en Bs. */}
              {equivalente && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  background:"rgba(21,101,192,.08)", borderRadius:7, padding:"7px 10px", marginBottom:8 }}>
                  <span style={{ fontSize:8, color:"#4e6a88" }}>Equivalente en Bs. (tasa {parseFloat(tasaCambio).toFixed(2)})</span>
                  <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                    color:"#7ab3e0", letterSpacing:.5 }}>Bs. {equivalente}</span>
                </div>
              )}

              {payErr && <div className="err">⚠️ {payErr}</div>}

              {/* Foto del comprobante */}
              <div className="inp-wrap" style={{ marginTop:8 }}>
                <div className="inp-lbl">📸 Foto del comprobante (opcional)</div>
                {payFoto ? (
                  <div style={{ position:"relative", marginBottom:4 }}>
                    <img src={payFoto} alt="comprobante" style={{ width:"100%", borderRadius:8, border:"1px solid rgba(33,150,243,.15)", maxHeight:160, objectFit:"cover" }} />
                    <button onClick={() => setPayFoto(null)} style={{ position:"absolute", top:5, right:5, background:"rgba(183,28,28,.8)", border:"none", borderRadius:"50%", width:22, height:22, color:"#fff", cursor:"pointer", fontSize:10 }}>✕</button>
                  </div>
                ) : (
                  <button className="btn-sm" style={{ width:"100%", padding:9, fontSize:10 }}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "image/*"; input.capture = "environment";
                      input.onchange = e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = ev => setPayFoto(ev.target.result);
                        reader.readAsDataURL(file);
                      };
                      input.click();
                    }}>📷 Tomar foto / seleccionar imagen</button>
                )}
              </div>

              <div style={{ display:"flex", gap:7, marginTop:8 }}>
                <button className="btn" style={{ flex:1 }} onClick={confirmPayMonth}>
                  ✅ CONFIRMAR Y GENERAR PDF
                </button>
                <button className="btn-sm" style={{ padding:"10px 14px" }}
                  onClick={() => { setPayModal(null); setPayFoto(null); }}>Cancelar</button>
              </div>

              <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:10,
                background:"rgba(33,150,243,.04)", borderRadius:7, padding:"7px 9px" }}>
                <span style={{ fontSize:13 }}>📄</span>
                <span style={{ fontSize:8, color:"#4e6a88", lineHeight:1.5 }}>
                  Se generará y descargará un comprobante PDF automáticamente al confirmar.
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal confirmar eliminar partido */}
      {confirmDelM && (
        <div className="ov" onClick={() => setConfirmDelM(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:6 }}>🗑️</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#ef9a9a", marginBottom:4 }}>
              Eliminar Partido
            </div>
            <div style={{ fontSize:10, color:"var(--txt)", marginBottom:4 }}>
              {confirmDelM.home} vs {confirmDelM.away}
            </div>
            <div style={{ fontSize:9, color:"#4e6a88", marginBottom:14 }}>
              {confirmDelM.date} · {confirmDelM.time} · {confirmDelM.cat}
            </div>
            <div style={{ fontSize:9, color:"#ef9a9a", marginBottom:14 }}>
              Esta acción no se puede deshacer.
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn" style={{ flex:1, background:"rgba(183,28,28,.2)", borderColor:"rgba(183,28,28,.4)", color:"#ef9a9a" }}
                onClick={() => {
                  safeDeleteDoc(doc(db, "matches", confirmDelM.id));
                  addNotif("🗑️ Partido eliminado: " + confirmDelM.home + " vs " + confirmDelM.away, "calendario", "cat:"+(confirmDelM.cat||"all"), "partido");
                  setConfirmDelM(null);
                }}>
                🗑️ Eliminar
              </button>
              <button className="btn-sm" style={{ flex:1, padding:10 }} onClick={() => setConfirmDelM(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal WhatsApp al registrar jugador */}
      {newPlayerWA && (
        <div className="ov" onClick={() => setNewPlayerWA(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:4 }}>✅</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", marginBottom:2 }}>
              Jugador registrado
            </div>
            <div style={{ fontSize:11, color:"#4e6a88", marginBottom:14 }}>
              {newPlayerWA.nombre} {newPlayerWA.apellido}
            </div>
            <div style={{ fontSize:10, color:"var(--txt)", marginBottom:10 }}>
              Envía el enlace de la app por WhatsApp:
            </div>

            {newPlayerWA.tel && (
              <button className="btn" style={{ width:"100%", marginBottom:8, background:"#1a7a3a" }}
                onClick={() => {
                  const msg = encodeURIComponent(
                    `Hola ${newPlayerWA.nombre} 👋\n\nYa estás registrado en la app de *Rómulo F.C* ⚽\n\nDescarga e instala la app desde este enlace:\n👉 https://romulo-fc.pages.dev\n\n*Tu acceso:*\n🔹 Perfil: Jugador\n🔹 Cédula: ${newPlayerWA.cedula}\n\n¡Bienvenido al equipo! 🏆`
                  );
                  window.open(`https://wa.me/58${newPlayerWA.tel.replace(/^0/,"")}?text=${msg}`, "_blank");
                }}>
                📲 Enviar al Jugador por WhatsApp
              </button>
            )}

            {newPlayerWA.repTel && (
              <button className="btn" style={{ width:"100%", marginBottom:8, background:"#1a4a7a" }}
                onClick={() => {
                  const msg = encodeURIComponent(
                    `Hola ${newPlayerWA.repNombre} 👋\n\nSu hijo/a *${newPlayerWA.nombre} ${newPlayerWA.apellido}* ya está registrado en la app de *Rómulo F.C* ⚽\n\nDescarga e instala la app desde este enlace:\n👉 https://romulo-fc.pages.dev\n\n*Su acceso:*\n🔹 Perfil: Representante\n🔹 Cédula: ${newPlayerWA.repCedula}\n\nDesde la app podrá ver pagos, partidos y estadísticas de su hijo/a. 📊`
                  );
                  window.open(`https://wa.me/58${newPlayerWA.repTel.replace(/^0/,"")}?text=${msg}`, "_blank");
                }}>
                📲 Enviar al Representante por WhatsApp
              </button>
            )}

            <button className="btn-sm" style={{ width:"100%", marginTop:4 }}
              onClick={() => setNewPlayerWA(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
