const state = {
  filters: {
    search: '',
    timeframe: 'all',
    agent: 'all',
    waitingFor: 'all',
    converted: 'all',
    followOn: 'all',
  },
  summary: null,
  conversations: [],
  selectedConversationId: null,
  selectedConversation: null,
  timezone: 'America/Bogota',
  businessHours: null,
};

const elements = {
  search: document.getElementById('monitor-search'),
  timeframe: document.getElementById('monitor-timeframe'),
  agent: document.getElementById('monitor-agent'),
  waiting: document.getElementById('monitor-waiting'),
  converted: document.getElementById('monitor-converted'),
  followOn: document.getElementById('monitor-follow-on'),
  summary: document.getElementById('monitor-summary'),
  tableBody: document.getElementById('monitor-table-body'),
  count: document.getElementById('monitor-count'),
  detailTitle: document.getElementById('monitor-detail-title'),
  detailBody: document.getElementById('monitor-detail-body'),
  hours: document.getElementById('monitoring-hours'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(value) {
  if (!value) return 'Sin dato';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: state.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatShortDateTime(value) {
  if (!value) return 'Sin dato';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: state.timezone,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCountdown(value) {
  if (value == null) return 'Sin follow on';
  const abs = Math.abs(value);
  const minutes = Math.round(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const label = hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  return value <= 0 ? `Vencido por ${label}` : `Faltan ${label}`;
}

async function api(path) {
  const response = await fetch(path);
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || 'Request failed');
  return json;
}

function buildQueryString() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value && value !== 'all') {
      params.set(key, value);
    } else if (key === 'search' && value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function renderSummary() {
  const summary = state.summary || {
    total: 0,
    botActive: 0,
    hitl: 0,
    waitingClient: 0,
    waitingOwner: 0,
    converted: 0,
    pendingFollowOn: 0,
    dueFollowOn: 0,
  };

  const cards = [
    ['Total', summary.total],
    ['Bot activo', summary.botActive],
    ['HITL', summary.hitl],
    ['Esperando cliente', summary.waitingClient],
    ['Esperando propietario', summary.waitingOwner],
    ['Cerrados / elegida', summary.converted],
    ['Follow on pendiente', summary.pendingFollowOn],
    ['Follow on vencido', summary.dueFollowOn],
  ];

  elements.summary.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <span class="metric-card__label">${escapeHtml(label)}</span>
          <strong class="metric-card__value">${escapeHtml(value)}</strong>
        </article>
      `,
    )
    .join('');
}

function stageChipLabel(conversation) {
  return conversation.currentState || 'NEW';
}

function renderTable() {
  elements.count.textContent = `${state.conversations.length} conversaciones`;

  if (!state.conversations.length) {
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="inspector-empty">
            <p>No hay conversaciones para los filtros seleccionados.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  elements.tableBody.innerHTML = state.conversations
    .map((conversation) => {
      const selected = conversation.waId === state.selectedConversationId;
      const followOn = conversation.followOn;
      const followOnLabel = followOn
        ? `${followOn.status} · ${formatCountdown(followOn.remainingMs)}`
        : 'Sin follow on';
      const botLabel = conversation.agenteActivo ? 'Activo' : 'HITL';
      const selectedFinca = conversation.selectedFincaName || 'Sin elegir';
      const lastInteraction = formatShortDateTime(conversation.lastInteractionAt);
      const lastMessage = conversation.lastMessage?.content || '';

      return `
        <tr class="monitor-row ${selected ? 'monitor-row--active' : ''}" data-id="${escapeHtml(conversation.waId)}">
          <td>
            <div class="monitor-primary">
              <strong>${escapeHtml(conversation.clientName)}</strong>
              <span>${escapeHtml(conversation.waId)}</span>
              <small>${escapeHtml(lastMessage.slice(0, 96) || 'Sin mensajes')}</small>
            </div>
          </td>
          <td><span class="stage-chip">${escapeHtml(stageChipLabel(conversation))}</span></td>
          <td><span class="monitor-badge ${conversation.agenteActivo ? 'monitor-badge--active' : 'monitor-badge--hitl'}">${escapeHtml(botLabel)}</span></td>
          <td>${escapeHtml(conversation.waitingFor || 'CLIENT')}</td>
          <td>${escapeHtml(selectedFinca)}</td>
          <td>${escapeHtml(followOnLabel)}</td>
          <td>${escapeHtml(lastInteraction)}</td>
        </tr>
      `;
    })
    .join('');

  for (const row of elements.tableBody.querySelectorAll('.monitor-row')) {
    row.addEventListener('click', () => {
      state.selectedConversationId = row.dataset.id;
      renderTable();
      loadConversationDetail(row.dataset.id).catch((error) => {
        window.alert(error.message);
      });
    });
  }
}

function renderDetail() {
  const detail = state.selectedConversation;

  if (!detail) {
    elements.detailTitle.textContent = 'Selecciona una conversación';
    elements.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>Selecciona una conversación para ver contexto, follow ons y mensajes recientes.</p>
      </div>
    `;
    return;
  }

  const conversation = detail.conversation || {};
  const context = conversation.context || {};
  const followOn = detail.followOn || [];
  const messages = detail.messages || [];

  elements.detailTitle.textContent = conversation.client_name || conversation.wa_id || 'Detalle';
  elements.detailBody.innerHTML = `
    <section class="info-card">
      <h3>Resumen</h3>
      <dl class="info-grid">
        <div class="info-row"><dt>Teléfono</dt><dd>${escapeHtml(conversation.wa_id || '-')}</dd></div>
        <div class="info-row"><dt>Chatwoot</dt><dd>${escapeHtml(conversation.chatwoot_id || '-')}</dd></div>
        <div class="info-row"><dt>Etapa</dt><dd>${escapeHtml(conversation.current_state || '-')}</dd></div>
        <div class="info-row"><dt>Esperando</dt><dd>${escapeHtml(conversation.waiting_for || 'CLIENT')}</dd></div>
        <div class="info-row"><dt>Bot activo</dt><dd>${conversation.agente_activo === false ? 'No' : 'Sí'}</dd></div>
        <div class="info-row"><dt>Finca elegida</dt><dd>${escapeHtml(conversation.selected_finca?.nombre || conversation.selected_finca_id || 'Sin elegir')}</dd></div>
      </dl>
    </section>

    <section class="info-card">
      <h3>Follow on</h3>
      ${
        followOn.length
          ? `<div class="monitor-follow-list">
              ${followOn
                .map(
                  (entry) => `
                    <article class="monitor-follow-card">
                      <strong>${escapeHtml(entry.status || 'sin estado')}</strong>
                      <span>${escapeHtml(formatDateTime(entry.scheduledFor || entry.createdAt))}</span>
                      <p>${escapeHtml(entry.message || 'Sin mensaje')}</p>
                      <small>${escapeHtml(entry.cancelReason || '')}</small>
                    </article>
                  `,
                )
                .join('')}
            </div>`
          : '<p class="inspector-empty">No hay follow ons registrados.</p>'
      }
    </section>

    <section class="info-card">
      <h3>Mensajes recientes</h3>
      <div class="monitor-message-list">
        ${
          messages.length
            ? messages
                .slice(-12)
                .map(
                  (message) => `
                    <article class="monitor-message-card">
                      <header>
                        <strong>${escapeHtml(message.direction)}</strong>
                        <span>${escapeHtml(formatDateTime(message.createdAt))}</span>
                      </header>
                      <p>${escapeHtml(message.content || '')}</p>
                      <small>${escapeHtml(message.agentUsed || '')}</small>
                    </article>
                  `,
                )
                .join('')
            : '<p class="inspector-empty">No hay mensajes todavía.</p>'
        }
      </div>
    </section>

    <section class="info-card">
      <h3>Contexto completo</h3>
      <pre class="json-block">${escapeHtml(JSON.stringify(context, null, 2))}</pre>
    </section>
  `;
}

async function loadConversationDetail(waId) {
  const detail = await api(`/api/monitoring/conversations/${encodeURIComponent(waId)}`);
  state.selectedConversation = detail;
  renderDetail();
}

async function loadMonitoringData() {
  const query = buildQueryString();
  const payload = await api(`/api/monitoring${query ? `?${query}` : ''}`);
  state.summary = payload.summary;
  state.conversations = payload.conversations;
  state.timezone = payload.timezone || state.timezone;
  state.businessHours = payload.businessHours || state.businessHours;
  elements.hours.textContent = `${payload.businessHours.start}-${payload.businessHours.end} · ${payload.timezone}`;

  if (!state.selectedConversationId && state.conversations[0]) {
    state.selectedConversationId = state.conversations[0].waId;
  }

  if (state.selectedConversationId && !state.conversations.some((item) => item.waId === state.selectedConversationId)) {
    state.selectedConversationId = state.conversations[0]?.waId || null;
    state.selectedConversation = null;
  }

  renderSummary();
  renderTable();

  if (state.selectedConversationId) {
    await loadConversationDetail(state.selectedConversationId);
  } else {
    state.selectedConversation = null;
    renderDetail();
  }
}

function bindFilters() {
  const sync = () => {
    state.filters.search = elements.search.value.trim().toLowerCase();
    state.filters.timeframe = elements.timeframe.value;
    state.filters.agent = elements.agent.value;
    state.filters.waitingFor = elements.waiting.value;
    state.filters.converted = elements.converted.value;
    state.filters.followOn = elements.followOn.value;
    loadMonitoringData().catch((error) => window.alert(error.message));
  };

  for (const element of [
    elements.search,
    elements.timeframe,
    elements.agent,
    elements.waiting,
    elements.converted,
    elements.followOn,
  ]) {
    element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', sync);
  }
}

bindFilters();
loadMonitoringData().catch((error) => {
  elements.detailBody.innerHTML = `
    <div class="inspector-empty">
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
});
