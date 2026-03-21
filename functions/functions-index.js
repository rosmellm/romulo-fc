const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore }  = require("firebase-admin/firestore");
const { getMessaging }  = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// ─── HELPER: enviar FCM a todos los tokens registrados ───────────────────────
async function sendToAll(title, body, link = null) {
  try {
    const snap = await db.collection("fcm_tokens").get();
    if (snap.empty) return;

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    const message = {
      notification: { title, body },
      data: { link: link || "inicio" },
      tokens,
    };

    const res = await fcm.sendEachForMulticast(message);
    console.log(`FCM enviado: ${res.successCount} ok, ${res.failureCount} fallidos`);

    // Limpiar tokens inválidos
    const toDelete = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          toDelete.push(tokens[i]);
        }
      }
    });
    for (const token of toDelete) {
      const q = await db.collection("fcm_tokens").where("token", "==", token).get();
      q.forEach(d => d.ref.delete());
    }
  } catch (e) {
    console.error("sendToAll error:", e);
  }
}

// ─── HELPER: guardar notificación interna en Firestore ───────────────────────
async function saveNotif(txt, link = null, extra = {}) {
  const id = "fn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  await db.collection("notifs").doc(id).set({
    id,
    txt,
    ts: new Date().toISOString(),
    read: false,
    link: link || "inicio",
    ...extra,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 1. NUEVO JUGADOR
// ════════════════════════════════════════════════════════════════════════════
exports.onNuevoJugador = onDocumentCreated("players/{pid}", async (event) => {
  const p = event.data.data();
  const txt = `👤 Nuevo jugador registrado: ${p.nombre} ${p.apellido} (${p.cat})`;

  await saveNotif(txt, "jugadores");
  await sendToAll("⚽ Rómulo FC — Nuevo jugador", `${p.nombre} ${p.apellido} · ${p.cat}`, "jugadores");
});

// ════════════════════════════════════════════════════════════════════════════
// 2. JUGADOR ACTUALIZADO
// ════════════════════════════════════════════════════════════════════════════
exports.onJugadorActualizado = onDocumentUpdated("players/{pid}", async (event) => {
  const antes  = event.data.before.data();
  const despues = event.data.after.data();

  // Evitar notificar si solo cambian stats internas (goles, partidos, etc.)
  const cambios = [];
  if (antes.nombre    !== despues.nombre)    cambios.push("nombre");
  if (antes.apellido  !== despues.apellido)  cambios.push("apellido");
  if (antes.cat       !== despues.cat)       cambios.push("categoría");
  if (antes.num       !== despues.num)       cambios.push("camiseta");
  if (antes.subequipo !== despues.subequipo) cambios.push("equipo");
  if (antes.notas     !== despues.notas)     cambios.push("notas");

  if (!cambios.length) return; // Solo cambió stats — ignorar

  const txt = `✏️ Jugador actualizado: ${despues.nombre} ${despues.apellido} (${cambios.join(", ")})`;
  await saveNotif(txt, "jugadores");
  await sendToAll("✏️ Rómulo FC — Jugador actualizado", `${despues.nombre} ${despues.apellido} · ${cambios.join(", ")}`, "jugadores");
});

// ════════════════════════════════════════════════════════════════════════════
// 3. JUGADOR ELIMINADO
// ════════════════════════════════════════════════════════════════════════════
exports.onJugadorEliminado = onDocumentDeleted("players/{pid}", async (event) => {
  const p = event.data.data();
  const txt = `🗑️ Jugador eliminado: ${p.nombre} ${p.apellido} (${p.cat})`;

  await saveNotif(txt, "jugadores");
  await sendToAll("🗑️ Rómulo FC — Jugador eliminado", `${p.nombre} ${p.apellido} · ${p.cat}`, "jugadores");
});

// ════════════════════════════════════════════════════════════════════════════
// 4. NUEVO PARTIDO
// ════════════════════════════════════════════════════════════════════════════
exports.onNuevoPartido = onDocumentCreated("matches/{mid}", async (event) => {
  const m = event.data.data();

  // No notificar si el partido ya está finalizado (importado con resultado)
  if (m.status === "finalizado") return;

  const fase = m.fase && m.fase !== "Normal" ? ` · ${m.fase}` : "";
  const txt  = `📅 Nuevo partido: ${m.home} vs ${m.away} · ${m.cat} · ${m.date} ${m.time}${fase}`;

  await saveNotif(txt, "calendario");
  await sendToAll(
    "📅 Rómulo FC — Partido programado",
    `${m.home} vs ${m.away} · ${m.date} ${m.time}`,
    "calendario"
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 5. PARTIDO ACTUALIZADO
// ════════════════════════════════════════════════════════════════════════════
exports.onPartidoActualizado = onDocumentUpdated("matches/{mid}", async (event) => {
  const antes   = event.data.before.data();
  const despues = event.data.after.data();

  // Si pasó de próximo a finalizado → notificar resultado
  if (antes.status !== "finalizado" && despues.status === "finalizado") {
    const res = despues.scoreH > despues.scoreA ? "VICTORIA" :
                despues.scoreH < despues.scoreA ? "DERROTA" : "EMPATE";
    const txt = `🏁 Partido finalizado: ${despues.home} ${despues.scoreH}–${despues.scoreA} ${despues.away} · ${res}`;

    await saveNotif(txt, "calendario");
    await sendToAll(
      `🏁 Rómulo FC — ${res}`,
      `${despues.home} ${despues.scoreH}–${despues.scoreA} ${despues.away}`,
      "calendario"
    );
    return;
  }

  // Si cambió fecha/hora/cancha → notificar reprogramación
  if (
    antes.status !== "finalizado" &&
    (antes.date !== despues.date || antes.time !== despues.time || antes.field !== despues.field)
  ) {
    const txt = `🔄 Partido reprogramado: ${despues.home} vs ${despues.away} · ${despues.date} ${despues.time} · ${despues.field}`;
    await saveNotif(txt, "calendario");
    await sendToAll(
      "🔄 Rómulo FC — Partido reprogramado",
      `${despues.home} vs ${despues.away} · ${despues.date} ${despues.time}`,
      "calendario"
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 6. PARTIDO ELIMINADO
// ════════════════════════════════════════════════════════════════════════════
exports.onPartidoEliminado = onDocumentDeleted("matches/{mid}", async (event) => {
  const m = event.data.data();
  if (m.status === "finalizado") return; // No notificar eliminación de partidos ya jugados

  const txt = `🗑️ Partido eliminado: ${m.home} vs ${m.away} · ${m.date}`;
  await saveNotif(txt, "calendario");
  await sendToAll("🗑️ Rómulo FC — Partido eliminado", `${m.home} vs ${m.away} · ${m.date}`, "calendario");
});

// ════════════════════════════════════════════════════════════════════════════
// 7. PAGO REGISTRADO
// ════════════════════════════════════════════════════════════════════════════
exports.onPagoRegistrado = onDocumentUpdated("pay/{pid}", async (event) => {
  const antes   = event.data.before.data();
  const despues = event.data.after.data();

  // Detectar qué mes nuevo se pagó
  const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  for (const mes of MONTHS) {
    const antPaid  = antes.months?.[mes]?.paid;
    const despPaid = despues.months?.[mes]?.paid;

    if (!antPaid && despPaid) {
      // Obtener nombre del jugador
      let nombreJugador = "Jugador";
      try {
        const pSnap = await db.collection("players").doc(event.params.pid).get();
        if (pSnap.exists) {
          const p = pSnap.data();
          nombreJugador = `${p.nombre} ${p.apellido}`;
        }
      } catch (_) {}

      const monto  = despues.months[mes]?.monto ? ` · Bs. ${despues.months[mes].monto}` : "";
      const metodo = despues.months[mes]?.metodo ? ` (${despues.months[mes].metodo})` : "";
      const txt    = `💳 Pago registrado: ${nombreJugador} · ${mes}${monto}${metodo}`;

      await saveNotif(txt, "pagos");
      await sendToAll("💳 Rómulo FC — Pago registrado", `${nombreJugador} · ${mes}${monto}`, "pagos");
      return; // Solo notificar el primer mes nuevo encontrado por update
    }
  }

  // Detectar pago de inscripción a campeonato
  const champsAntes   = antes.championships   || {};
  const champsDespues = despues.championships || {};
  for (const champId of Object.keys(champsDespues)) {
    if (!champsAntes[champId]?.paid && champsDespues[champId]?.paid) {
      let nombreJugador = "Jugador";
      let nombreChamp   = "Campeonato";
      try {
        const pSnap = await db.collection("players").doc(event.params.pid).get();
        if (pSnap.exists) {
          const p = pSnap.data();
          nombreJugador = `${p.nombre} ${p.apellido}`;
        }
        const cSnap = await db.collection("champs").doc(String(champId)).get();
        if (cSnap.exists) nombreChamp = cSnap.data().nombre;
      } catch (_) {}

      const txt = `🏆 Inscripción pagada: ${nombreJugador} · ${nombreChamp}`;
      await saveNotif(txt, "campeonatos");
      await sendToAll("🏆 Rómulo FC — Inscripción pagada", `${nombreJugador} · ${nombreChamp}`, "campeonatos");
      return;
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 8. NUEVO CAMPEONATO
// ════════════════════════════════════════════════════════════════════════════
exports.onNuevoCampeonato = onDocumentCreated("champs/{cid}", async (event) => {
  const c    = event.data.data();
  const cats = c.cats?.length ? c.cats.join(", ") : "Todas las categorías";
  const txt  = `🏆 Nuevo campeonato: ${c.nombre} · ${cats}`;

  await saveNotif(txt, "campeonatos");
  await sendToAll("🏆 Rómulo FC — Nuevo campeonato", `${c.nombre} · ${cats}`, "campeonatos");
});

// ════════════════════════════════════════════════════════════════════════════
// 9. CAMPEONATO ACTUALIZADO (fase eliminatoria iniciada)
// ════════════════════════════════════════════════════════════════════════════
exports.onCampeonatoActualizado = onDocumentUpdated("champs/{cid}", async (event) => {
  const antes   = event.data.before.data();
  const despues = event.data.after.data();

  // Detección: pasó de grupos a eliminatoria
  if (antes.fase !== "eliminatoria" && despues.fase === "eliminatoria") {
    const txt = `⚔️ Fase eliminatoria iniciada: ${despues.nombre} · desde ${despues.rondaActual}`;
    await saveNotif(txt, "campeonatos");
    await sendToAll(
      "⚔️ Rómulo FC — Fase eliminatoria",
      `${despues.nombre} · ${despues.rondaActual}`,
      "campeonatos"
    );
    return;
  }

  // Detección: avance de ronda
  if (
    antes.fase === "eliminatoria" &&
    despues.fase === "eliminatoria" &&
    antes.rondaActual !== despues.rondaActual
  ) {
    const txt = `⚔️ ${despues.nombre} avanza a ${despues.rondaActual}`;
    await saveNotif(txt, "campeonatos");
    await sendToAll("⚔️ Rómulo FC — Nueva ronda", `${despues.nombre} · ${despues.rondaActual}`, "campeonatos");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 10. ACCIONES EN VIVO (goles, tarjetas, faltas, etc.)
// ════════════════════════════════════════════════════════════════════════════
exports.onNotifEnVivo = onDocumentCreated("notifs/{nid}", async (event) => {
  const n = event.data.data();

  // Solo procesar notificaciones de partidos en vivo generadas por la app
  if (!n.live) return;

  // No generar notif interna duplicada — ya la creó la app
  // Solo enviar el push FCM
  await sendToAll("🔴 EN VIVO — Rómulo FC", n.txt, n.link || "calendario");
});

// ════════════════════════════════════════════════════════════════════════════
// 11. SANCIÓN — TARJETA ROJA (suspensión automática)
// ════════════════════════════════════════════════════════════════════════════
exports.onSancionActualizada = onDocumentUpdated("sanc/{pid}", async (event) => {
  const antes   = event.data.before.data();
  const despues = event.data.after.data();

  // Nueva tarjeta roja → suspensión
  if (!antes.suspended && despues.suspended) {
    let nombre = "Jugador";
    try {
      const pSnap = await db.collection("players").doc(event.params.pid).get();
      if (pSnap.exists) {
        const p = pSnap.data();
        nombre = `${p.nombre} ${p.apellido}`;
      }
    } catch (_) {}

    const txt = `🟥 ${nombre} suspendido por tarjeta roja`;
    await saveNotif(txt, "jugadores");
    await sendToAll("🟥 Rómulo FC — Suspensión", txt, "jugadores");
    return;
  }

  // 3 tarjetas amarillas acumuladas
  const antY  = antes.yellows  || 0;
  const despY = despues.yellows || 0;
  if (antY < 3 && despY >= 3) {
    let nombre = "Jugador";
    try {
      const pSnap = await db.collection("players").doc(event.params.pid).get();
      if (pSnap.exists) {
        const p = pSnap.data();
        nombre = `${p.nombre} ${p.apellido}`;
      }
    } catch (_) {}

    const txt = `🟨 ${nombre} acumula ${despY} tarjetas amarillas`;
    await saveNotif(txt, "jugadores");
    await sendToAll("🟨 Rómulo FC — Tarjetas amarillas", txt, "jugadores");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 12. RECORDATORIO MENSUAL DE PAGOS (día 1 de cada mes, 8 AM Venezuela)
// ════════════════════════════════════════════════════════════════════════════
exports.recordatorioMensual = onSchedule("0 12 1 * *", async () => {
  // 12 UTC = 8 AM Venezuela (UTC-4)
  const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const mesActual = MONTHS[new Date().getMonth()];

  // Contar jugadores con pago pendiente
  let pendientes = 0;
  try {
    const paySnap = await db.collection("pay").get();
    paySnap.forEach(doc => {
      const data = doc.data();
      if (!data.months?.[mesActual]?.paid) pendientes++;
    });
  } catch (_) {}

  const txt = `📆 Recordatorio: inicio de mes ${mesActual} · ${pendientes} jugadores con mensualidad pendiente`;
  await saveNotif(txt, "pagos");
  await sendToAll(
    `📆 Rómulo FC — Mensualidad ${mesActual}`,
    pendientes > 0
      ? `${pendientes} jugadores con pago pendiente`
      : "Todos los pagos al día ✅",
    "pagos"
  );
});
