const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// ─── HELPER: resolver tokens según destinatario y preferencias ───────────────
// para:      "all" | "admins" | "cat:Sub-17A" | "player:123" | "convocados:1,2;cat:X"
// catOrigen: categoría del evento (para filtrar notifsDesact del usuario)
async function resolveTokens(para, catOrigen = null) {
  const col = db.collection("fcm_tokens");

  // Función para filtrar un doc según sus preferencias
  function puedeRecibir(data) {
    if (!data.token) return false;
    // Admins/entrenadores siempre reciben todo
    if (data.role === "admin" || data.role === "entrenador") return true;
    // Si hay catOrigen y el usuario tiene esa cat desactivada → no enviar
    if (catOrigen && Array.isArray(data.notifsDesact) && data.notifsDesact.includes(catOrigen)) {
      // Excepción: si es su propia categoría, siempre recibe
      if (data.cat !== catOrigen) return false;
    }
    return true;
  }

  if (!para || para === "all") {
    const snap = await col.get();
    return snap.docs.map(d => d.data()).filter(puedeRecibir).map(d => d.token);
  }

  if (para === "admins") {
    const snap = await col.where("role","in",["admin","entrenador"]).get();
    return snap.docs.map(d => d.data().token).filter(Boolean);
  }

  if (para.startsWith("cat:")) {
    const cat = para.replace("cat:","");
    const [adminSnap, catSnap] = await Promise.all([
      col.where("role","in",["admin","entrenador"]).get(),
      col.where("cat","==",cat).get()
    ]);
    const tokens = new Set();
    adminSnap.docs.forEach(d => { if(d.data().token) tokens.add(d.data().token); });
    catSnap.docs.forEach(d => { if(puedeRecibir(d.data())) tokens.add(d.data().token); });
    return [...tokens];
  }

  if (para.startsWith("player:")) {
    const pid = para.replace("player:","");
    const [adminSnap, playerSnap] = await Promise.all([
      col.where("role","in",["admin","entrenador"]).get(),
      col.where("playerId","==",pid).get()
    ]);
    const tokens = new Set();
    adminSnap.docs.forEach(d => { if(d.data().token) tokens.add(d.data().token); });
    // Pago propio: siempre llega aunque haya desactivado la cat
    playerSnap.docs.forEach(d => { if(d.data().token) tokens.add(d.data().token); });
    return [...tokens];
  }

  // Formato LiveMatch: "convocados:1,2,3;cat:Sub-17A"
  if (para.startsWith("convocados:")) {
    const parts    = para.split(";");
    const convPart = parts[0].replace("convocados:","");
    const catPart  = (parts[1]||"").replace("cat:","");
    const convIds  = convPart.split(",").map(s=>s.trim()).filter(Boolean);

    const adminSnap = await col.where("role","in",["admin","entrenador"]).get();
    const tokens = new Set();
    adminSnap.docs.forEach(d => { if(d.data().token) tokens.add(d.data().token); });

    for (const pid of convIds) {
      const pSnap = await col.where("playerId","==",pid).get();
      // Convocados siempre reciben eventos de su partido
      pSnap.docs.forEach(d => { if(d.data().token) tokens.add(d.data().token); });
    }

    if (catPart) {
      const cSnap = await col.where("cat","==",catPart).get();
      cSnap.docs.forEach(d => { if(puedeRecibir(d.data())) tokens.add(d.data().token); });
    }

    return [...tokens];
  }

  // Fallback: todos respetando preferencias
  const snap = await col.get();
  return snap.docs.map(d => d.data()).filter(d => puedeRecibir(d)).map(d => d.token);
}

// ─── HELPER: enviar FCM a lista de tokens ────────────────────────────────────
async function sendTokens(tokens, title, body, link = "inicio") {
  if (!tokens.length) return;
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i+500));

  const toDelete = [];
  for (const chunk of chunks) {
    try {
      const res = await fcm.sendEachForMulticast({
        notification: { title, body },
        data: { link },
        tokens: chunk,
        android: { notification: { sound:"default", channelId:"romulo_fc", priority:"high" } },
        apns:    { payload: { aps: { sound:"default", badge:1 } } },
        webpush: {
          notification: {
            icon:"/icons/icon-192.png",
            badge:"/icons/icon-192.png",
            vibrate:[200,100,200],
            requireInteraction: false
          },
          fcmOptions: { link: "https://romulo-fc.pages.dev/" + link }
        }
      });
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code;
          if (code==="messaging/registration-token-not-registered" ||
              code==="messaging/invalid-registration-token") {
            toDelete.push(chunk[i]);
          }
        }
      });
      console.log(`FCM: ${res.successCount} ok, ${res.failureCount} fallidos`);
    } catch(e) {
      console.error("sendTokens error:", e);
    }
  }

  // Limpiar tokens inválidos
  for (const token of toDelete) {
    const q = await db.collection("fcm_tokens").where("token","==",token).get();
    q.forEach(d => d.ref.delete());
  }
}

