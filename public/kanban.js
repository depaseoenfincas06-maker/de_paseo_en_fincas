/* ═══════════════════════════════════════════════════
   Kanban Pipeline — De Paseo en Fincas
   Vanilla JS, no dependencies
   ═══════════════════════════════════════════════════ */

const CHATWOOT_BASE = 'https://chatwoot-9qe1j-u48275.vm.elestio.app/app/accounts/1/conversations';
const REFRESH_MS = 30_000;
const STATES = ['QUALIFYING', 'OFFERING', 'VERIFYING_AVAILABILITY', 'NEGOTIATING', 'HITL', 'CLOSED', 'LOST'];
const STATE_LABELS = {
  QUALIFYING: 'Qualifying',
  OFFERING: 'Offering',
  VERIFYING_AVAILABILITY: 'Verificando',
  NEGOTIATING: 'Negociando',
  HITL: 'HITL',
  CLOSED: 'Cerrado',
  LOST: 'Perdido',
};

let allConversations = [];
let selectedWaId = null;
let refreshTimer = null;

// ── DOM refs ──
const $board = document.getElementById('kb-board');
const $detail = document.getElementById('kb-detail');
const $detailTitle = document.getElementById('kb-detail-title');
const $detailBody = document.getElementById('kb-detail-body');
const $detailClose = document.getElementById('kb-detail-close');
const $timeframe = document.getElementById('kb-timeframe');
const $refresh = document.getElementById('kb-refresh');

