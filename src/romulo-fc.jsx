import { useState, useRef, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CATS   = ["Sub-11","Sub-13","Sub-15","Sub-17","Sub-19"];
const CAT_COLOR = {
  "Sub-11":"#1565C0","Sub-13":"#0D47A1","Sub-15":"#1976D2",
  "Sub-17":"#1E88E5","Sub-19":"#2196F3"
};

const COACHES_DEFAULT = [
  {id:"1",name:"Rómulo García",  role:"Director Técnico", pin:"1111",cat:"Todas",  tel:"04140000001",
   perms:["jugadores","pagos","calendario","stats","entrenadores","partido"]},
  {id:"2",name:"Carlos Mendez",  role:"Entrenador Sub-11",pin:"2222",cat:"Sub-11", tel:"04140000002",
   perms:["jugadores","pagos","calendario","stats","partido"]},
  {id:"3",name:"Luis Torres",    role:"Entrenador Sub-13",pin:"3333",cat:"Sub-13", tel:"04140000003",
   perms:["jugadores","pagos","calendario","stats","partido"]},
  {id:"4",name:"Andrés Vega",    role:"Entrenador Sub-15",pin:"4444",cat:"Sub-15", tel:"04140000004",
   perms:["jugadores","pagos","calendario","stats","partido"]},
  {id:"5",name:"Miguel Soto",    role:"Entrenador Sub-17",pin:"5555",cat:"Sub-17", tel:"04140000005",
   perms:["jugadores","pagos","calendario","stats","partido"]},
  {id:"6",name:"Diego Ríos",     role:"Entrenador Sub-19",pin:"6666",cat:"Sub-19", tel:"04140000006",
   perms:["jugadores","pagos","calendario","stats","partido"]},
  {id:"7",name:"Javier Cruz",    role:"Asistente General",pin:"7777",cat:"Todas",  tel:"04140000007",
   perms:["jugadores","calendario","stats"]},
];

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
  onSnapshot, setDoc, updateDoc, deleteDoc, getDoc
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

// VAPID key — la obtienes en Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = "BEbMBO0z6wJn_Go07XmMsZuujs7Y0n3cm-WmAPCkXubfzs3chUBJpwLCDw_fLY89MJ5Zzauq7-3ZS7zswC4z08s";


const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#04060c;color:#afc4d8;font-family:'DM Sans',sans-serif;min-height:100vh;font-size:13px;letter-spacing:.01em;}
.app{max-width:430px;margin:0 auto;min-height:100vh;background:#04060c;position:relative;}
.hdr{background:rgba(4,6,12,.97);padding:11px 15px 9px;border-bottom:1px solid rgba(33,150,243,.07);position:sticky;top:0;z-index:100;backdrop-filter:blur(10px);}
.hdr-row{display:flex;justify-content:space-between;align-items:center;}
.logo{font-family:'Bebas Neue',sans-serif;font-size:22px;font-weight:400;letter-spacing:2px;}
.lb{color:#2196F3;}.lr{color:#E53935;}
.hdr-sub{font-size:7px;color:#3a5068;letter-spacing:2px;text-transform:uppercase;margin-top:1px;font-family:'DM Sans',sans-serif;}
.hdr-right{display:flex;gap:5px;align-items:center;}
.badge{font-size:7.5px;font-weight:500;padding:2px 8px;border-radius:4px;letter-spacing:.3px;font-family:'DM Sans',sans-serif;}
.badge-r{background:rgba(183,28,28,.12);color:#e8a0a0;border:1px solid rgba(229,57,53,.16);}
.badge-b{background:rgba(21,101,192,.12);color:#7ab3e0;border:1px solid rgba(33,150,243,.16);}
.ico-btn{width:29px;height:29px;border-radius:50%;border:1px solid rgba(33,150,243,.08);background:#090d1a;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;position:relative;}
.rdot{width:6px;height:6px;background:#E53935;border-radius:50%;position:absolute;top:2px;right:2px;}
.nav{display:flex;gap:4px;overflow-x:auto;padding:7px 13px;background:#060919;border-bottom:1px solid rgba(33,150,243,.06);scrollbar-width:none;}
.nav::-webkit-scrollbar{display:none;}
.nb{flex-shrink:0;padding:4px 11px;border-radius:14px;border:1px solid rgba(33,150,243,.08);background:transparent;color:#3a5068;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:400;cursor:pointer;white-space:nowrap;}
.nb.ab{background:#1565C0;border-color:#1565C0;color:#fff;font-weight:500;}
.cnt{padding:12px 14px 100px;}
.card{background:#06091a;border:1px solid rgba(33,150,243,.08);border-radius:12px;padding:12px;margin-bottom:9px;}
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
.sb{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:9px;padding:9px 5px;text-align:center;}
.sn{font-family:'Bebas Neue',sans-serif;font-size:24px;font-weight:400;line-height:1;}
.sl{font-size:7px;color:#3a5068;margin-top:1px;text-transform:uppercase;letter-spacing:.3px;font-family:'DM Sans',sans-serif;}
.pr{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.02);}
.pr:last-child{border-bottom:none;}
.av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-weight:400;color:#fff;flex-shrink:0;overflow:hidden;}
.av img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
.pi{flex:1;min-width:0;}
.pn{font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ps{font-size:8px;color:#3a5068;}
.ck{width:23px;height:23px;border-radius:6px;border:1.5px solid rgba(33,150,243,.15);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}
.ck.on{background:#1565C0;border-color:#1565C0;}
.pb{height:3px;background:#090d1a;border-radius:2px;overflow:hidden;margin-top:3px;}
.pf{height:100%;border-radius:2px;}
.pf-b{background:linear-gradient(90deg,#0D47A1,#1976D2);}
.pf-r{background:linear-gradient(90deg,#B71C1C,#E53935);}
.mc{background:#090d1a;border-radius:9px;padding:10px;margin-bottom:7px;border:1px solid rgba(33,150,243,.08);}
.mt{display:flex;justify-content:space-between;align-items:center;gap:4px;}
.tn{font-family:'Bebas Neue',sans-serif;font-size:13px;font-weight:400;flex:1;}
.tn-h{text-align:left;}.tn-a{text-align:right;}
.sc{background:#06091a;border:1px solid rgba(33,150,243,.1);border-radius:6px;padding:3px 9px;font-family:'Bebas Neue',sans-serif;font-size:17px;font-weight:400;color:#2196F3;flex-shrink:0;}
.mm{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px;}
.mi{font-size:8px;color:#3a5068;background:#06091a;border-radius:4px;padding:2px 5px;}
.dtabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:9px;}
.dt{padding:4px 9px;border-radius:7px;font-size:9px;cursor:pointer;border:1px solid rgba(33,150,243,.08);background:transparent;color:#3a5068;font-family:'DM Sans',sans-serif;}
.dt.da{border-color:#1565C0;color:#7ab3e0;background:rgba(21,101,192,.08);}
.ptabs{display:flex;border-radius:8px;overflow:hidden;border:1px solid rgba(33,150,243,.08);margin-bottom:10px;}
.pt{flex:1;padding:7px 3px;text-align:center;font-size:9px;font-weight:400;cursor:pointer;color:#3a5068;font-family:'DM Sans',sans-serif;}
.pt.pa{background:#1565C0;color:#fff;font-weight:500;}
.mgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-bottom:8px;}
.mcell{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:5px;padding:4px 2px;text-align:center;cursor:pointer;}
.mcell.mp{background:rgba(21,101,192,.08);border-color:rgba(33,150,243,.18);}
.mcell.mup{background:rgba(229,57,53,.05);border-color:rgba(229,57,53,.12);}
.mclbl{font-size:7px;color:#3a5068;font-family:'DM Sans',sans-serif;}
.mcico{font-size:10px;margin-top:1px;}
.inp{width:100%;background:#090d1a;border:1px solid rgba(33,150,243,.1);border-radius:8px;padding:7px 10px;color:#afc4d8;font-family:'DM Sans',sans-serif;font-size:11px;outline:none;}
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
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:430px;background:#060919;border-top:1px solid rgba(33,150,243,.06);display:flex;overflow-x:auto;overflow-y:hidden;padding:6px 8px 13px;z-index:100;scrollbar-width:none;gap:2px;}
.bnav::-webkit-scrollbar{display:none;}
.bn{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;color:#3a5068;font-size:7px;letter-spacing:.2px;text-transform:uppercase;font-weight:400;font-family:'DM Sans',sans-serif;padding:4px 10px;border-radius:8px;min-width:52px;transition:background .15s;}
.bn.ba{color:#2196F3;background:rgba(33,150,243,.07);}
.bi{font-size:18px;}
.st{font-family:'Bebas Neue',sans-serif;font-size:17px;font-weight:400;letter-spacing:.3px;margin-bottom:9px;display:flex;align-items:center;gap:5px;}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:500;display:flex;align-items:flex-end;justify-content:center;}
.modal{background:#06091a;border:1px solid rgba(33,150,243,.1);border-top:2px solid #1565C0;border-radius:14px 14px 0 0;padding:16px 14px 32px;width:100%;max-width:430px;max-height:92vh;overflow-y:auto;}
.mt2{font-family:'Bebas Neue',sans-serif;font-size:14px;font-weight:400;letter-spacing:.3px;margin-bottom:11px;display:flex;justify-content:space-between;align-items:center;}
.mx{font-size:16px;cursor:pointer;color:#3a5068;}
.aov{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:600;display:flex;align-items:center;justify-content:center;padding:18px;}
.abox{background:#06091a;border:1px solid rgba(33,150,243,.1);border-radius:12px;padding:18px 16px;width:100%;max-width:300px;}
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
.photo-up{width:52px;height:52px;border-radius:50%;background:#090d1a;border:2px dashed rgba(33,150,243,.15);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;position:relative;overflow:hidden;}
.photo-up img{width:100%;height:100%;object-fit:cover;position:absolute;border-radius:50%;}
.hero{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:12px;padding:14px;margin-bottom:9px;text-align:center;}
.hero-av{width:52px;height:52px;border-radius:50%;margin:0 auto 7px;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px;font-weight:400;color:#fff;border:2px solid #1565C0;overflow:hidden;}
.hero-av img{width:100%;height:100%;object-fit:cover;}
.hero-name{font-family:'Bebas Neue',sans-serif;font-size:18px;font-weight:400;}
.hero-cat{font-size:9px;color:#3a5068;margin-top:2px;font-family:'DM Sans',sans-serif;}
.crow{display:flex;align-items:flex-start;gap:7px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.02);}
.crow:last-child{border-bottom:none;}
.perms{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;}
.perm{font-size:7px;padding:1px 5px;border-radius:3px;background:rgba(33,150,243,.06);color:#5a8ab0;border:1px solid rgba(33,150,243,.1);font-family:'DM Sans',sans-serif;}
.login{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px;background:radial-gradient(ellipse at 20% 25%,rgba(13,71,161,.15) 0%,transparent 50%),radial-gradient(ellipse at 80% 75%,rgba(183,28,28,.1) 0%,transparent 50%),#04060c;}
.login-logo{font-family:'Bebas Neue',sans-serif;font-size:52px;font-weight:400;letter-spacing:6px;margin-bottom:3px;text-align:center;}
.login-sub{font-size:7.5px;color:#3a5068;letter-spacing:2px;text-transform:uppercase;margin-bottom:26px;text-align:center;font-family:'DM Sans',sans-serif;}
.lcard{width:100%;max-width:370px;background:#06091a;border:1px solid rgba(33,150,243,.1);border-radius:14px;padding:16px 14px;}
.ltitle{font-family:'Bebas Neue',sans-serif;font-size:20px;font-weight:400;letter-spacing:1px;margin-bottom:10px;}
.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.ropt{padding:10px 7px;background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:9px;cursor:pointer;text-align:center;}
.ropt:hover,.ropt.rsel{border-color:#1565C0;background:rgba(21,101,192,.07);}
.ro-ico{font-size:18px;margin-bottom:3px;}
.ro-lbl{font-size:9px;font-weight:500;font-family:'DM Sans',sans-serif;}
.ro-sub{font-size:7px;color:#3a5068;margin-top:1px;font-family:'DM Sans',sans-serif;}
.clist{display:flex;flex-direction:column;gap:4px;margin-bottom:9px;max-height:180px;overflow-y:auto;}
.citem{padding:7px 10px;background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:7px;cursor:pointer;font-size:10px;display:flex;justify-content:space-between;align-items:center;font-family:'DM Sans',sans-serif;}
.citem:hover,.citem.csel{border-color:#1565C0;color:#7ab3e0;}
.ci-role{font-size:7px;color:#3a5068;}
.linp{width:100%;background:#090d1a;border:1px solid rgba(33,150,243,.1);border-radius:8px;padding:8px 10px;color:#afc4d8;font-family:'DM Sans',sans-serif;font-size:11px;margin-bottom:6px;outline:none;}
.linp:focus{border-color:#1565C0;}
.linp::placeholder{color:#3a5068;}
.lbtn{width:100%;background:#1565C0;border:none;border-radius:8px;padding:10px;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;letter-spacing:.3px;cursor:pointer;}
.lerr{font-size:9px;color:#e8a0a0;margin-top:5px;text-align:center;font-family:'DM Sans',sans-serif;}
.back{font-size:9px;color:#3a5068;cursor:pointer;text-align:center;margin-top:7px;text-decoration:underline;font-family:'DM Sans',sans-serif;}
.hint{font-size:7.5px;color:#3a5068;margin-top:5px;text-align:center;font-family:'DM Sans',sans-serif;}
.live-hdr{background:rgba(4,6,12,.98);padding:8px 14px 6px;border-bottom:1px solid rgba(33,150,243,.07);position:sticky;top:0;z-index:50;}
.scoreboard{padding:10px 14px 8px;background:linear-gradient(180deg,rgba(6,9,26,1),rgba(4,6,12,.97));border-bottom:1px solid rgba(33,150,243,.07);}
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
.tm-row{display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;}
.tm-side{display:flex;align-items:center;gap:5px;}
.tm-lbl{font-size:7px;color:#3a5068;font-weight:400;text-transform:uppercase;font-family:'DM Sans',sans-serif;}
.tm-pill{font-size:8px;font-weight:500;padding:2px 7px;border-radius:9px;font-family:'DM Sans',sans-serif;}
.tm-ok{background:rgba(21,101,192,.08);color:#7ab3e0;border:1px solid rgba(33,150,243,.15);}
.tm-used{background:rgba(229,57,53,.06);color:#e8a0a0;border:1px solid rgba(229,57,53,.12);opacity:.6;}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px;}
.fcard{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:9px;padding:8px 10px;}
.ftitle{font-size:7px;font-weight:400;text-transform:uppercase;letter-spacing:.5px;color:#3a5068;margin-bottom:4px;font-family:'DM Sans',sans-serif;}
.fcount{font-family:'Bebas Neue',sans-serif;font-size:21px;font-weight:400;line-height:1;margin-bottom:4px;}
.fdots{display:flex;gap:3px;}
.fdot{width:11px;height:11px;border-radius:50%;border:1px solid rgba(33,150,243,.12);background:transparent;}
.fdot.fon{background:#E53935;border-color:#E53935;}
.fdot.fwn{background:#d4b84a;border-color:#d4b84a;}
.fnote{font-size:7px;margin-top:3px;font-family:'DM Sans',sans-serif;}
.abgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 14px;margin-bottom:8px;}
.abtn{padding:9px 5px;border-radius:8px;border:1px solid rgba(33,150,243,.08);background:#090d1a;color:#afc4d8;font-size:9px;font-weight:400;cursor:pointer;font-family:'DM Sans',sans-serif;text-align:center;}
.abtn:active{transform:scale(.96);}
.abtn-b{background:rgba(21,101,192,.12);border-color:rgba(33,150,243,.2);color:#7ab3e0;}
.abtn-r{background:rgba(183,28,28,.12);border-color:rgba(229,57,53,.2);color:#e8a0a0;}
.abtn-y{background:rgba(255,214,0,.05);border-color:rgba(255,214,0,.14);color:#d4b84a;}
.abtn-o{background:rgba(183,28,28,.08);border-color:rgba(229,57,53,.15);color:#e0a880;}
.abtn-dim{opacity:.3;pointer-events:none;}
.abtn-full{grid-column:1/-1;}
.psgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;max-height:220px;overflow-y:auto;margin:6px 0;}
.psbtn{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:8px;padding:8px 7px;cursor:pointer;display:flex;align-items:center;gap:6px;}
.psbtn.pssel{border-color:#1565C0;background:rgba(21,101,192,.1);}
.psbtn.psred{border-color:#C62828;background:rgba(183,28,28,.08);}
.psbtn-n{font-size:10px;font-weight:500;font-family:'DM Sans',sans-serif;}
.psbtn-s{font-size:7.5px;color:#3a5068;margin-top:1px;font-family:'DM Sans',sans-serif;}
.ftype-row{display:flex;gap:6px;margin-bottom:9px;}
.ftype-btn{flex:1;padding:9px 5px;border-radius:8px;border:1px solid rgba(33,150,243,.08);background:#090d1a;color:#3a5068;font-size:9px;font-weight:400;cursor:pointer;text-align:center;font-family:'DM Sans',sans-serif;}
.ftype-btn.ftd{border-color:#C62828;background:rgba(183,28,28,.1);color:#e8a0a0;}
.ftype-btn.fti{border-color:rgba(255,214,0,.3);background:rgba(255,214,0,.05);color:#d4b84a;}
.ftype-note{font-size:8px;color:#3a5068;margin-bottom:8px;padding:6px 8px;background:#090d1a;border-radius:6px;line-height:1.5;font-family:'DM Sans',sans-serif;}
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
.lu-slot{background:#090d1a;border:1px solid rgba(33,150,243,.08);border-radius:7px;padding:7px;display:flex;align-items:center;gap:7px;margin-bottom:5px;}
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

function MatchCard({ m, champs }) {
  const champ = champs && m.champId ? champs.find(c => c.id === m.champId) : null;
  return (
    <div className="mc">
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span className="bg bg-b">{m.cat}</span>
        <span className={"bg " + (m.status === "finalizado" ? "bg-g" : "bg-y")}>{m.status}</span>
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
    </div>
  );
}

// ─── LIVE MATCH COMPONENT ─────────────────────────────────────

function LiveMatch({ match, myPlayers, sanctions, setSanctions, onClose, onSave, minET = 5 }) {

  const [phase,      setPhase]     = useState("rivals");
  const [rivals,     setRivals]    = useState([]);
  const [rNum,       setRNum]      = useState("");
  const [rName,      setRName]     = useState("");
  const [convocados, setConvocados]= useState([]);
  const [titulares,  setTitulares] = useState([]);
  const [onField,    setOnField]   = useState([]);
  const [period,     setPeriod]    = useState(1);
  const [running,    setRunning]   = useState(false);
  const [secs,       setSecs]      = useState(0);
  const [scoreUs,    setUs]        = useState(0);
  const [scoreThem,  setThem]      = useState(0);
  const timerRef = useRef(null);

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

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [running]);

  // Countdown en paralelo — corre solo si running y timerSecs > 0
  useEffect(() => {
    if (running && timerSecs !== null && timerSecs > 0) {
      timerCdRef.current = setInterval(() => setTimerSecs(s => s > 0 ? s - 1 : 0), 1000);
    } else {
      clearInterval(timerCdRef.current);
    }
    return () => clearInterval(timerCdRef.current);
  }, [running, timerSecs !== null]);

  function addLog(type, txt, ico) {
    setEvents(e => [{ id: Date.now(), min: curMin, sec: curSec, period, type, txt, ico }, ...e]);
    const LIVE_TYPES = ["goal_us","goal_them","fd_us","fi_us","fd_them","fi_them","y_us","r_us","y_them","r_them","tm","half","end"];
    if (LIVE_TYPES.includes(type)) {
      const id = "live_" + String(Date.now());
      const matchLabel = match?.home + " vs " + match?.away;
      const fullTxt = ico + " " + pad2(curMin) + "' — " + txt + " · " + matchLabel;
      setDoc(doc(db, "notifs", id), {
        id, txt: fullTxt, ts: new Date().toISOString(), read: false, link: "calendario",
        live: true, matchId: match?.id || ""
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
            <div className="ch"><span className="ct">Seleccionar Convocados</span></div>
            {myPlayers.map(p => {
              const sel  = convocados.includes(p.id);
              const susp = sanctions[p.id] && sanctions[p.id].suspended;
              return (
                <div key={p.id} className="pr" style={{ opacity: susp ? 0.35 : 1 }}>
                  <Avatar p={p} />
                  <div className="pi">
                    <div className="pn">
                      {p.nombre} {p.apellido}
                      {susp && <span style={{ fontSize:8, color:"#EF9A9A", marginLeft:5 }}>SUSP</span>}
                    </div>
                    <div className="ps">#{p.num}</div>
                  </div>
                  <button
                    className={"ck" + (sel ? " on" : "")}
                    disabled={!!susp}
                    onClick={() => !susp && setConvocados(c => sel ? c.filter(x => x !== p.id) : [...c, p.id])}
                  >
                    {sel ? "✓" : ""}
                  </button>
                </div>
              );
            })}
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
                      <div className="psbtn-s">{p.apellido}</div>
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
            GUARDAR Y CERRAR
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
                      <button className="btn" style={{ background:"#0c1220", border:"1px solid rgba(33,150,243,.15)", fontSize:11 }} onClick={() => doGoalThem(null)}>Sin asignar</button>
                    </div>
                  </>
                ) : (
                  <button className="btn btn-red" onClick={() => doGoalThem(null)}>CONFIRMAR GOL RIVAL</button>
                )}
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
            <div style={{ fontSize:10, color:"#afc4d8", marginBottom:6 }}>
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
            <div style={{ fontSize:10, color:"#afc4d8", marginBottom:16 }}>
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

  // ── STATE ──────────────────────────────────
  const [players,  setPlayers]  = useState([]);
  const [matches,  setMatches]  = useState([]);
  const [pay,      setPay]      = useState({});
  const [sanc,     setSanc]     = useState({});
  const [att,      setAtt]      = useState({});
  const [coaches,  setCoaches]  = useState(COACHES_DEFAULT);
  const [dbReady,  setDbReady]  = useState(false);
  const [attSession, setAttSession] = useState(null);
  const [notifs,   setNotifs]   = useState([]);

  // ── PUSH NOTIFICATIONS ─────────────────────
  const [pushStatus, setPushStatus] = useState("idle"); // idle | requesting | granted | denied | unsupported

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
      setDoc(doc(db, "notifs", id), {
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
        // Guardamos el token en Firestore bajo la colección "fcm_tokens"
        const deviceId = token.slice(-20);
        await setDoc(doc(db, "fcm_tokens", deviceId), {
          token,
          coach: user?.name || "desconocido",
          coachId: user?.id || null,
          updatedAt: new Date().toISOString(),
          platform: navigator.userAgent.includes("Android") ? "android" : "ios/web"
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

  // ── FIRESTORE LISTENERS ────────────────────
  useEffect(() => {
    const unsubs = [];

    // Jugadores
    unsubs.push(onSnapshot(collection(db, "players"), snap => {
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
      setNotifs(snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a,b) => b.ts?.localeCompare?.(a.ts)||0));
    }));

    // Coaches — si Firebase está vacío, migra los defaults automáticamente
    unsubs.push(onSnapshot(collection(db, "coaches"), snap => {
      if (snap.docs.length === 0) {
        // Primera vez: guardar coaches por defecto en Firebase
        COACHES_DEFAULT.forEach(c => setDoc(doc(db, "coaches", String(c.id)), c));
      } else {
        setCoaches(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      }
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

    setDbReady(true);
    return () => unsubs.forEach(u => u());
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
  const [tasaCambio, setTasaCambio] = useState("36.50"); // Bs. por $1

  // Entrenamientos
  const DIAS_SEMANA = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
  const [trainings, setTrainings] = useState([]);
  const [showTForm,  setShowTForm]  = useState(false);
  const [editTrain,  setEditTrain]  = useState(null);
  const [nt, setNt] = useState({ dia:"Lunes", hora:"", lugar:"", cats:[], notas:"" });

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

  const NP_BLANK = { nombre:"", apellido:"", cedula:"", dob:"", tel:"", cat:"Sub-11", num:"", repNombre:"", repApellido:"", repCedula:"", repTel:"", foto:null, notas:"" };
  const [np,       setNp]       = useState(NP_BLANK);
  const [editPid,  setEditPid]  = useState(null);   // null = nuevo, number = editando
  const [nm, setNm] = useState({
    home:"Rómulo FC", away:"", date:"", time:"", cat:"Sub-11", field:"", champId:"", fase:"Normal"
  });
  const [editMid, setEditMid] = useState(null);
  const [confirmDelM, setConfirmDelM] = useState(null);

  // ── DERIVED ────────────────────────────────
  const isAdmin  = role === "admin";
  const can      = perm => isAdmin && user && Array.isArray(user.perms) && user.perms.includes(perm);
  const unread   = notifs.filter(n => !n.read).length;

  const filtP = players.filter(p => {
    const catOk  = !isAdmin || !user || user.cat === "Todas" || p.cat === user.cat;
    const filt   = catF === "Todas" || p.cat === catF;
    const srch   = !search || (p.nombre + " " + p.apellido).toLowerCase().includes(search.toLowerCase());
    return catOk && filt && srch;
  });

  const filtM = matches.filter(m => {
    const catOk = !user || user.cat === "Todas" || m.cat === user.cat;
    const filt  = catF === "Todas" || m.cat === catF;
    return catOk && filt;
  });

  const attCount = attSession ? filtP.filter(p => att[p.id] && att[p.id][attSession] && att[p.id][attSession].present).length : 0;
  const attPct   = filtP.length && attSession ? Math.round(attCount / filtP.length * 100) : 0;

  function addNotif(txt, link = null) {
    const id = String(Date.now());
    setDoc(doc(db, "notifs", id), { id, txt, ts: new Date().toISOString(), read: false, link });
  }

  // ── ACTIONS ────────────────────────────────
  function toggleAtt(pid) {
    if (!isAdmin || !attSession) return;
    const current = att[pid]?.[attSession]?.present || false;
    const updated = { ...(att[pid]||{}), [attSession]: { present: !current } };
    setDoc(doc(db, "att", String(pid)), updated);
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
          setDoc(doc(db, "pay", String(pid)), updated);
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
        metodo: payMetodo
      }},
      history: [...(pay[pid]?.history||[]), {
        action:"Pago", item:mes, date, ref,
        monto: montoBs, montoMostrado, metodo: payMetodo
      }]
    };
    setDoc(doc(db, "pay", String(pid)), updated);

    generateReceipt(p, mes, ref, montoMostrado, payMetodo, date, user?.name || "Administrador");
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
    setDoc(doc(db, "pay", String(pid)), updated);
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
      await setDoc(doc(db,"players",id), player);
      await setDoc(doc(db,"pay",id), { months:MONTHS.reduce((a,m)=>({...a,[m]:{paid:false,date:null}}),{}), championships:{}, arbitraje:[], history:[] });
      await setDoc(doc(db,"sanc",id), { yellows:0, reds:0, suspended:false, history:[] });
      await setDoc(doc(db,"att",id), {});
    }
    setCsvImporting(false);
    setShowCsvImport(false);
    setCsvPreview([]);
    addNotif("✅ " + csvPreview.length + " jugadores importados", "jugadores");
  }

  function savePlayer() {
    if (!np.nombre || !np.apellido || !np.cedula || !np.dob) { setFormErr("Nombre, apellido, cédula y fecha son obligatorios"); return; }
    if (!np.repCedula) { setFormErr("La cédula del representante es obligatoria"); return; }
    if (editPid) {
      const ref = doc(db, "players", String(editPid));
      const data = { ...np, num: parseInt(np.num)||0, col: CAT_COLOR[np.cat]||"#1565C0" };
      setDoc(ref, data);
      addNotif("Jugador actualizado: " + np.nombre + " " + np.apellido, "jugadores");
      setAddOk(true); setFormErr("");
      setTimeout(() => { setAddOk(false); setShowAdd(false); setEditPid(null); setNp(NP_BLANK); }, 1500);
    } else {
      const id = String(Date.now());
      const p  = { ...np, id, num: parseInt(np.num)||players.length+1, col: CAT_COLOR[np.cat]||"#1565C0" };
      setDoc(doc(db, "players", id), p);
      const initP = { months: MONTHS.reduce((a,m) => ({ ...a,[m]:{ paid:false,date:null } }),{}), championships:{}, arbitraje:[], history:[] };
      setDoc(doc(db, "pay",  id), initP);
      setDoc(doc(db, "sanc", id), { yellows:0, reds:0, suspended:false, history:[] });
      setDoc(doc(db, "att",  id), {});
      addNotif("Nuevo jugador: " + np.nombre + " " + np.apellido + " (" + np.cat + ")", "jugadores");
      setAddOk(true); setFormErr("");
      setNewPlayerWA({ nombre: np.nombre, apellido: np.apellido, cedula: np.cedula, tel: np.tel, repNombre: np.repNombre, repApellido: np.repApellido, repCedula: np.repCedula, repTel: np.repTel });
      setNp(NP_BLANK);
      setTimeout(() => { setAddOk(false); setShowAdd(false); }, 2000);
    }
  }

  function saveMatch() {
    if (!nm.away || !nm.date || !nm.time || !nm.field) { setFormErr("Completa todos los campos"); return; }
    if (editMid) {
      setDoc(doc(db, "matches", editMid), { ...nm });
      addNotif("Partido actualizado: " + nm.home + " vs " + nm.away, "calendario");
      setEditMid(null);
    } else {
      const id = String(Date.now());
      const m  = { ...nm, id, scoreH:null, scoreA:null, status:"próximo" };
      setDoc(doc(db, "matches", id), m);
      addNotif("Partido: " + nm.home + " vs " + nm.away + " · " + nm.cat + " · " + nm.date, "calendario");
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
        const pend = MONTHS.filter(m => !(pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid));
        if (pend.length) msg += "❌ " + p.nombre + " " + p.apellido + " (" + p.cat + "): " + pend.join(", ") + "\n";
      });
    } else if (listType === "pagados") {
      msg = "✅ RÓMULO F.C — Al Día\n" + new Date().toLocaleDateString("es") + "\n\n";
      pl.forEach(p => {
        if (MONTHS.every(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid)) {
          msg += "✅ " + p.nombre + " " + p.apellido + " (" + p.cat + ")\n";
        }
      });
    } else {
      msg = "📋 RÓMULO F.C — Estado Completo\n" + new Date().toLocaleDateString("es") + "\n\n";
      pl.forEach(p => {
        const pend = MONTHS.filter(m => !(pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid));
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
        await setDoc(doc(db, "fcm_tokens", String(coachId)), {
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
      const clean = lid.trim().toUpperCase().replace(/\s/g,"");
      const p = players.find(x => x.cedula && x.cedula.toUpperCase().replace(/\s/g,"") === clean);
      if (!p) { setLerr("Cédula no registrada"); return; }
      const u = { name: p.nombre + " " + p.apellido, playerId: p.id, cat: p.cat, perms:[] };
      setUser(u); setLoggedIn(true);
      sessionStorage.setItem("rfc_session", JSON.stringify({ role:"player", user:u }));
    } else if (role === "parent") {
      const clean = lid.trim().toUpperCase().replace(/\s/g,"");
      const p = players.find(x => x.repCedula && x.repCedula.toUpperCase().replace(/\s/g,"") === clean);
      if (!p) { setLerr("Cédula del representante no registrada"); return; }
      const u = { name: p.repNombre + " " + p.repApellido, playerId: p.id, cat: p.cat, perms:[] };
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
    const myPlayers = players.filter(p => p.cat === liveM.cat);
    return (
      <>
        <style>{CSS}</style>
        <LiveMatch
          match={liveM}
          myPlayers={myPlayers}
          sanctions={sanc}
          setSanctions={setSanc}
          minET={champs.find(c => c.id === liveM.champId)?.minET || 5}
          onClose={() => setLiveM(null)}
          onSave={r => {
            // Guardar resultado en Firebase
            const matchData = { ...liveM, scoreH:r.scoreH, scoreA:r.scoreA, status:"finalizado",
              events: r.events || [], playerStats: r.playerStats || {} };
            setDoc(doc(db,"matches",String(liveM.id)), matchData);
            // Actualizar estadísticas acumuladas por jugador
            if (r.playerStats) {
              Object.entries(r.playerStats).forEach(([pid, ps]) => {
                const ref = doc(db,"players",String(pid));
                const pl = players.find(x=>x.id===pid);
                if (!pl) return;
                const cur = pl.stats || { goles:0, asistencias:0, partidos:0 };
                setDoc(ref, { ...pl, stats: {
                  goles: (cur.goles||0) + (ps.goles||0),
                  asistencias: (cur.asistencias||0) + (ps.asistencias||0),
                  partidos: (cur.partidos||0) + 1
                }});
              });
            }
            if (r.arbitraje && r.arbitraje.jugadores) {
              const { rival, date, jugadores } = r.arbitraje;
              jugadores.forEach(({ playerId, paid, amount }) => {
                if (!pay[playerId]) return;
                const entry = { matchId: liveM.id, rival, date, paid, amount };
                const updated = { ...pay[playerId], arbitraje: [...(pay[playerId].arbitraje||[]), entry] };
                setDoc(doc(db,"pay",String(playerId)), updated);
              });
            }
            setLiveM(null);
          }}
        />
        <ConfirmDialog cfg={conf} onClose={() => setConf(null)} />
      </>
    );
  }

  // ── LOGIN ──────────────────────────────────
  if (!dbReady) {
    return (
      <div style={{ background:"#04060c", minHeight:"100vh", display:"flex", flexDirection:"column",
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
          <div className="lcard">

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
    const isVisitor = !user.playerId;
    const sp        = user.playerId ? players.find(p => p.id === user.playerId) : null;
    const spCat     = sp ? sp.cat : null;

    // Partidos: jugador/rep ven su categoría, visitante ve todos
    const spM       = spCat ? matches.filter(m => m.cat === spCat) : matches;
    const nextM     = spM.filter(m => m.status === "próximo");
    const pastM     = spM.filter(m => m.status === "finalizado");

    // Campeonatos: jugador/rep ven los de su categoría, visitante ve todos
    const spChamps  = spCat
      ? champs.filter(c => c.activo && (c.cats.length === 0 || c.cats.includes(spCat)))
      : champs.filter(c => c.activo);

    // Entrenamientos de su categoría
    const spTrains  = spCat
      ? trainings.filter(t => t.cats.includes(spCat)).sort((a,b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia))
      : [];

    // Pagos del jugador
    const spPay     = sp && pay[sp.id] ? pay[sp.id] : null;
    const pendMeses = spPay ? MONTHS.filter(m => !spPay.months[m]?.paid) : [];
    const pagMeses  = spPay ? MONTHS.filter(m => spPay.months[m]?.paid) : [];

    // Sanciones
    const spSanc    = sp && sanc[sp.id] ? sanc[sp.id] : null;

    // Tabs según rol
    const SPEC_TABS = isVisitor
      ? [["inicio","🏠","Inicio"],["campeonatos","🏆","Tabla"],["calendario","📅","Partidos"],["stats","📊","Stats"]]
      : [["inicio","🏠","Mi Perfil"],["pagos","💳","Pagos"],["campeonatos","🏆","Tabla"],["partidos","📅","Partidos"],["entrenos","🏃","Entrenos"]];

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
                <div className="sb"><div className="sn" style={{ color:"#afc4d8" }}>{totalF}</div><div className="sl">Jugados</div></div>
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
            <div className="hero">
              <div className="hero-av" style={{ background: sp.col, border: susp ? "3px solid #E53935" : "2px solid #1565C0" }}>
                {sp.foto ? <img src={sp.foto} alt="" /> : sp.nombre[0]}
              </div>
              <div className="hero-name">{sp.nombre} {sp.apellido}</div>
              <div className="hero-cat">{sp.cat} · #{sp.num} · {calcAge(sp.dob)} años</div>
              <div style={{ fontSize:8, color:"#4e6a88", marginTop:3 }}>CI: {sp.cedula || "—"}</div>
              {/* Stats rápidas */}
              <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:10 }}>
                <div style={{ textAlign:"center", background:"rgba(21,101,192,.1)", borderRadius:8, padding:"6px 14px" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#7ab3e0" }}>{attPctSp}%</div>
                  <div style={{ fontSize:7.5, color:"#4e6a88" }}>Asistencia</div>
                </div>
                <div style={{ textAlign:"center", background:"rgba(21,101,192,.1)", borderRadius:8, padding:"6px 14px" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color: spPay && MONTHS.filter(m=>!spPay.months[m]?.paid).length===0 ? "#43A047" : "#E53935" }}>
                    {spPay ? MONTHS.filter(m=>spPay.months[m]?.paid).length : 0}/{MONTHS.length}
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
                  {MONTHS.map(m => {
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
                <div className="ch"><span className="ct">🏃 Mis Entrenos</span><span className="bg bg-b">{spTrains.length} días</span></div>
                {spTrains.map(t => (
                  <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, letterSpacing:.5 }}>{t.dia}</div>
                      <div style={{ fontSize:8, color:"#4e6a88" }}>⏰ {t.hora} · 📍 {t.lugar}</div>
                      {t.notas ? <div style={{ fontSize:8, color:"#4e6a88", marginTop:2 }}>📝 {t.notas}</div> : null}
                    </div>
                    <span className="bg bg-b">{sp.cat}</span>
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
                {MONTHS.map(m => {
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

      // ── ENTRENOS (jugador/rep) ──
      if (tab === "entrenos") {
        return (
          <>
            <div className="st">🏃 Entrenamientos</div>
            {spTrains.length === 0
              ? <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:10 }}>Sin entrenamientos registrados para {spCat}</p></div>
              : spTrains.map(t => (
                <div key={t.id} className="card" style={{ marginBottom:8 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1, marginBottom:4 }}>{t.dia}</div>
                  <div style={{ display:"flex", gap:12, fontSize:10, color:"#afc4d8", marginBottom: t.notas ? 6 : 0 }}>
                    <span>⏰ {t.hora}</span>
                    <span>📍 {t.lugar}</span>
                  </div>
                  {t.notas && <div style={{ fontSize:9, color:"#4e6a88", marginTop:5, lineHeight:1.6, borderTop:"1px solid rgba(255,255,255,.04)", paddingTop:5 }}>📝 {t.notas}</div>}
                </div>
              ))
            }
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
              <div className="sb"><div className="sn" style={{ color:"#afc4d8" }}>{totalF}</div><div className="sl">Jugados</div></div>
              <div className="sb"><div className="sn" style={{ color:"#2196F3" }}>{totalP}</div><div className="sl">Próximos</div></div>
            </div>
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
                <div className="hdr-sub">{user.name} · 2026</div>
              </div>
              <div className="hdr-right">
                <span className="badge badge-b">{roleBadge}</span>
                <div className="ico-btn" onClick={logout} title="Salir">🚪</div>
              </div>
            </div>
            <div className="nav">
              {SPEC_TABS.map(([k,,l]) => (
                <button key={k} className={"nb" + (tab===k ? " ab" : "")} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
          </div>
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
    ["jugadores","👥","Jugadores"],
    ["asistencia","✅","Asistencia"],
    ["pagos","💳","Pagos"],
    ["calendario","📅","Partidos"],
    ["entrenamientos","🏃","Entrenos"],
    ["campeonatos","🏆","Campeonatos"],
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
                <div style={{ fontSize:10, fontWeight:600, color:"#afc4d8" }}>Activar notificaciones</div>
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
                  <button className="btn" style={{ flex:1, padding:8, fontSize:11 }} onClick={() => setLiveM(m)}>
                    🟢 Iniciar En Vivo
                  </button>
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
        </>
      );
    }

    // ── JUGADORES ───────────────────────────
    if (tab === "jugadores") {
      return (
        <>
          <div className="st">👥 Jugadores</div>
          <div className="dtabs">
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt" + (catF===c ? " da" : "")} onClick={() => setCatF(c)}>{c}</div>
            ))}
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
            </div>
          )}
          <div className="card">
            <div className="ch">
              <span className="ct">Lista</span>
              <span className="bg bg-b">{filtP.length}</span>
            </div>
            {filtP.map(p => {
              const y = sanc[p.id] && sanc[p.id].yellows > 0;
              const r = sanc[p.id] && sanc[p.id].suspended;
              return (
                <div key={p.id} className="pr" style={{ alignItems:"flex-start" }}>
                  <Avatar p={p} size={30} />
                  <div className="pi">
                    <div className="pn">
                      {p.nombre} {p.apellido}
                      {y && " 🟨"}{r && " 🟥"}
                    </div>
                    <div className="ps">{p.cat} · #{p.num} · {calcAge(p.dob)} años · CI: {p.cedula || "—"}</div>
                    <div className="ps">📞 {p.tel}</div>
                    <div className="ps">Rep: {p.repNombre} {p.repApellido} · CI: {p.repCedula || "—"} · {p.repTel}</div>
                    {p.notas && <div className="ps" style={{ fontStyle:"italic", color:"#d4b84a" }}>📝 {p.notas}</div>}
                    <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                      <button className="btn-wa" onClick={() => openWA(p.repTel, "Hola " + p.repNombre + ", mensaje de Rómulo FC sobre " + p.nombre + ".")}>📲 WA Rep.</button>
                      <button className="btn-sm" onClick={() => generatePermisoEscolar(p)}>📄 Permiso</button>
                      {can("jugadores") && (
                        <button className="btn-sm" style={{ background:"rgba(33,150,243,.12)", color:"#7ab3e0" }}
                          onClick={() => {
                            setEditPid(p.id);
                            setNp({ ...p, num: String(p.num) });
                            setFormErr(""); setAddOk(false);
                            setShowAdd(true);
                          }}>✏️ Editar</button>
                      )}
                      {r && can("jugadores") && (
                        <button className="btn-sm" onClick={() => setDoc(doc(db,"sanc",String(p.id)), { ...sanc[p.id], suspended:false })}>
                          Habilitar
                        </button>
                      )}
                      {can("jugadores") && (
                        <button className="btn-sm" onClick={() => setConf({
                          title:"ELIMINAR JUGADOR", danger:true, okTxt:"Eliminar",
                          msg:"¿Eliminar a " + p.nombre + " " + p.apellido + "?",
                          ok: () => {
                            deleteDoc(doc(db, "players", String(p.id)));
                            deleteDoc(doc(db, "pay",     String(p.id)));
                            deleteDoc(doc(db, "sanc",    String(p.id)));
                            deleteDoc(doc(db, "att",     String(p.id)));
                          }
                        })}>🗑 Eliminar</button>
                      )}
                    </div>
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
                <div style={{ fontSize:9, color:"#4e6a88", lineHeight:1.7, marginBottom:10 }}>
                  El archivo CSV debe tener estas columnas:<br/>
                  <span style={{ color:"#7ab3e0", fontFamily:"monospace" }}>nombre, apellido, cedula, fechaNacimiento, categoria, tel, num, repNombre, repApellido, repCedula, repTel</span><br/>
                  Separadas por coma o punto y coma. La primera fila es el encabezado.
                </div>
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
      // Filtrar entrenamientos según categoría del entrenador
      const myTrains = trainings
        .filter(t => user.cat === "Todas" || t.cats.includes(user.cat))
        .sort((a,b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia));

      const selTrain = attSession ? trainings.find(t => t.id === attSession) : null;

      // Jugadores del entrenamiento seleccionado
      const trainPlayers = selTrain
        ? filtP.filter(p => selTrain.cats.includes(p.cat))
        : [];

      const sesCount = selTrain
        ? trainPlayers.filter(p => att[p.id] && att[p.id][attSession] && att[p.id][attSession].present).length
        : 0;
      const sesPct = trainPlayers.length ? Math.round(sesCount / trainPlayers.length * 100) : 0;

      return (
        <>
          <div className="st">✅ Asistencia</div>

          {/* Selector de entrenamiento */}
          <div className="card" style={{ marginBottom:8 }}>
            <div className="ch"><span className="ct">Seleccionar Entrenamiento</span></div>
            {myTrains.length === 0 && (
              <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"8px 0" }}>
                No hay entrenamientos registrados. Agrégalos en el módulo Entrenos.
              </p>
            )}
            {myTrains.map(t => {
              const isActive = attSession === t.id;
              const sesPlayers = filtP.filter(p => t.cats.includes(p.cat));
              const sesPresent = sesPlayers.filter(p => att[p.id] && att[p.id][t.id] && att[p.id][t.id].present).length;
              return (
                <div key={t.id}
                  onClick={() => setAttSession(isActive ? null : t.id)}
                  style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"9px 10px", marginBottom:5, borderRadius:9, cursor:"pointer",
                    background: isActive ? "rgba(21,101,192,.1)" : "#090d1a",
                    border: isActive ? "1px solid rgba(33,150,243,.3)" : "1px solid rgba(33,150,243,.07)" }}>
                  <div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:.5,
                      color: isActive ? "#7ab3e0" : "#afc4d8" }}>{t.dia}</div>
                    <div style={{ fontSize:8, color:"#4e6a88", marginTop:1 }}>
                      ⏰ {t.hora} · 📍 {t.lugar}
                    </div>
                    <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                      {t.cats.map(c => <span key={c} className="bg bg-b">{c}</span>)}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {sesPresent > 0 && (
                      <div style={{ fontSize:10, fontWeight:600, color:"#7ab3e0" }}>{sesPresent}/{sesPlayers.length}</div>
                    )}
                    <span className={"bg " + (isActive ? "bg-b" : "bg-n")} style={{ fontSize:8 }}>
                      {isActive ? "▼ Activo" : "▸ Pasar lista"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Lista de asistencia del entrenamiento seleccionado */}
          {selTrain && (
            <>
              <div className="card">
                <div className="ch">
                  <span className="ct">{selTrain.dia} · {selTrain.hora}</span>
                  <span className={"bg " + (sesPct >= 70 ? "bg-b" : "bg-r")}>{sesPct}%</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#4e6a88", marginBottom:5 }}>
                  <span>Presentes: {sesCount}</span>
                  <span>Total: {trainPlayers.length}</span>
                </div>
                <div className="pb" style={{ marginBottom:10 }}>
                  <div className={"pf " + (sesPct >= 70 ? "pf-b" : "pf-r")} style={{ width: sesPct + "%" }} />
                </div>
                {trainPlayers.length === 0 && (
                  <p style={{ fontSize:9, color:"#4e6a88", textAlign:"center" }}>Sin jugadores en esta categoría</p>
                )}
                {trainPlayers.map(p => {
                  const present = att[p.id] && att[p.id][attSession] && att[p.id][attSession].present;
                  return (
                    <div key={p.id} className="pr">
                      <Avatar p={p} />
                      <div className="pi">
                        <div className="pn">{p.nombre} {p.apellido}</div>
                        <div className="ps">#{p.num} · {p.cat}</div>
                      </div>
                      <button className={"ck" + (present ? " on" : "")} onClick={() => toggleAtt(p.id)}>
                        {present ? "✓" : ""}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Historial de asistencia del jugador */}
              <div className="card">
                <div className="ch"><span className="ct">Historial General</span></div>
                {trainPlayers.map(p => {
                  const sesiones = myTrains.filter(t => t.cats.includes(p.cat));
                  const total    = sesiones.length;
                  const asistio  = sesiones.filter(t => att[p.id] && att[p.id][t.id] && att[p.id][t.id].present).length;
                  const pct      = total ? Math.round(asistio / total * 100) : 0;
                  return (
                    <div key={p.id} style={{ marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginBottom:3 }}>
                        <span style={{ fontWeight:500 }}>{p.nombre} {p.apellido}</span>
                        <span style={{ color: pct>=70 ? "#7ab3e0" : "#e8a0a0" }}>{asistio}/{total} · {pct}%</span>
                      </div>
                      <div className="pb">
                        <div className={"pf " + (pct>=70 ? "pf-b" : "pf-r")} style={{ width: pct + "%" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
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
          </div>

          {payTab === "mensualidades" && filtP.map(p => {
            const paid = MONTHS.filter(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid).length;
            const pend = MONTHS.filter(m => !(pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid));
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
                    const ok  = pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid;
                    const ref = pay[p.id]?.months[m]?.ref;
                    return (
                      <div key={m} className={"mcell " + (ok ? "mp" : "mup")}
                        onClick={() => toggleMonth(p.id, m)}
                        title={ok && ref ? "Ref: " + ref : ok ? "Pagado" : "Pendiente"}>
                        <div className="mclbl">{m}</div>
                        <div className="mcico">{ok ? "✅" : "❌"}</div>
                        {ok && ref && <div style={{ fontSize:6, color:"#7ab3e0", marginTop:1,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                          maxWidth:"100%", lineHeight:1.2 }}>#{ref.slice(-6)}</div>}
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
                  Los pagos se registran automáticamente desde el módulo <strong style={{ color:"#afc4d8" }}>En Vivo</strong> al finalizar cada partido.
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
                <div style={{ background:"#0c1220", borderRadius:8, padding:"8px 10px", fontSize:9, color:"#8fa8c8", lineHeight:1.6, maxHeight:180, overflowY:"auto", marginBottom:10, whiteSpace:"pre-wrap" }}>
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
          <div className="dtabs">
            {["Todas",...CATS].map(c => (
              <div key={c} className={"dt" + (catF===c ? " da" : "")} onClick={() => setCatF(c)}>{c}</div>
            ))}
          </div>
          {can("calendario") && (
            <button className="btn" style={{ marginBottom:9 }} onClick={() => { setShowMForm(true); setFormErr(""); }}>
              + Agregar Partido
            </button>
          )}
          {filtM.map(m => (
            <div key={m.id}>
              <MatchCard m={m} champs={champs} />
              <div style={{ display:"flex", gap:6, marginBottom:9 }}>
                {can("partido") && m.status === "próximo" && (
                  <button className="btn" style={{ flex:1, padding:8, fontSize:11 }} onClick={() => setLiveM(m)}>
                    🟢 En Vivo
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
                  <select className="inp" value={nm.champId} onChange={e => setNm(n => ({ ...n, champId: e.target.value ? parseInt(e.target.value) : "" }))}>
                    <option value="">— Sin campeonato —</option>
                    {champs.filter(c => c.activo).map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}{c.cats.length ? " (" + c.cats.join(", ") + ")" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="inp-wrap" style={{ marginTop:6 }}>
                  <div className="inp-lbl">Fase del partido</div>
                  <select className="inp" value={nm.fase} onChange={e => setNm(n => ({ ...n, fase: e.target.value }))}>
                    <option value="Normal">⚽ Normal (fase de grupos)</option>
                    <option value="Octavos">⚔️ Octavos de final</option>
                    <option value="Cuartos">⚔️ Cuartos de final</option>
                    <option value="Semifinal">🏆 Semifinal</option>
                    <option value="Final">🥇 Final</option>
                  </select>
                </div>
                <button className="btn" style={{ marginTop:4 }} onClick={saveMatch}>{editMid ? "💾 GUARDAR CAMBIOS" : "GUARDAR PARTIDO"}</button>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── STATS ───────────────────────────────
    if (tab === "stats") {
      const total     = players.length;
      const alDia     = players.filter(p => MONTHS.every(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid)).length;
      const yellow    = players.reduce((a,p) => a + ((sanc[p.id] && sanc[p.id].yellows) || 0), 0);
      const filtStat = statCat === "Todas" ? players : players.filter(p=>p.cat===statCat);

      const goleadores = [...filtStat]
        .filter(p => (p.stats?.goles||0) > 0)
        .sort((a,b) => (b.stats?.goles||0) - (a.stats?.goles||0))
        .slice(0,10);
      const asistidores = [...filtStat]
        .filter(p => (p.stats?.asistencias||0) > 0)
        .sort((a,b) => (b.stats?.asistencias||0) - (a.stats?.asistencias||0))
        .slice(0,10);
      const tarjetados = [...filtStat]
        .filter(p => (sanc[p.id]?.yellows||0) > 0 || (sanc[p.id]?.reds||0) > 0)
        .sort((a,b) => (sanc[b.id]?.yellows||0) - (sanc[a.id]?.yellows||0))
        .slice(0,10);
      const masPartidos = [...filtStat]
        .filter(p => (p.stats?.partidos||0) > 0)
        .sort((a,b) => (b.stats?.partidos||0) - (a.stats?.partidos||0))
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
            {[["goleadores","⚽ Goles"],["asistidores","🎯 Asist."],["tarjetados","🟨 Tarjetas"],["partidos","🏟️ Partidos"]].map(([k,l]) => (
              <button key={k} className={"btn-sm"+(statView===k?" ":" ")} style={{ background: statView===k ? "rgba(33,150,243,.25)" : "rgba(33,150,243,.07)", color: statView===k ? "#7ab3e0" : "#4e6a88", borderColor: statView===k ? "rgba(33,150,243,.4)" : "rgba(33,150,243,.1)" }}
                onClick={()=>setStatView(k)}>{l}</button>
            ))}
          </div>
          {/* Tabla de ranking */}
          <div className="card">
            <div className="ch">
              <span className="ct">
                {statView==="goleadores"?"⚽ Tabla de Goleadores":statView==="asistidores"?"🎯 Tabla de Asistencias":statView==="tarjetados"?"🟨 Tarjetas":"🏟️ Partidos Jugados"}
              </span>
              <span className="bg bg-b">{statCat}</span>
            </div>
            {(() => {
              const lista = statView==="goleadores" ? goleadores : statView==="asistidores" ? asistidores : statView==="tarjetados" ? tarjetados : masPartidos;
              if (lista.length === 0) return <div style={{ fontSize:9, color:"#3a5068", textAlign:"center", padding:"16px 0" }}>Sin datos registrados aún</div>;
              return lista.map((p,i) => {
                const valor = statView==="goleadores" ? (p.stats?.goles||0)
                  : statView==="asistidores" ? (p.stats?.asistencias||0)
                  : statView==="tarjetados" ? `🟨${sanc[p.id]?.yellows||0} 🟥${sanc[p.id]?.reds||0}`
                  : (p.stats?.partidos||0);
                const max = statView==="goleadores" ? (goleadores[0]?.stats?.goles||1)
                  : statView==="asistidores" ? (asistidores[0]?.stats?.asistencias||1)
                  : statView==="tarjetados" ? (sanc[tarjetados[0]?.id]?.yellows||1)
                  : (masPartidos[0]?.stats?.partidos||1);
                const pct = statView==="tarjetados" ? Math.round((sanc[p.id]?.yellows||0)/max*100)
                  : statView==="goleadores" ? Math.round((p.stats?.goles||0)/max*100)
                  : statView==="asistidores" ? Math.round((p.stats?.asistencias||0)/max*100)
                  : Math.round((p.stats?.partidos||0)/max*100);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <div style={{ width:18, textAlign:"center", fontSize:9, color: i===0?"#d4b84a":i===1?"#afc4d8":i===2?"#c48a5a":"#3a5068", fontWeight:600 }}>
                      {i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`}
                    </div>
                    <Avatar p={p} size={26} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:10, fontWeight:500 }}>{p.nombre} {p.apellido}</div>
                      <div style={{ fontSize:8, color:"#3a5068" }}>{p.cat} · #{p.num}</div>
                      <div className="pb" style={{ marginTop:3 }}>
                        <div className="pf pf-b" style={{ width:pct+"%" }} />
                      </div>
                    </div>
                    <div style={{ fontSize:16, fontWeight:600, color:"#7ab3e0", minWidth:24, textAlign:"right" }}>{valor}</div>
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
              const ok  = cp.filter(p => MONTHS.every(m => pay[p.id] && pay[p.id].months[m] && pay[p.id].months[m].paid)).length;
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
          setDoc(doc(db, "coaches", String(editCoachId)), { ...nc2, id: String(editCoachId) });
          // Si el entrenador editado es el usuario actual, actualizamos la sesión
          if (user?.id === editCoachId) setUser(u => ({ ...u, ...nc2 }));
        } else {
          const id = String(Date.now());
          setDoc(doc(db, "coaches", id), { ...nc2, id });
        }
        setNc2(COACH_BLANK); setEditCoachId(null); setShowCoachForm(false); setCoachErr("");
      }

      function deleteCoach(c) {
        if (c.perms?.includes("entrenadores")) {
          setCoachErr("No puedes eliminar al Director Técnico"); return;
        }
        setConf({ title:"ELIMINAR ENTRENADOR", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar a " + c.name + "? Esta acción no se puede deshacer.",
          ok: () => deleteDoc(doc(db, "coaches", String(c.id)))
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
      function saveTrain() {
        if (!nt.hora || !nt.lugar || nt.cats.length === 0) { setFormErr("Hora, lugar y categoría son obligatorios"); return; }
        if (editTrain) {
          setDoc(doc(db, "trainings", String(editTrain)), { ...nt, id: String(editTrain) });
          setEditTrain(null);
        } else {
          const id = String(Date.now());
          setDoc(doc(db, "trainings", id), { ...nt, id });
        }
        setNt({ dia:"Lunes", hora:"", lugar:"", cats:[], notas:"" });
        setShowTForm(false); setFormErr("");
      }
      function deleteTrain(id) {
        setConf({ title:"ELIMINAR ENTRENO", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar este día de entrenamiento?",
          ok: () => deleteDoc(doc(db, "trainings", String(id)))
        });
      }
      function startEdit(t) {
        setNt({ dia:t.dia, hora:t.hora, lugar:t.lugar, cats:[...t.cats], notas:t.notas||"" });
        setEditTrain(t.id); setShowTForm(true); setFormErr("");
      }
      const ordered = [...trainings].sort((a,b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia));
      return (
        <>
          <div className="st">🏃 Entrenamientos</div>
          {can("jugadores") && (
            <button className="btn" style={{ marginBottom:9 }} onClick={() => { setShowTForm(true); setEditTrain(null); setNt({ dia:"Lunes", hora:"", lugar:"", cats:[], notas:"" }); setFormErr(""); }}>
              + Agregar Día
            </button>
          )}
          {ordered.length === 0 && (
            <div className="card"><p style={{ fontSize:9, color:"#4e6a88", textAlign:"center", padding:"10px 0" }}>Sin entrenamientos registrados</p></div>
          )}
          {ordered.map(t => (
            <div key={t.id} className="card" style={{ marginBottom:8 }}>
              <div className="ch" style={{ marginBottom:6 }}>
                <div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1, color:"#afc4d8" }}>{t.dia}</div>
                  <div style={{ fontSize:9, color:"#4e6a88", marginTop:1 }}>⏰ {t.hora} · 📍 {t.lugar}</div>
                </div>
                {can("jugadores") && (
                  <div style={{ display:"flex", gap:5 }}>
                    <button className="btn-sm" onClick={() => startEdit(t)}>✏️ Editar</button>
                    <button className="btn-sm" style={{ color:"#e8a0a0" }} onClick={() => deleteTrain(t.id)}>🗑</button>
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom: t.notas ? 6 : 0 }}>
                {t.cats.map(c => <span key={c} className="bg bg-b">{c}</span>)}
              </div>
              {t.notas ? <div style={{ fontSize:8.5, color:"#4e6a88", marginTop:5, lineHeight:1.5, borderTop:"1px solid rgba(255,255,255,.03)", paddingTop:5 }}>📝 {t.notas}</div> : null}
            </div>
          ))}

          {showTForm && (
            <div className="ov" onClick={e => { if (e.target.className==="ov") { setShowTForm(false); setEditTrain(null); } }}>
              <div className="modal">
                <div className="mt2">{editTrain ? "Editar Entrenamiento" : "Nuevo Entrenamiento"} <span className="mx" onClick={() => { setShowTForm(false); setEditTrain(null); }}>✕</span></div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Día de la semana *</div>
                  <select className="inp" value={nt.dia} onChange={e => setNt(n => ({ ...n, dia:e.target.value }))}>
                    {DIAS_SEMANA.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="inp-2">
                  <div className="inp-wrap">
                    <div className="inp-lbl">Hora *</div>
                    <input className="inp" type="time" value={nt.hora} onChange={e => setNt(n => ({ ...n, hora:e.target.value }))} />
                  </div>
                  <div className="inp-wrap">
                    <div className="inp-lbl">Lugar *</div>
                    <input className="inp" placeholder="Campo A" value={nt.lugar} onChange={e => setNt(n => ({ ...n, lugar:e.target.value }))} />
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Categorías * (selecciona una o varias)</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:3 }}>
                    {CATS.map(c => {
                      const sel = nt.cats.includes(c);
                      return (
                        <div key={c} className={"dt" + (sel ? " da" : "")} style={{ cursor:"pointer" }}
                          onClick={() => setNt(n => ({ ...n, cats: sel ? n.cats.filter(x=>x!==c) : [...n.cats, c] }))}>
                          {c}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="inp-wrap">
                  <div className="inp-lbl">Notas (opcional)</div>
                  <input className="inp" placeholder="Ej: Traer peto, trabajo físico..." value={nt.notas} onChange={e => setNt(n => ({ ...n, notas:e.target.value }))} />
                </div>
                {formErr && <div className="err">⚠️ {formErr}</div>}
                <button className="btn" style={{ marginTop:6 }} onClick={saveTrain}>{editTrain ? "GUARDAR CAMBIOS" : "AGREGAR ENTRENAMIENTO"}</button>
              </div>
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
        setDoc(doc(db, "champs", id), { ...nc, id, nombre: nc.nombre.trim(), standings:[], fase:"grupos", llaves:[] });
        setNc({ nombre:"", cats:[], activo:true, link:"", minET:5 });
        setShowCForm(false); setFormErr("");
        addNotif("Nuevo campeonato: " + nc.nombre.trim(), "champs");
      }
      function toggleChampActive(id) {
        const ch = champs.find(c => c.id === id);
        if (ch) setDoc(doc(db, "champs", String(id)), { ...ch, activo: !ch.activo });
      }
      function deleteChamp(id) {
        setConf({ title:"ELIMINAR CAMPEONATO", danger:true, okTxt:"Eliminar",
          msg:"¿Eliminar este campeonato? Se perderán los datos.",
          ok: () => { deleteDoc(doc(db, "champs", String(id))); if (expandChamp===id) setExpandChamp(null); }
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
        setDoc(doc(db, "champs", String(champId)), { ...ch, standings });
        setNsRow({ equipo:"", pj:0, g:0, e:0, p:0, gf:0, gc:0 });
        setEditStanding(null);
      }
      function deleteRow(champId, equipo) {
        const ch = champs.find(c => c.id === champId);
        if (!ch) return;
        setDoc(doc(db, "champs", String(champId)), { ...ch, standings: ch.standings.filter(r => r.equipo !== equipo) });
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
        setDoc(doc(db, "champs", String(ch.id)), { ...ch, fase:"eliminatoria", rondaActual: rondaInicio, llaves });
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
        setDoc(doc(db, "champs", String(ch.id)), {
          ...ch, rondaActual: siguienteRonda,
          llaves: [...llavesAnt, ...nuevasLlaves]
        });
      }

      function saveLlave(ch, llave) {
        const llaves = (ch.llaves || []).map(l => l.id === llave.id ? llave : l);
        setDoc(doc(db, "champs", String(ch.id)), { ...ch, llaves });
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
                          <div style={{ background:"#090d1a", borderRadius:9, padding:"10px", border:"1px solid rgba(33,150,243,.08)", marginBottom:9 }}>
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
                                <div key={ll.id} style={{ background:"#090d1a", borderRadius:9, padding:"10px", border:"1px solid rgba(33,150,243,.1)" }}>
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
                                        <div style={{ fontSize:11, color:"#afc4d8", fontWeight:600, padding:"6px 0" }}>{ll.local || "Por definir"}</div>
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
                                        <div style={{ fontSize:11, color:"#afc4d8", fontWeight:600, padding:"6px 0", textAlign:"right" }}>{ll.visitante || "Por definir"}</div>
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
      return (
        <>
          <div className="st">⚙️ Configuración</div>

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
                      <button className="btn-sm" style={{ color:"#7ab3e0" }} onClick={() => { setDoc(doc(db,"config","club"), cfgDraft); setEditConfig(false); }}>✅ Guardar</button>
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
                {MONTHS.map(m => {
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
              Conectado como <strong style={{ color:"#afc4d8" }}>{user.name}</strong> · {user.role}
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
              <div style={{ display:"flex", alignItems:"center", gap:9, background:"#090d1a",
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
                  <div style={{ fontSize:9, fontWeight:600, color:"#afc4d8", marginTop:3 }}>{user?.name}</div>
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

              <div style={{ display:"flex", gap:7, marginTop:8 }}>
                <button className="btn" style={{ flex:1 }} onClick={confirmPayMonth}>
                  ✅ CONFIRMAR Y GENERAR PDF
                </button>
                <button className="btn-sm" style={{ padding:"10px 14px" }}
                  onClick={() => setPayModal(null)}>Cancelar</button>
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
        <div className="modal-overlay" onClick={() => setConfirmDelM(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:6 }}>🗑️</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#ef9a9a", marginBottom:4 }}>
              Eliminar Partido
            </div>
            <div style={{ fontSize:10, color:"#afc4d8", marginBottom:4 }}>
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
                  deleteDoc(doc(db, "matches", confirmDelM.id));
                  addNotif("Partido eliminado: " + confirmDelM.home + " vs " + confirmDelM.away, "calendario");
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
        <div className="modal-overlay" onClick={() => setNewPlayerWA(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:4 }}>✅</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#7ab3e0", marginBottom:2 }}>
              Jugador registrado
            </div>
            <div style={{ fontSize:11, color:"#4e6a88", marginBottom:14 }}>
              {newPlayerWA.nombre} {newPlayerWA.apellido}
            </div>
            <div style={{ fontSize:10, color:"#afc4d8", marginBottom:10 }}>
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