// ─── HELPER: parsear fecha "21 Mar 2026" o ISO "2026-03-21" ─────────────────
function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + "T12:00:00");
  const MESES = {Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11};
  const parts = str.trim().split(/\s+/);
  if (parts.length >= 2) {
    const dd = parseInt(parts[0]), mm = MESES[parts[1]];
    const yy = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
    if (!isNaN(dd) && mm !== undefined) return new Date(yy, mm, dd, 12, 0, 0);
  }
  return null;
}

// ─── TRIGGER: procesar cola push_queue ───────────────────────────────────────
exports.processPushQueue = onDocumentCreated("push_queue/{id}", async (event) => {
  const data = event.data?.data();
  if (!data || data.processed) return;
  const { title, body, link, para, catOrigen } = data;
  try {
    const tokens = await resolveTokens(para, catOrigen || null);
    if (tokens.length) await sendTokens(tokens, title, body, link);
    await event.data.ref.update({ processed:true, processedAt:new Date().toISOString() });
  } catch(e) {
    console.error("processPushQueue error:", e);
    await event.data.ref.update({ error: String(e) });
  }
});

// ─── TRIGGER: nuevo partido ───────────────────────────────────────────────────
exports.onNuevoPartido = onDocumentCreated("matches/{id}", async (event) => {
  const m = event.data?.data();
  if (!m || m.status !== "próximo") return;
  const tokens = await resolveTokens("cat:" + m.cat);
  await sendTokens(tokens,
    "📅 Nuevo Partido",
    `${m.home} vs ${m.away} · ${m.date} ${m.time||""}`,
    "calendario"
  );
});

// ─── TRIGGER: partido modificado o finalizado ─────────────────────────────────
exports.onPartidoActualizado = onDocumentUpdated("matches/{id}", async (event) => {
  const before = event.data?.before?.data();
  const after  = event.data?.after?.data();
  if (!before || !after) return;

  // Finalizado
  if (before.status !== "finalizado" && after.status === "finalizado") {
    const gH = after.scoreH ?? 0, gA = after.scoreA ?? 0;
    const esCasa = (after.home||"").includes("Rómulo");
    const gRFC = esCasa ? gH : gA, gRiv = esCasa ? gA : gH;
    const res = gRFC > gRiv ? "VICTORIA" : gRFC < gRiv ? "DERROTA" : "EMPATE";
    const emoj = res==="VICTORIA"?"🏆":res==="DERROTA"?"😔":"🤝";
    const tokens = await resolveTokens("cat:" + after.cat);
    await sendTokens(tokens,
      `${emoj} Resultado: ${res}`,
      `${after.home} ${gH}-${gA} ${after.away}`,
      "calendario"
    );
    return;
  }

  // Reprogramado (cambió fecha u hora)
  if (before.status === "próximo" && after.status === "próximo" &&
      (before.date !== after.date || before.time !== after.time)) {
    const tokens = await resolveTokens("cat:" + after.cat);
    await sendTokens(tokens,
      "🔄 Partido Reprogramado",
      `${after.home} vs ${after.away} · ${after.date} ${after.time||""}`,
      "calendario"
    );
  }
});

// ─── TRIGGER: nuevo entrenamiento ─────────────────────────────────────────────
exports.onNuevoEntreno = onDocumentCreated("trainings/{id}", async (event) => {
  const t = event.data?.data();
  if (!t) return;
  const cats = t.cats || [];
  if (!cats.length) return;
  const para = cats.length === 1 ? "cat:" + cats[0] : "all";
  const tokens = await resolveTokens(para);
  const fechaLeg = t.fecha ? new Date(t.fecha+"T12:00:00").toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}) : t.fecha;
  await sendTokens(tokens,
    "🏃 Nuevo Entrenamiento",
    `${t.tema||"Entrenamiento"} · ${fechaLeg} ${t.hora||""} · ${t.lugar||""}`,
    "entrenos"
  );
});

// ─── TRIGGER: entrenamiento modificado ────────────────────────────────────────
exports.onEntrenoActualizado = onDocumentUpdated("trainings/{id}", async (event) => {
  const before = event.data?.before?.data();
  const after  = event.data?.after?.data();
  if (!before || !after) return;
  if (before.fecha === after.fecha && before.hora === after.hora && before.lugar === after.lugar) return;
  const cats = after.cats || [];
  const para = cats.length === 1 ? "cat:" + cats[0] : "all";
  const tokens = await resolveTokens(para);
  const fechaLeg = after.fecha ? new Date(after.fecha+"T12:00:00").toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"}) : after.fecha;
  await sendTokens(tokens,
    "🔄 Entrenamiento Modificado",
    `${after.tema||"Entrenamiento"} · ${fechaLeg} ${after.hora||""} · ${after.lugar||""}`,
    "entrenos"
  );
});

// ─── TRIGGER: pago registrado ─────────────────────────────────────────────────
exports.onPagoRegistrado = onDocumentUpdated("pay/{pid}", async (event) => {
  const before = event.data?.before?.data();
  const after  = event.data?.after?.data();
  if (!before || !after) return;
  const months = after.months || {}, prevM = before.months || {};
  const mesPagado = Object.keys(months).find(m => months[m]?.paid && !prevM[m]?.paid);
  if (!mesPagado) return;
  const playerDoc = await db.collection("players").doc(event.params.pid).get();
  const player = playerDoc.data();
  if (!player) return;
  const tokens = await resolveTokens("player:" + event.params.pid);
  await sendTokens(tokens,
    "✅ Pago Confirmado",
    `${player.nombre} ${player.apellido} — ${mesPagado} registrado`,
    "pagos"
  );
});

