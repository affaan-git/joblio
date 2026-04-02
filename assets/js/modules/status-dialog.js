export function createStatusDialogHandlers(deps) {
  const {
    SAFE_ID_RE,
    statusDialog,
    statusTabUpdate,
    statusTabHistory,
    statusUpdateView,
    statusHistoryView,
    statusHistoryList,
    normalizeStatusHistory,
    statusClass,
    getStatusLabel,
    escapeHtml,
    fmtDate,
    ymdFromIsoInTimeZone,
    hhmmFromIsoInTimeZone,
    getServerTimeZone,
    persist,
    render,
    showToast,
    showOnlineToast,
    findApp,
  } = deps;

  let statusDialogAppId = null;

  function renderStatusHistory(app) {
    normalizeStatusHistory(app);
    if (!app.statusHistory.length) {
      statusHistoryList.innerHTML = '<div class="small">No status history yet.</div>';
      return;
    }
    statusHistoryList.innerHTML = app.statusHistory
      .map((entry, i) => `
        <div class="status-history-item" data-index="${i}">
          <span class="pill ${statusClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="small">${escapeHtml(fmtDate(entry.at))}</span>
          <button class="btn sh-edit-btn" data-action="edit" title="Edit timestamp">\u270E</button>
        </div>
      `)
      .join('');
  }

  function enterEditMode(itemEl, entry) {
    const tz = getServerTimeZone();
    const dateVal = ymdFromIsoInTimeZone(entry.at, tz);
    const timeVal = hhmmFromIsoInTimeZone(entry.at, tz);
    itemEl.classList.add('sh-editing');
    itemEl.innerHTML = `
      <span class="pill ${statusClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status))}</span>
      <div class="sh-edit-fields">
        <input type="date" class="sh-date" value="${escapeHtml(dateVal)}">
        <input type="time" class="sh-time" value="${escapeHtml(timeVal)}">
      </div>
      <div class="sh-edit-actions">
        <button class="btn primary" data-action="save">Save</button>
        <button class="btn" data-action="cancel">Cancel</button>
      </div>
    `;
  }

  function saveTimestamp(app, index, dateVal, timeVal) {
    if (!dateVal) {
      showToast("Date is required.", "error");
      return;
    }
    const timePart = timeVal || "00:00";
    const parsed = new Date(`${dateVal}T${timePart}:00`);
    if (isNaN(parsed.getTime())) {
      showToast("Invalid date or time.", "error");
      return;
    }
    const newIso = parsed.toISOString();
    const tz = getServerTimeZone();

    app.statusHistory[index].at = newIso;

    if (index === 0) {
      app.statusUpdatedAt = newIso;
      if (app.statusHistory[0].status === "applied") {
        app.appliedAt = ymdFromIsoInTimeZone(newIso, tz) || "";
        app.appliedTime = hhmmFromIsoInTimeZone(newIso, tz) || "";
      }
    }

    persist();
    renderStatusHistory(app);
    render();
    showOnlineToast("Timestamp updated.");
  }

  statusHistoryList.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const itemEl = actionEl.closest('.status-history-item');
    if (!itemEl) return;
    const index = Number(itemEl.dataset.index);
    const app = findApp(statusDialogAppId);
    if (!app || !Number.isFinite(index) || !app.statusHistory[index]) return;

    if (action === 'edit') {
      renderStatusHistory(app);
      enterEditMode(statusHistoryList.children[index], app.statusHistory[index]);
    } else if (action === 'save') {
      const dateInput = itemEl.querySelector('.sh-date');
      const timeInput = itemEl.querySelector('.sh-time');
      saveTimestamp(app, index, dateInput.value, timeInput.value);
    } else if (action === 'cancel') {
      renderStatusHistory(app);
    }
  });

  function setStatusDialogView(view) {
    const showUpdate = view !== 'history';
    statusUpdateView.classList.toggle('is-hidden', !showUpdate);
    statusHistoryView.classList.toggle('is-hidden', showUpdate);
    statusTabUpdate.classList.toggle('active', showUpdate);
    statusTabHistory.classList.toggle('active', !showUpdate);
  }

  function openStatusDialog(appId, view = 'update') {
    if (!SAFE_ID_RE.test(String(appId || ''))) return;
    statusDialogAppId = appId;
    const app = findApp(appId);
    if (app) renderStatusHistory(app);
    setStatusDialogView(view);
    statusDialog.classList.add('open');
  }

  function closeStatusDialog() {
    statusDialog.classList.remove('open');
    statusDialogAppId = null;
  }

  function getStatusDialogAppId() {
    return statusDialogAppId;
  }

  return {
    renderStatusHistory,
    setStatusDialogView,
    openStatusDialog,
    closeStatusDialog,
    getStatusDialogAppId,
  };
}