// ── API ──
async function fetchConversations() {
  const tf = $timeframe.value;
  const res = await fetch(`/api/monitoring?timeframe=${tf}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.conversations || [];
}

async function fetchConversationDetail(waId) {
  const res = await fetch(`/api/monitoring/conversations/${encodeURIComponent(waId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Helpers ──
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'ahora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str, len = 80) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function groupByState(conversations) {
  const groups = {};
  for (const st of STATES) groups[st] = [];
  for (const conv of conversations) {
    // HITL conversations go to their own column regardless of state
    if (conv.agenteActivo === false || conv.hitl === true) {
      groups['HITL'].push(conv);
      continue;
    }
    const state = conv.currentState || 'QUALIFYING';
    const bucket = STATES.includes(state) ? state : conv.closedAt ? 'CLOSED' : 'QUALIFYING';
    groups[bucket].push(conv);
  }
  return groups;
}

function countShownFincas(conv) {
  // shown_fincas is an array of finca IDs that have been presented
  const shown = conv.shownFincas || [];
  const total = Array.isArray(shown) ? shown.length : 0;
  const rounds = Math.ceil(total / 3);
  return { total, rounds };
}

// ── Render Board ──
function renderBoard(conversations) {
  allConversations = conversations;
  const grouped = groupByState(conversations);
  $board.innerHTML = '';

  for (const state of STATES) {
    const items = grouped[state] || [];
    const col = document.createElement('div');
    col.className = 'kb-col';
    col.dataset.state = state;

    col.innerHTML = `
      <div class="kb-col__header">
        <div class="kb-col__title">
          <span class="kb-col__dot"></span>
          ${STATE_LABELS[state] || state}
        </div>
        <span class="kb-col__count">${items.length}</span>
      </div>
      <div class="kb-col__body">
        ${items.length === 0 ? '<div class="kb-col__empty">Sin leads</div>' : ''}
      </div>
    `;

    const body = col.querySelector('.kb-col__body');
    for (const conv of items) {
      body.appendChild(renderCard(conv));
    }

    $board.appendChild(col);
  }
}

function renderCard(conv) {
  const card = document.createElement('div');
  card.className = `kb-card${conv.waId === selectedWaId ? ' kb-card--active' : ''}`;
  card.dataset.waid = conv.waId;

  const name = conv.clientName || 'Sin nombre';
  const phone = conv.waId || '';
  const isBot = conv.agenteActivo !== false;
  const waiting = conv.waitingFor;

  // Search criteria tags
  const sc = conv.searchCriteria || {};
  const tags = [];
  if (sc.zona) tags.push(sc.zona);
  if (sc.personas) tags.push(`${sc.personas} pers.`);
  if (sc.fecha_inicio) tags.push(sc.fecha_inicio);

  // Last message
  const lastMsg = conv.lastMessage;
  const msgPreview = lastMsg ? truncate(lastMsg.content, 70) : '';
  const msgTime = lastMsg ? timeAgo(lastMsg.createdAt) : '';

  // Time since first interaction
  const age = timeAgo(conv.lastInteractionAt || conv.createdAt);

  // Finca
  const finca = conv.selectedFincaName || '';

  // Shown fincas count (for offering column)
  const shownFincas = conv.shownFincas || [];
  const shownCount = Array.isArray(shownFincas) ? shownFincas.length : 0;
  const offeringRounds = Math.ceil(shownCount / 3);

  // Chatwoot link
  const chatwootLink = conv.chatwootId ? `${CHATWOOT_BASE}/${conv.chatwootId}` : '';

  card.innerHTML = `
    <div class="kb-card__top">
      <div>
        <div class="kb-card__name">${esc(name)}</div>
        <div class="kb-card__phone">${esc(phone)}</div>
      </div>
      <span class="kb-badge ${isBot ? 'kb-badge--bot' : 'kb-badge--hitl'}">${isBot ? '🤖 Bot' : '👤 HITL'}</span>
    </div>
    ${tags.length ? `<div class="kb-card__criteria">${tags.map(t => `<span class="kb-tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${msgPreview ? `<div class="kb-card__msg">${esc(msgPreview)}</div>` : ''}
    ${shownCount > 0 ? `<div class="kb-card__rounds"><span class="kb-tag kb-tag--rounds">🏠 ${shownCount} fincas mostradas (${offeringRounds} ${offeringRounds === 1 ? 'ronda' : 'rondas'})</span></div>` : ''}
    <div class="kb-card__footer">
      <span class="kb-badge kb-badge--age">⏱ ${age} en pipeline</span>
      ${finca ? `<span class="kb-card__finca">${esc(finca)}</span>` : ''}
    </div>
    ${chatwootLink ? `<a href="${chatwootLink}" target="_blank" rel="noopener" class="kb-card__chatwoot" onclick="event.stopPropagation()">💬 Chatwoot</a>` : ''}
  `;

  card.addEventListener('click', () => openDetail(conv.waId));
  return card;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Detail Panel ──
async function openDetail(waId) {
  selectedWaId = waId;

  // Highlight card
  document.querySelectorAll('.kb-card').forEach(c => {
    c.classList.toggle('kb-card--active', c.dataset.waid === waId);
  });

  $detail.classList.add('kb-detail--open');
  getOverlay().classList.add('kb-overlay--visible');

  const conv = allConversations.find(c => c.waId === waId);
  $detailTitle.textContent = conv ? (conv.clientName || conv.waId) : waId;
  $detailBody.innerHTML = '<p class="kb-detail__empty">Cargando...</p>';

  try {
    const data = await fetchConversationDetail(waId);
    renderDetail(data, conv);
  } catch (e) {
    $detailBody.innerHTML = `<p class="kb-detail__empty">Error: ${esc(e.message)}</p>`;
  }
}

function closeDetail() {
  selectedWaId = null;
  $detail.classList.remove('kb-detail--open');
  getOverlay().classList.remove('kb-overlay--visible');
  document.querySelectorAll('.kb-card--active').forEach(c => c.classList.remove('kb-card--active'));
}

function renderDetail(data, conv) {
  const messages = data.messages || [];
  const sc = conv?.searchCriteria || {};
  const chatwootLink = conv?.chatwootId ? `${CHATWOOT_BASE}/${conv.chatwootId}` : '';

  let html = '';

  // Info grid
  html += `<div class="kb-detail__section">
    <div class="kb-detail__section-title">Información del lead</div>
    <div class="kb-detail__info-grid">
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Estado</div>
        <div class="kb-detail__info-value">${esc(conv?.currentState || '—')}</div>
      </div>
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Teléfono</div>
        <div class="kb-detail__info-value">${esc(conv?.waId || '—')}</div>
      </div>
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Zona</div>
        <div class="kb-detail__info-value">${esc(sc.zona || '—')}</div>
      </div>
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Personas</div>
        <div class="kb-detail__info-value">${sc.personas || '—'}</div>
      </div>
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Fechas</div>
        <div class="kb-detail__info-value">${esc(sc.fecha_inicio || '—')} → ${esc(sc.fecha_fin || '—')}</div>
      </div>
      <div class="kb-detail__info-item">
        <div class="kb-detail__info-label">Finca elegida</div>
        <div class="kb-detail__info-value">${esc(conv?.selectedFincaName || '—')}</div>
      </div>
    </div>
    ${chatwootLink ? `<a href="${chatwootLink}" target="_blank" rel="noopener" class="kb-card__chatwoot" style="margin-top:12px;display:inline-flex">💬 Abrir en Chatwoot</a>` : ''}
  </div>`;

  // Messages
  html += `<div class="kb-detail__section">
    <div class="kb-detail__section-title">Mensajes (${messages.length})</div>`;

  if (messages.length === 0) {
    html += '<p class="kb-detail__empty">Sin mensajes registrados</p>';
  } else {
    for (const msg of messages) {
      const dir = (msg.direction || '').toUpperCase();
      const isInbound = dir === 'INBOUND';
      html += `
        <div class="kb-msg kb-msg--${isInbound ? 'inbound' : 'outbound'}">
          <div class="kb-msg__bubble">${esc(msg.content || '')}</div>
          <div class="kb-msg__meta">${formatDate(msg.createdAt)} · ${esc(msg.agentUsed || dir)}</div>
        </div>`;
    }
  }
  html += '</div>';

  $detailBody.innerHTML = html;
}

function getOverlay() {
  let ov = document.querySelector('.kb-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'kb-overlay';
    ov.addEventListener('click', closeDetail);
    document.body.appendChild(ov);
  }
  return ov;
}

// ── Init ──
async function load() {
  try {
    const convs = await fetchConversations();
    renderBoard(convs);
  } catch (e) {
    $board.innerHTML = `<div class="kb-loading">Error cargando datos: ${esc(e.message)}</div>`;
  }
}

$detailClose.addEventListener('click', closeDetail);
$timeframe.addEventListener('change', load);
$refresh.addEventListener('click', load);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
});

// Initial load + auto refresh
load();
refreshTimer = setInterval(load, REFRESH_MS);