// ─── TRIGGER: nueva notificación del club ─────────────────────────────────────
exports.onNuevaNotif = onDocumentCreated("notifs/{id}", async (event) => {
  const n = event.data?.data();
  if (!n || n.tipo === "sistema" || n.live) return; // no push para notifs internas ni live
  const tokens = await resolveTokens(n.para || "all");
  if (!tokens.length) return;
  await sendTokens(tokens, "🔔 Rómulo FC", n.txt, n.link || "inicio");
});

// ─── SCHEDULE: recordatorios 24h y 1h antes de partidos ─────────────────────
exports.recordatoriosPartidos = onSchedule("every 30 minutes", async () => {
  const now  = new Date();
  const snap = await db.collection("matches").where("status","==","próximo").get();

  for (const doc of snap.docs) {
    const m = doc.data();
    const fd = parseDate(m.date);
    if (!fd) continue;

    // Combinar fecha + hora
    if (m.time) {
      const [hh, mm] = m.time.split(":").map(Number);
      fd.setHours(hh || 0, mm || 0, 0, 0);
    }

    const diffMs  = fd - now;
    const diffMin = diffMs / 60000;

    // Ventana de 30 min para no enviar doble
    const ya24h = m.notif24h;
    const ya1h  = m.notif1h;

    if (!ya24h && diffMin > 0 && diffMin <= 1440 + 15 && diffMin >= 1440 - 15) {
      const tokens = await resolveTokens("cat:" + m.cat);
      await sendTokens(tokens,
        "⏰ Partido Mañana",
        `${m.home} vs ${m.away} · ${m.date} ${m.time||""} · ${m.field||""}`,
        "calendario"
      );
      await doc.ref.update({ notif24h: true });
    }

    if (!ya1h && diffMin > 0 && diffMin <= 60 + 15 && diffMin >= 60 - 15) {
      const tokens = await resolveTokens("cat:" + m.cat);
      await sendTokens(tokens,
        "🔔 Partido en 1 Hora",
        `${m.home} vs ${m.away} · ${m.time||""} · ${m.field||""}`,
        "calendario"
      );
      await doc.ref.update({ notif1h: true });
    }
  }
});

// ─── SCHEDULE: recordatorios 24h y 1h antes de entrenamientos ───────────────
exports.recordatoriosEntrenos = onSchedule("every 30 minutes", async () => {
  const now   = new Date();
  const hoyISO = now.toISOString().slice(0,10);
  const snap  = await db.collection("trainings")
    .where("fecha", ">=", hoyISO).get();

  for (const doc of snap.docs) {
    const t = doc.data();
    const fd = t.fecha ? new Date(t.fecha + "T12:00:00") : null;
    if (!fd) continue;

    if (t.hora) {
      const [hh, mm] = t.hora.split(":").map(Number);
      fd.setHours(hh||0, mm||0, 0, 0);
    }

    const diffMs  = fd - now;
    const diffMin = diffMs / 60000;
    const cats    = t.cats || [];
    const para    = cats.length === 1 ? "cat:" + cats[0] : "all";

    if (!t.notif24h && diffMin > 0 && diffMin <= 1440+15 && diffMin >= 1440-15) {
      const tokens = await resolveTokens(para);
      await sendTokens(tokens,
        "⏰ Entrenamiento Mañana",
        `${t.tema||"Entrenamiento"} · ${t.hora||""} · ${t.lugar||""}`,
        "entrenos"
      );
      await doc.ref.update({ notif24h: true });
    }

    if (!t.notif1h && diffMin > 0 && diffMin <= 60+15 && diffMin >= 60-15) {
      const tokens = await resolveTokens(para);
      await sendTokens(tokens,
        "🔔 Entrenamiento en 1 Hora",
        `${t.tema||"Entrenamiento"} · ${t.hora||""} · ${t.lugar||""}`,
        "entrenos"
      );
      await doc.ref.update({ notif1h: true });
    }
  }
});

// ─── SCHEDULE: limpieza semanal ───────────────────────────────────────────────
exports.limpieza = onSchedule("every week", async () => {
  // Tokens viejos (>30 días sin actualizar)
  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 30);
  const tokSnap = await db.collection("fcm_tokens")
    .where("updatedAt","<",hace30.toISOString()).get();
  const batch1 = db.batch();
  tokSnap.docs.forEach(d => batch1.delete(d.ref));
  await batch1.commit();

  // Cola procesada
  const qSnap = await db.collection("push_queue")
    .where("processed","==",true).get();
  const batch2 = db.batch();
  qSnap.docs.forEach(d => batch2.delete(d.ref));
  await batch2.commit();

  console.log(`Limpieza: ${tokSnap.size} tokens, ${qSnap.size} queue items eliminados`);
});
