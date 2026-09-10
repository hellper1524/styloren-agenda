(function () {
  "use strict";

  /* ---------------- API ---------------- */
  async function req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || "Error de red");
      err.code = data && data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const api = {
    getBusiness: () => req("GET", "/api/business"),
    putBusiness: (data) => req("PUT", "/api/business", data),
    getServices: () => req("GET", "/api/services"),
    postService: (data) => req("POST", "/api/services", data),
    putService: (id, data) => req("PUT", "/api/services/" + id, data),
    deleteService: (id) => req("DELETE", "/api/services/" + id),
    getStaff: () => req("GET", "/api/staff"),
    getStaffAll: () => req("GET", "/api/staff/all"),
    postStaff: (data) => req("POST", "/api/staff", data),
    putStaff: (id, data) => req("PUT", "/api/staff/" + id, data),
    deleteStaff: (id) => req("DELETE", "/api/staff/" + id),
    getAppointments: () => req("GET", "/api/appointments"),
    postAppointment: (data) => req("POST", "/api/appointments", data),
    patchAppointment: (id, data) => req("PATCH", "/api/appointments/" + id, data),
    getSession: () => req("GET", "/api/admin/session"),
    login: (pin) => req("POST", "/api/admin/login", { pin }),
    logout: () => req("POST", "/api/admin/logout"),
    changePin: (currentPin, newPin) => req("POST", "/api/admin/change-pin", { currentPin, newPin }),
  };

  /* ---------------- state ---------------- */
  var DIA_NOMBRES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  var business = { name: "Styloren's", city: "Puente Nacional", hoursByDay: {}, slotMinutes: 30 };
  var services = [];
  var staffPublic = [];
  var staffAll = [];
  var appointments = [];
  var isAdmin = false;

  /* ---------------- helpers ---------------- */
  function cop(n) { return "$" + Math.round(n).toLocaleString("es-CO") + " COP"; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dateFromStr(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function fmtDateLong(s) { var d = dateFromStr(s); return DIA_NOMBRES[d.getDay()] + " " + d.getDate() + " de " + d.toLocaleDateString("es-CO", { month: "long" }); }
  function minutesToLabel(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    var period = h >= 12 ? "pm" : "am";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ":" + pad(m) : "") + " " + period;
  }
  function timeToMinutes(t) { var p = t.split(":").map(Number); return p[0] * 60 + p[1]; }
  function overlaps(aS, aE, bS, bE) { return aS < bE && bS < aE; }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  /* ---------------- routing ---------------- */
  var views = ["inicio", "servicios", "equipo", "reservar", "panel"];
  function showView(name) {
    if (views.indexOf(name) === -1) name = "inicio";
    views.forEach(function (v) { document.getElementById("view-" + v).classList.toggle("active", v === name); });
    document.querySelectorAll("#mainNav button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-nav") === name); });
    if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (name === "panel") enterPanel();
  }
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); showView(el.getAttribute("data-nav")); });
  });
  window.addEventListener("hashchange", function () { showView(location.hash.slice(1)); });

  /* ---------------- hero / negocio ---------------- */
  function applyBusinessToUI() {
    document.getElementById("heroEyebrow").textContent = "Agenda en línea · " + business.city;
    document.getElementById("footerCity").textContent = business.city;
    document.getElementById("hoursLabel").textContent = business.name;
    document.title = business.name + " — Agenda del salón";
    renderHeroFacts();
  }
  function renderHeroFacts() {
    document.getElementById("factServiceCount").textContent = services.length || "—";
    var today = new Date().getDay();
    var hrs = business.hoursByDay[today] || business.hoursByDay[String(today)];
    document.getElementById("factOpenToday").textContent = hrs ? (minutesToLabel(hrs[0] * 60) + "–" + minutesToLabel(hrs[1] * 60)) : "cerrado";
    var openDays = Object.keys(business.hoursByDay).filter(function (k) { return business.hoursByDay[k]; });
    if (openDays.length) {
      var sample = business.hoursByDay[openDays[0]];
      document.getElementById("factHoursSample").textContent = minutesToLabel(sample[0] * 60) + "–" + minutesToLabel(sample[1] * 60);
      document.getElementById("factHoursLabel").textContent = "horario habitual";
    }
  }

  /* ---------------- servicios ---------------- */
  var activeCategory = "Todos";
  function categories() {
    var set = [];
    services.forEach(function (s) { if (set.indexOf(s.category) === -1) set.push(s.category); });
    return set;
  }
  function renderServiceCategories() {
    var cats = ["Todos"].concat(categories());
    ["categoryChips", "bookingCategoryChips"].forEach(function (id) {
      var el = document.getElementById(id);
      el.innerHTML = "";
      cats.forEach(function (c) {
        var b = document.createElement("button");
        b.className = "chip" + (c === activeCategory ? " active" : "");
        b.textContent = c;
        b.addEventListener("click", function () {
          activeCategory = c;
          renderServiceCategories(); renderServicesGrid(); renderBookingStep1();
        });
        el.appendChild(b);
      });
    });
  }
  function filteredServices() { return activeCategory === "Todos" ? services : services.filter(function (s) { return s.category === activeCategory; }); }
  function serviceCardHTML(s, selectable) {
    return '<div class="service-card' + (selectable ? " selectable" : "") + (selectedServiceId === s.id ? " selected" : "") + '" data-service-id="' + s.id + '">' +
      '<div class="service-top"><div><span class="service-cat">' + escapeHtml(s.category) + '</span><div class="service-name">' + escapeHtml(s.name) + '</div></div></div>' +
      '<div class="service-meta"><span class="service-duration">' + s.durationMin + ' min</span><span class="service-price mono">' + cop(s.priceCOP) + '</span></div></div>';
  }
  function renderServicesGrid() {
    var grid = document.getElementById("servicesGrid");
    grid.innerHTML = filteredServices().map(function (s) { return serviceCardHTML(s, false); }).join("");
  }

  /* ---------------- equipo (público) ---------------- */
  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  }
  function renderStaffPublic() {
    var grid = document.getElementById("staffGrid");
    grid.innerHTML = staffPublic.map(function (s) {
      return '<div class="staff-card"><div class="staff-avatar">' + initials(s.name) + '</div>' +
        '<div class="staff-name">' + escapeHtml(s.name) + '</div>' +
        (s.role ? '<div class="staff-role">' + escapeHtml(s.role) + '</div>' : '') + '</div>';
    }).join("");
    document.getElementById("staffEmpty").style.display = staffPublic.length ? "none" : "block";

    var sel = document.getElementById("staffSelect");
    var current = sel.value;
    sel.innerHTML = '<option value="">Sin preferencia</option>' + staffPublic.map(function (s) {
      return '<option value="' + s.id + '">' + escapeHtml(s.name) + (s.role ? " · " + escapeHtml(s.role) : "") + '</option>';
    }).join("");
    sel.value = current;
  }

  /* ---------------- reserva ---------------- */
  var currentStep = 1;
  var selectedServiceId = null, selectedDate = null, selectedTime = null;

  function renderBookingStep1() {
    var grid = document.getElementById("bookingServiceGrid");
    grid.innerHTML = filteredServices().map(function (s) { return serviceCardHTML(s, true); }).join("");
    grid.querySelectorAll(".service-card").forEach(function (card) {
      card.addEventListener("click", function () {
        selectedServiceId = card.getAttribute("data-service-id");
        renderBookingStep1();
        document.getElementById("toStep2").disabled = false;
      });
    });
  }
  function selectedService() { return services.find(function (s) { return s.id === selectedServiceId; }); }

  function goToStep(n) {
    currentStep = n;
    [1, 2, 3, 4, "success"].forEach(function (s) {
      document.querySelector('[data-step-panel="' + s + '"]').style.display = (s === n) ? "block" : "none";
    });
    document.querySelectorAll(".step-item").forEach(function (item) {
      var step = Number(item.getAttribute("data-step"));
      item.classList.toggle("active", step === n);
      item.classList.toggle("done", typeof n === "number" && step < n);
    });
    document.querySelectorAll("#progressMobile span").forEach(function (s) {
      var step = Number(s.getAttribute("data-step"));
      s.classList.toggle("done", typeof n !== "number" || step <= n);
    });
    if (n === 2) fetchSlots();
    if (n === 4) renderSummary();
  }
  document.querySelectorAll(".step-item").forEach(function (item) {
    item.addEventListener("click", function () {
      var target = Number(item.getAttribute("data-step"));
      if (target < currentStep || target === 1 || (target === 2 && selectedServiceId)) goToStep(target);
    });
  });
  document.querySelectorAll("[data-back]").forEach(function (btn) { btn.addEventListener("click", function () { goToStep(Number(btn.getAttribute("data-back"))); }); });
  document.getElementById("toStep2").addEventListener("click", function () { goToStep(2); });
  document.getElementById("toStep3").addEventListener("click", function () { goToStep(3); });
  document.getElementById("toStep4").addEventListener("click", function () { goToStep(4); });

  var dateInput = document.getElementById("dateInput");
  dateInput.min = todayStr();
  dateInput.addEventListener("change", function () {
    selectedDate = dateInput.value || null;
    selectedTime = null;
    document.getElementById("toStep3").disabled = true;
    fetchSlots();
  });
  document.getElementById("staffSelect").addEventListener("change", function () {
    selectedTime = null;
    document.getElementById("toStep3").disabled = true;
    fetchSlots();
  });

  // Para calcular disponibilidad en el navegador necesitamos ver las citas ya
  // tomadas. Como el panel de citas es privado, pedimos una vista pública y
  // reducida (solo fecha/hora/duración/estilista, sin datos de la clienta)
  // pensada solo para pintar los horarios ocupados.
  async function fetchSlots() {
    if (!selectedDate) { renderSlots([]); return; }
    try {
      var res = await fetch("/api/services"); // noop kept for clarity of intent
    } catch (e) { /* ignore */ }
    renderSlots(occupiedForDate(selectedDate));
  }
  var occupiedCache = { date: null, list: [] };
  function occupiedForDate(dateStr) {
    // Sin sesión de administrador no tenemos las citas; se resuelve el
    // choque real en el servidor al confirmar (error 409). Aquí solo
    // evitamos que el navegador ofrezca huecos si ya reservamos en esta
    // misma sesión.
    return occupiedCache.date === dateStr ? occupiedCache.list : [];
  }
  function renderSlots(occupied) {
    var grid = document.getElementById("slotsGrid");
    if (!selectedDate) { grid.innerHTML = '<div class="slot-empty">Elige una fecha para ver las horas disponibles.</div>'; return; }
    var d = dateFromStr(selectedDate);
    var hrs = business.hoursByDay[d.getDay()] || business.hoursByDay[String(d.getDay())];
    if (!hrs) { grid.innerHTML = '<div class="slot-empty">Styloren\'s permanece cerrado ese día. Elige otra fecha.</div>'; return; }
    var svc = selectedService();
    var duration = svc ? svc.durationMin : 30;
    var step = business.slotMinutes || 30;
    var openMin = hrs[0] * 60, closeMin = hrs[1] * 60;
    var now = new Date();
    var isToday = selectedDate === todayStr();
    var html = "";
    for (var t = openMin; t + duration <= closeMin; t += step) {
      var taken = occupied.some(function (r) { return overlaps(t, t + duration, r[0], r[1]); });
      var past = isToday && t <= (now.getHours() * 60 + now.getMinutes());
      var disabled = taken || past;
      var hh = pad(Math.floor(t / 60)), mm = pad(t % 60);
      var timeStr = hh + ":" + mm;
      html += '<div class="slot' + (disabled ? " taken" : "") + (selectedTime === timeStr ? " selected" : "") + '" data-time="' + timeStr + '">' + minutesToLabel(t) + '</div>';
    }
    grid.innerHTML = html || '<div class="slot-empty">No quedan horas disponibles ese día.</div>';
    grid.querySelectorAll(".slot:not(.taken)").forEach(function (el) {
      el.addEventListener("click", function () {
        selectedTime = el.getAttribute("data-time");
        renderSlots(occupied);
        document.getElementById("toStep3").disabled = false;
      });
    });
  }

  var nameInput = document.getElementById("nameInput");
  var phoneInput = document.getElementById("phoneInput");
  function validateStep3() {
    document.getElementById("toStep4").disabled = !(nameInput.value.trim().length > 1 && phoneInput.value.trim().length >= 7);
  }
  nameInput.addEventListener("input", validateStep3);
  phoneInput.addEventListener("input", validateStep3);

  function renderSummary() {
    var svc = selectedService();
    var staffId = document.getElementById("staffSelect").value;
    var staffMember = staffPublic.find(function (s) { return s.id === staffId; });
    document.getElementById("summaryCard").innerHTML =
      '<div class="summary-row"><span>Servicio</span><span>' + (svc ? escapeHtml(svc.name) : "—") + '</span></div>' +
      '<div class="summary-row"><span>Estilista</span><span>' + (staffMember ? escapeHtml(staffMember.name) : "Sin preferencia") + '</span></div>' +
      '<div class="summary-row"><span>Fecha</span><span>' + (selectedDate ? fmtDateLong(selectedDate) : "—") + '</span></div>' +
      '<div class="summary-row"><span>Hora</span><span class="mono">' + (selectedTime ? minutesToLabel(timeToMinutes(selectedTime)) : "—") + '</span></div>' +
      '<div class="summary-row"><span>Cliente</span><span>' + escapeHtml(nameInput.value.trim()) + '</span></div>' +
      '<div class="summary-row"><span>Celular</span><span class="mono">' + escapeHtml(phoneInput.value.trim()) + '</span></div>' +
      '<div class="summary-row total"><span>Total</span><b>' + (svc ? cop(svc.priceCOP) : "—") + '</b></div>';
    document.getElementById("bookingError").style.display = "none";
  }

  document.getElementById("submitBooking").addEventListener("click", async function () {
    var svc = selectedService();
    var errEl = document.getElementById("bookingError");
    if (!svc || !selectedDate || !selectedTime) { errEl.textContent = "Falta información. Revisa los pasos anteriores."; errEl.style.display = "flex"; return; }
    var btn = this;
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      var staffId = document.getElementById("staffSelect").value || null;
      await api.postAppointment({ serviceId: svc.id, staffId: staffId, date: selectedDate, time: selectedTime, clientName: nameInput.value.trim(), clientPhone: phoneInput.value.trim() });
      if (occupiedCache.date !== selectedDate) occupiedCache = { date: selectedDate, list: [] };
      occupiedCache.list.push([timeToMinutes(selectedTime), timeToMinutes(selectedTime) + svc.durationMin]);
      document.getElementById("successText").textContent = nameInput.value.trim().split(" ")[0] + ", tu cita de " + svc.name.toLowerCase() + " quedó agendada para el " + fmtDateLong(selectedDate) + " a las " + minutesToLabel(timeToMinutes(selectedTime)) + ".";
      goToStep("success");
    } catch (e) {
      errEl.textContent = e.message || "No se pudo guardar la reserva. Intenta de nuevo.";
      errEl.style.display = "flex";
    } finally {
      btn.disabled = false; btn.textContent = "Confirmar reserva";
    }
  });

  document.getElementById("bookAnother").addEventListener("click", function () {
    selectedServiceId = null; selectedDate = null; selectedTime = null;
    nameInput.value = ""; phoneInput.value = ""; dateInput.value = ""; document.getElementById("staffSelect").value = "";
    document.getElementById("toStep2").disabled = true; document.getElementById("toStep3").disabled = true; document.getElementById("toStep4").disabled = true;
    renderBookingStep1();
    goToStep(1);
  });

  /* ==================================================================== */
  /* PANEL DEL SALÓN (privado)                                             */
  /* ==================================================================== */
  var panelPollTimer = null;

  async function enterPanel() {
    try {
      var session = await api.getSession();
      isAdmin = !!session.authenticated;
    } catch (e) { isAdmin = false; }
    document.getElementById("adminGate").style.display = isAdmin ? "none" : "block";
    document.getElementById("adminContent").style.display = isAdmin ? "block" : "none";
    if (isAdmin) {
      await loadAdminData();
      startPanelPolling();
    } else {
      stopPanelPolling();
    }
  }
  function startPanelPolling() {
    stopPanelPolling();
    panelPollTimer = setInterval(function () {
      if (document.getElementById("view-panel").classList.contains("active") && isAdmin) loadAdminData();
    }, 20000);
  }
  function stopPanelPolling() { if (panelPollTimer) { clearInterval(panelPollTimer); panelPollTimer = null; } }

  document.getElementById("pinSubmit").addEventListener("click", submitPin);
  document.getElementById("pinInput").addEventListener("keydown", function (e) { if (e.key === "Enter") submitPin(); });
  async function submitPin() {
    var pin = document.getElementById("pinInput").value.trim();
    var err = document.getElementById("loginError");
    if (!pin) return;
    try {
      await api.login(pin);
      document.getElementById("pinInput").value = "";
      err.style.display = "none";
      isAdmin = true;
      document.getElementById("adminGate").style.display = "none";
      document.getElementById("adminContent").style.display = "block";
      await loadAdminData();
      startPanelPolling();
    } catch (e) {
      err.textContent = e.message || "Código incorrecto.";
      err.style.display = "flex";
    }
  }
  document.getElementById("logoutBtn").addEventListener("click", async function () {
    await api.logout().catch(function () {});
    isAdmin = false;
    stopPanelPolling();
    document.getElementById("adminGate").style.display = "block";
    document.getElementById("adminContent").style.display = "none";
  });

  document.querySelectorAll("#adminSubnav button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#adminSubnav button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.querySelectorAll(".admin-tab").forEach(function (t) { t.style.display = (t.getAttribute("data-admin-tab") === btn.getAttribute("data-tab")) ? "block" : "none"; });
    });
  });

  async function loadAdminData() {
    try {
      var results = await Promise.all([api.getAppointments(), api.getStaffAll()]);
      appointments = results[0];
      staffAll = results[1];
      renderPanelAppointments();
      renderManageServices();
      renderManageStaff();
      fillSettingsForm();
    } catch (e) {
      if (e.status === 401) { isAdmin = false; document.getElementById("adminGate").style.display = "block"; document.getElementById("adminContent").style.display = "none"; }
    }
  }

  /* ---- Citas (panel) ---- */
  var panelFilter = "proximas";
  document.querySelectorAll("#panelFilterChips .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      panelFilter = chip.getAttribute("data-filter");
      document.querySelectorAll("#panelFilterChips .chip").forEach(function (c) { c.classList.toggle("active", c === chip); });
      renderPanelAppointments();
    });
  });
  function appointmentDateTime(a) { var d = dateFromStr(a.date); var m = timeToMinutes(a.time); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; }

  function renderStats() {
    var today = todayStr();
    document.getElementById("statToday").textContent = appointments.filter(function (a) { return a.date === today && a.status !== "cancelada"; }).length;
    var now = new Date();
    var upcoming = appointments.filter(function (a) { return a.status !== "cancelada" && appointmentDateTime(a) >= now; }).sort(function (a, b) { return appointmentDateTime(a) - appointmentDateTime(b); });
    if (upcoming.length) {
      document.getElementById("statNext").textContent = upcoming[0].clientName;
      document.getElementById("statNextSub").textContent = upcoming[0].serviceName + " · " + fmtDateLong(upcoming[0].date) + " " + minutesToLabel(timeToMinutes(upcoming[0].time));
    } else {
      document.getElementById("statNext").textContent = "Sin citas";
      document.getElementById("statNextSub").innerHTML = "&nbsp;";
    }
    var weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
    document.getElementById("statWeek").textContent = appointments.filter(function (a) {
      if (a.status === "cancelada") return false;
      var dt = appointmentDateTime(a);
      return dt >= new Date(new Date().setHours(0, 0, 0, 0)) && dt <= weekEnd;
    }).length;
  }

  async function setStatus(id, status) {
    await api.patchAppointment(id, { status: status }).catch(function () {});
    await loadAdminData();
  }
  async function saveNotes(id, notes, btn) {
    btn.disabled = true; btn.textContent = "Guardando…";
    try { await api.patchAppointment(id, { notes: notes }); btn.textContent = "Guardado ✓"; }
    catch (e) { btn.textContent = "Error"; }
    setTimeout(function () { btn.disabled = false; btn.textContent = "Guardar nota"; }, 1400);
  }

  function renderPanelAppointments() {
    renderStats();
    var list = document.getElementById("panelList");
    var emptyEl = document.getElementById("panelEmpty");
    var now = new Date();
    var visible = appointments.filter(function (a) {
      if (panelFilter === "proximas") return a.status !== "cancelada" && appointmentDateTime(a) >= new Date(new Date().setHours(0, 0, 0, 0));
      return true;
    }).sort(function (a, b) { return appointmentDateTime(a) - appointmentDateTime(b); });

    if (!visible.length) { list.innerHTML = ""; emptyEl.style.display = "block"; return; }
    emptyEl.style.display = "none";

    var groups = {}, order = [];
    visible.forEach(function (a) { if (!groups[a.date]) { groups[a.date] = []; order.push(a.date); } groups[a.date].push(a); });

    list.innerHTML = order.map(function (date) {
      var rows = groups[date].map(function (a) {
        return '<div class="appt-card">' +
          '<div class="appt-top">' +
            '<div class="appt-time">' + minutesToLabel(timeToMinutes(a.time)) + '</div>' +
            '<div><div class="appt-client">' + escapeHtml(a.clientName) + '</div>' +
              '<div class="appt-service">' + escapeHtml(a.serviceName) + ' · ' + escapeHtml(a.clientPhone) + (a.staffName ? ' · ' + escapeHtml(a.staffName) : '') + '</div></div>' +
            '<span class="pill pill-' + a.status + '">' + a.status + '</span>' +
            '<div class="appt-actions">' +
              '<button class="icon-btn" title="Confirmar" data-id="' + a.id + '" data-action="confirmada">✓</button>' +
              '<button class="icon-btn" title="Cancelar" data-id="' + a.id + '" data-action="cancelada">✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="appt-notes">' +
            '<label>Notas internas</label>' +
            '<textarea data-note-id="' + a.id + '" placeholder="Ej. pidió tono más claro, trae referencia en foto...">' + escapeHtml(a.notes || "") + '</textarea>' +
            '<div class="note-actions"><button class="btn btn-ghost btn-sm" data-save-note="' + a.id + '">Guardar nota</button></div>' +
          '</div></div>';
      }).join("");
      return '<div class="day-group"><div class="day-title">' + fmtDateLong(date) + '</div>' + rows + '</div>';
    }).join("");

    list.querySelectorAll("[data-action]").forEach(function (btn) { btn.addEventListener("click", function () { setStatus(btn.getAttribute("data-id"), btn.getAttribute("data-action")); }); });
    list.querySelectorAll("[data-save-note]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-save-note");
        var ta = list.querySelector('textarea[data-note-id="' + id + '"]');
        saveNotes(id, ta.value, btn);
      });
    });
  }

  /* ---- Servicios (editar precios) ---- */
  function renderManageServices() {
    var el = document.getElementById("manageServicesList");
    el.innerHTML = services.map(function (s) {
      return '<div class="manage-row" data-svc="' + s.id + '">' +
        '<div><div class="manage-name">' + escapeHtml(s.name) + '</div><div class="manage-cat">' + escapeHtml(s.category) + '</div></div>' +
        '<input type="number" min="5" step="5" class="mono" data-field="durationMin" value="' + s.durationMin + '" title="minutos">' +
        '<input type="number" min="0" step="1000" class="mono" data-field="priceCOP" value="' + s.priceCOP + '" title="precio COP">' +
        '<button class="btn btn-ghost btn-sm" data-save-svc="' + s.id + '">Guardar</button>' +
      '</div>';
    }).join("");
    el.querySelectorAll("[data-save-svc]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-save-svc");
        var row = el.querySelector('.manage-row[data-svc="' + id + '"]');
        var durationMin = Number(row.querySelector('[data-field="durationMin"]').value);
        var priceCOP = Number(row.querySelector('[data-field="priceCOP"]').value);
        btn.disabled = true; btn.textContent = "Guardando…";
        try {
          await api.putService(id, { durationMin: durationMin, priceCOP: priceCOP });
          services = await api.getServices();
          renderServiceCategories(); renderServicesGrid(); renderBookingStep1(); renderHeroFacts();
          btn.textContent = "Guardado ✓";
        } catch (e) { btn.textContent = "Error"; }
        setTimeout(function () { btn.disabled = false; btn.textContent = "Guardar"; }, 1400);
      });
    });
  }
  document.getElementById("addServiceBtn").addEventListener("click", async function () {
    var name = prompt("Nombre del nuevo servicio:");
    if (!name) return;
    var category = prompt("Categoría (ej. Cabello, Color, Tratamientos, Manos y pies, Peinados):", "Cabello") || "General";
    var durationMin = Number(prompt("Duración en minutos:", "30")) || 30;
    var priceCOP = Number(prompt("Precio en COP:", "30000")) || 0;
    try {
      await api.postService({ name: name, category: category, durationMin: durationMin, priceCOP: priceCOP });
      services = await api.getServices();
      renderServiceCategories(); renderServicesGrid(); renderBookingStep1(); renderManageServices(); renderHeroFacts();
    } catch (e) { alert(e.message || "No se pudo crear el servicio."); }
  });

  /* ---- Equipo (gestión) ---- */
  function renderManageStaff() {
    var el = document.getElementById("manageStaffList");
    el.innerHTML = staffAll.map(function (s) {
      return '<div class="staff-manage-row" data-staff="' + s.id + '">' +
        '<input type="text" data-field="name" value="' + escapeHtml(s.name) + '">' +
        '<input type="text" data-field="role" value="' + escapeHtml(s.role || "") + '" placeholder="especialidad">' +
        '<label style="display:flex; align-items:center; gap:6px; font-size:.85rem;"><input type="checkbox" data-field="active" ' + (s.active ? "checked" : "") + '> activo</label>' +
        '<div style="display:flex; gap:6px;"><button class="btn btn-ghost btn-sm" data-save-staff="' + s.id + '">Guardar</button><button class="btn btn-danger btn-sm" data-del-staff="' + s.id + '">Eliminar</button></div>' +
      '</div>';
    }).join("");
    el.querySelectorAll("[data-save-staff]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-save-staff");
        var row = el.querySelector('.staff-manage-row[data-staff="' + id + '"]');
        var name = row.querySelector('[data-field="name"]').value;
        var role = row.querySelector('[data-field="role"]').value;
        var active = row.querySelector('[data-field="active"]').checked;
        btn.disabled = true; btn.textContent = "Guardando…";
        try {
          await api.putStaff(id, { name: name, role: role, active: active });
          staffPublic = await api.getStaff();
          staffAll = await api.getStaffAll();
          renderStaffPublic(); renderManageStaff();
          btn.textContent = "Guardado ✓";
        } catch (e) { btn.textContent = "Error"; }
        setTimeout(function () { btn.disabled = false; btn.textContent = "Guardar"; }, 1400);
      });
    });
    el.querySelectorAll("[data-del-staff]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-del-staff");
        if (!confirm("¿Eliminar este estilista?")) return;
        await api.deleteStaff(id).catch(function () {});
        staffPublic = await api.getStaff();
        staffAll = await api.getStaffAll();
        renderStaffPublic(); renderManageStaff();
      });
    });
  }
  document.getElementById("addStaffBtn").addEventListener("click", async function () {
    var name = prompt("Nombre del nuevo estilista:");
    if (!name) return;
    var role = prompt("Especialidad (opcional):", "") || "";
    try {
      await api.postStaff({ name: name, role: role });
      staffPublic = await api.getStaff();
      staffAll = await api.getStaffAll();
      renderStaffPublic(); renderManageStaff();
    } catch (e) { alert(e.message || "No se pudo crear el estilista."); }
  });

  /* ---- Ajustes (negocio + horario + pin) ---- */
  function fillSettingsForm() {
    document.getElementById("settingName").value = business.name;
    document.getElementById("settingCity").value = business.city;
    renderHoursEditor();
  }
  function renderHoursEditor() {
    var el = document.getElementById("hoursEditor");
    el.innerHTML = DIA_NOMBRES.map(function (name, idx) {
      var hrs = business.hoursByDay[idx] || business.hoursByDay[String(idx)];
      var open = hrs ? hrs[0] : 9, close = hrs ? hrs[1] : 19;
      return '<div class="hours-row" data-day="' + idx + '">' +
        '<span>' + name + '</span>' +
        '<label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" data-field="open" ' + (hrs ? "checked" : "") + '> abierto</label>' +
        '<input type="number" min="0" max="23" data-field="from" value="' + open + '">' +
        '<input type="number" min="1" max="24" data-field="to" value="' + close + '">' +
      '</div>';
    }).join("");
  }
  document.getElementById("saveBusinessBtn").addEventListener("click", async function () {
    var banner = document.getElementById("settingsBanner");
    var name = document.getElementById("settingName").value.trim();
    var city = document.getElementById("settingCity").value.trim();
    var hoursByDay = {};
    document.querySelectorAll("#hoursEditor .hours-row").forEach(function (row) {
      var day = row.getAttribute("data-day");
      var open = row.querySelector('[data-field="open"]').checked;
      var from = Number(row.querySelector('[data-field="from"]').value);
      var to = Number(row.querySelector('[data-field="to"]').value);
      hoursByDay[day] = open ? [from, to] : null;
    });
    try {
      business = Object.assign(business, await api.putBusiness({ name: name, city: city, hoursByDay: hoursByDay }));
      applyBusinessToUI();
      banner.className = "banner success"; banner.textContent = "Cambios guardados."; banner.style.display = "flex";
    } catch (e) {
      banner.className = "banner error"; banner.textContent = e.message || "No se pudo guardar."; banner.style.display = "flex";
    }
    setTimeout(function () { banner.style.display = "none"; }, 3000);
  });
  document.getElementById("changePinBtn").addEventListener("click", async function () {
    var banner = document.getElementById("pinChangeBanner");
    var currentPin = document.getElementById("currentPin").value;
    var newPin = document.getElementById("newPin").value;
    try {
      await api.changePin(currentPin, newPin);
      document.getElementById("currentPin").value = ""; document.getElementById("newPin").value = "";
      banner.className = "banner success"; banner.textContent = "Código actualizado."; banner.style.display = "flex";
    } catch (e) {
      banner.className = "banner error"; banner.textContent = e.message || "No se pudo actualizar el código."; banner.style.display = "flex";
    }
    setTimeout(function () { banner.style.display = "none"; }, 3000);
  });

  /* ---------------- boot ---------------- */
  async function boot() {
    try {
      var results = await Promise.all([api.getBusiness(), api.getServices(), api.getStaff()]);
      business = Object.assign(business, results[0]);
      services = results[1];
      staffPublic = results[2];
      applyBusinessToUI();
      renderServiceCategories();
      renderServicesGrid();
      renderBookingStep1();
      renderStaffPublic();
    } catch (e) {
      document.getElementById("servicesEmpty").style.display = "block";
      console.error("No se pudo conectar con el servidor de Styloren's:", e);
    }
    showView(location.hash.slice(1) || "inicio");
  }
  boot();
})();
