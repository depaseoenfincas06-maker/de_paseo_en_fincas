const routeToTab = {
  '/': 'simulator',
  '/simulator': 'simulator',
  '/monitoring': 'monitoring',
  '/settings': 'settings',
};

const tabToRoute = {
  simulator: '/simulator',
  monitoring: '/monitoring',
  settings: '/settings',
};

const sendQueueByConversation = new Map();

const appState = {
  activeTab: routeToTab[window.location.pathname] || 'simulator',
  timezone: 'America/Bogota',
  workflow: null,
  chatwootBaseUrl: '',
  chatwootAccountId: '1',
  settings: null,
  settingsLoaded: false,
  settingsDirty: false,
  settingsSaving: false,
  settingsLoadPromise: null,
  simulator: {
    conversations: [],
    activeConversationId: null,
    filter: '',
    pendingByConversation: {},
    pollingByConversation: {},
    nextLocalSequence: 1,
    loaded: false,
  },
  monitoring: {
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
    businessHours: null,
    settingsStatus: null,
    loaded: false,
    loading: false,
  },
};

const elements = {
  tabs: Array.from(document.querySelectorAll('.workspace-tab')),
  views: Array.from(document.querySelectorAll('.view-panel')),
  globalBotBadge: document.getElementById('global-bot-badge'),
  globalFollowupBadge: document.getElementById('global-followup-badge'),
  globalOwnerOverrideBadge: document.getElementById('global-owner-override-badge'),
  globalSelectionNotificationBadge: document.getElementById('global-selection-notification-badge'),
  simulator: {
    list: document.getElementById('conversation-list'),
    thread: document.getElementById('message-thread'),
    inspector: document.getElementById('inspector-body'),
    title: document.getElementById('chat-title'),
    avatar: document.getElementById('chat-avatar'),
    stage: document.getElementById('chat-stage'),
    status: document.getElementById('chat-status'),
    form: document.getElementById('message-form'),
    input: document.getElementById('message-input'),
    send: document.getElementById('send-btn'),
    search: document.getElementById('search-input'),
    create: document.getElementById('new-conversation-btn'),
    template: document.getElementById('conversation-item-template'),
    workflowBadge: document.getElementById('workflow-badge'),
  },
  monitoring: {
    search: document.getElementById('monitor-search'),
    timeframe: document.getElementById('monitor-timeframe'),
    agent: document.getElementById('monitor-agent'),
    waiting: document.getElementById('monitor-waiting'),
    converted: document.getElementById('monitor-converted'),
    followOn: document.getElementById('monitor-follow-on'),
    summary: document.getElementById('monitor-summary'),
    list: document.getElementById('monitor-list'),
    count: document.getElementById('monitor-count'),
    detailTitle: document.getElementById('monitor-detail-title'),
    detailBody: document.getElementById('monitor-detail-body'),
    hours: document.getElementById('monitoring-hours'),
  },
  settings: {
    form: document.getElementById('settings-form'),
    save: document.getElementById('settings-save-btn'),
    saveState: document.getElementById('settings-save-state'),
    alert: document.getElementById('settings-alert'),
    overview: document.getElementById('settings-overview'),
    tonePreset: document.getElementById('settings-tone-preset'),
    toneExtra: document.getElementById('settings-tone-extra'),
    initialMessage: document.getElementById('settings-initial-message'),
    handoffMessage: document.getElementById('settings-handoff-message'),
    ownerOverride: document.getElementById('settings-owner-override'),
    globalBotEnabled: document.getElementById('settings-global-bot'),
    followupEnabled: document.getElementById('settings-followup-enabled'),
    followupStart: document.getElementById('settings-followup-start'),
    followupEnd: document.getElementById('settings-followup-end'),
    followupQualifying: document.getElementById('settings-followup-qualifying'),
    followupOffering: document.getElementById('settings-followup-offering'),
    followupVerifying: document.getElementById('settings-followup-verifying'),
    inventoryEnabled: document.getElementById('settings-inventory-enabled'),
    inventoryDoc: document.getElementById('settings-inventory-doc'),
    inventoryTab: document.getElementById('settings-inventory-tab'),
    coverageZones: document.getElementById('settings-coverage-zones'),
    maxProperties: document.getElementById('settings-max-properties'),
    selectionEnabled: document.getElementById('settings-selection-enabled'),
    selectionRecipients: document.getElementById('settings-selection-recipients'),
    selectionTemplateName: document.getElementById('settings-selection-template-name'),
    selectionTemplateLanguage: document.getElementById('settings-selection-template-language'),
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compactText(value) {
  return String(value ?? '').trim();
}

function enqueueConversationSend(conversationId, task) {
  const previous = sendQueueByConversation.get(conversationId) || Promise.resolve();
  const next = previous.catch(() => null).then(task);
  const settled = next.catch(() => null);

  sendQueueByConversation.set(
    conversationId,
    settled.finally(() => {
      if (sendQueueByConversation.get(conversationId) === settled) {
        sendQueueByConversation.delete(conversationId);
      }
    }),
  );

  return next;
}

function formatDateTime(value, options = {}) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: options.long ? 'short' : 'short',
    ...(options.includeYear ? { year: 'numeric' } : {}),
  }).format(new Date(value));
}

function formatTimeOnly(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateDivider(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function getDateKey(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: appState.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function formatDateTimeLong(value) {
  if (!value) return 'Sin dato';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
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

function stageLabel(value) {
  return value || 'NEW';
}

function initialsFromTitle(title) {
  return String(title || 'AG')
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0] || '')
    .join('')
    .toUpperCase();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || 'Request failed');
  }
  return json;
}

function updateGlobalHeader() {
  const settings = appState.settings;

  if (!settings) {
    elements.globalBotBadge.textContent = 'Cargando configuración';
    elements.globalFollowupBadge.textContent = 'Recordatorios...';
    elements.globalOwnerOverrideBadge.textContent = 'Número real del propietario';
    return;
  }

  elements.globalBotBadge.textContent = settings.globalBotEnabled ? 'Asistente activo' : 'Asistente pausado';
  elements.globalBotBadge.classList.toggle('badge-warn', settings.globalBotEnabled === false);

  elements.globalFollowupBadge.textContent = settings.followupEnabled
    ? `Recordatorios ${settings.followupWindowStart}-${settings.followupWindowEnd}`
    : 'Recordatorios desactivados';
  elements.globalFollowupBadge.classList.toggle('badge-warn', settings.followupEnabled === false);

  elements.globalOwnerOverrideBadge.textContent = settings.ownerContactOverride
    ? `Número de prueba · ${settings.ownerContactOverride}`
    : 'Número real del propietario';
  elements.globalOwnerOverrideBadge.classList.toggle('badge-warn', Boolean(settings.ownerContactOverride));

  elements.globalSelectionNotificationBadge.textContent = settings.selectionNotificationEnabled
    ? 'Avisos internos activos'
    : 'Avisos internos apagados';
  elements.globalSelectionNotificationBadge.classList.toggle(
    'badge-warn',
    settings.selectionNotificationEnabled === false,
  );

  renderSettingsOverview();
}

function renderSettingsOverview() {
  if (!elements.settings.overview) return;

  const settings = appState.settings;
  if (!settings) {
    elements.settings.overview.innerHTML = '';
    return;
  }

  const items = [
    {
      label: 'Asistente',
      value: settings.globalBotEnabled ? 'Activo' : 'Pausado',
      tone: settings.globalBotEnabled ? 'ok' : 'warn',
      helper: settings.globalBotEnabled ? 'Responderá nuevas conversaciones' : 'No responderá nuevos mensajes',
    },
    {
      label: 'Recordatorios',
      value: settings.followupEnabled ? `${settings.followupWindowStart}-${settings.followupWindowEnd}` : 'Apagados',
      tone: settings.followupEnabled ? 'info' : 'warn',
      helper: 'Horario de envío en Bogotá',
    },
    {
      label: 'Propiedades',
      value: settings.inventorySheetEnabled ? 'Base activa' : 'Base desactivada',
      tone: settings.inventorySheetEnabled ? 'ok' : 'warn',
      helper: settings.inventorySheetTabName || 'Sin hoja seleccionada',
    },
    {
      label: 'Número de prueba',
      value: settings.ownerContactOverride ? 'Activo' : 'No se está usando',
      tone: settings.ownerContactOverride ? 'warn' : 'neutral',
      helper: settings.ownerContactOverride || 'Se usará el número real del propietario',
    },
  ];

  elements.settings.overview.innerHTML = items
    .map(
      (item) => `
        <article class="settings-overview-card settings-overview-card--${escapeHtml(item.tone)}">
          <span class="settings-overview-card__label">${escapeHtml(item.label)}</span>
          <strong class="settings-overview-card__value">${escapeHtml(item.value)}</strong>
          <small class="settings-overview-card__helper">${escapeHtml(item.helper)}</small>
        </article>
      `,
    )
    .join('');
}

function setActiveTab(tab, { pushState = true } = {}) {
  appState.activeTab = tab;

  for (const element of elements.tabs) {
    element.classList.toggle('workspace-tab--active', element.dataset.tab === tab);
  }

  for (const view of elements.views) {
    view.classList.toggle('view-panel--active', view.dataset.view === tab);
  }

  if (pushState) {
    window.history.pushState({}, '', tabToRoute[tab] || '/simulator');
  }

  if (tab === 'monitoring' && !appState.monitoring.loaded) {
    void loadMonitoringData();
  }

  if (tab === 'settings' && !appState.settingsLoaded) {
    void loadSettings();
  }
}

function renderSettingsState(label, mode = 'neutral') {
  elements.settings.saveState.textContent = label;
  elements.settings.saveState.classList.toggle('badge-warn', mode === 'warn');
  elements.settings.saveState.classList.toggle('badge-success', mode === 'success');
}

function showSettingsAlert(message, mode = 'info') {
  if (!message) {
    elements.settings.alert.hidden = true;
    elements.settings.alert.textContent = '';
    elements.settings.alert.className = 'settings-alert';
    return;
  }

  elements.settings.alert.hidden = false;
  elements.settings.alert.textContent = message;
  elements.settings.alert.className = `settings-alert settings-alert--${mode}`;
}

function applySettingsToForm(settings) {
  elements.settings.tonePreset.value = settings.tonePreset;
  elements.settings.toneExtra.value = settings.toneGuidelinesExtra || '';
  elements.settings.initialMessage.value = settings.initialMessageTemplate || '';
  elements.settings.handoffMessage.value = settings.handoffMessage || '';
  elements.settings.ownerOverride.value = settings.ownerContactOverride || '';
  elements.settings.globalBotEnabled.checked = settings.globalBotEnabled === true;
  elements.settings.followupEnabled.checked = settings.followupEnabled === true;
  elements.settings.followupStart.value = settings.followupWindowStart || '08:00';
  elements.settings.followupEnd.value = settings.followupWindowEnd || '22:00';
  elements.settings.followupQualifying.value = settings.followupMessageQualifying || '';
  elements.settings.followupOffering.value = settings.followupMessageOffering || '';
  elements.settings.followupVerifying.value = settings.followupMessageVerifyingAvailability || '';
  elements.settings.inventoryEnabled.checked = settings.inventorySheetEnabled === true;
  elements.settings.inventoryDoc.value = settings.inventorySheetDocumentId || '';
  elements.settings.inventoryTab.value = settings.inventorySheetTabName || '';
  elements.settings.coverageZones.value = settings.coverageZonesText || '';
  elements.settings.maxProperties.value = String(settings.maxPropertiesToShow || 3);
  elements.settings.selectionEnabled.checked = settings.selectionNotificationEnabled === true;
  elements.settings.selectionRecipients.value = settings.selectionNotificationRecipients || '';
  elements.settings.selectionTemplateName.value = settings.selectionNotificationTemplateName || '';
  elements.settings.selectionTemplateLanguage.value = settings.selectionNotificationTemplateLanguage || '';
}

function readSettingsForm() {
  return {
    tonePreset: elements.settings.tonePreset.value,
    toneGuidelinesExtra: elements.settings.toneExtra.value,
    initialMessageTemplate: elements.settings.initialMessage.value,
    handoffMessage: elements.settings.handoffMessage.value,
    ownerContactOverride: elements.settings.ownerOverride.value,
    globalBotEnabled: elements.settings.globalBotEnabled.checked,
    followupEnabled: elements.settings.followupEnabled.checked,
    followupWindowStart: elements.settings.followupStart.value,
    followupWindowEnd: elements.settings.followupEnd.value,
    followupMessageQualifying: elements.settings.followupQualifying.value,
    followupMessageOffering: elements.settings.followupOffering.value,
    followupMessageVerifyingAvailability: elements.settings.followupVerifying.value,
    inventorySheetEnabled: elements.settings.inventoryEnabled.checked,
    inventorySheetDocumentId: elements.settings.inventoryDoc.value,
    inventorySheetTabName: elements.settings.inventoryTab.value,
    coverageZonesText: elements.settings.coverageZones.value,
    maxPropertiesToShow: Number(elements.settings.maxProperties.value || 3),
    selectionNotificationEnabled: elements.settings.selectionEnabled.checked,
    selectionNotificationRecipients: elements.settings.selectionRecipients.value,
    selectionNotificationTemplateName: elements.settings.selectionTemplateName.value,
    selectionNotificationTemplateLanguage: elements.settings.selectionTemplateLanguage.value,
  };
}

async function loadSettings({ silent = false } = {}) {
  if (!silent && appState.settingsLoadPromise) return appState.settingsLoadPromise;

  const request = api('/api/settings')
    .then((payload) => {
      appState.timezone = payload.timezone || appState.timezone;
      appState.settings = payload.settings;
      appState.settingsLoaded = true;
      appState.settingsDirty = false;
      applySettingsToForm(payload.settings);
      updateGlobalHeader();
      renderSettingsState('Configuración cargada', 'success');
      if (payload.settings.ownerContactOverride) {
        showSettingsAlert(
          'Hay un número de prueba activo para propietarios. El asistente mostrará ese número en lugar del real.',
          'warn',
        );
      } else if (
        payload.settings.selectionNotificationEnabled &&
        payload.settings.selectionNotificationRecipients
      ) {
        showSettingsAlert(
          'Los avisos internos están activos. El sistema enviará una alerta al equipo cuando un cliente elija una finca.',
          'info',
        );
      } else {
        showSettingsAlert(
          'Los cambios se aplican a nuevas conversaciones y nuevos recordatorios. Los recordatorios ya programados no se modifican.',
          'info',
        );
      }
      return payload.settings;
    })
    .catch((error) => {
      renderSettingsState('Error cargando la configuración', 'warn');
      showSettingsAlert(error.message, 'error');
      throw error;
    })
    .finally(() => {
      appState.settingsLoadPromise = null;
    });

  appState.settingsLoadPromise = request;
  return request;
}

async function saveSettings() {
  appState.settingsSaving = true;
  elements.settings.save.disabled = true;
  renderSettingsState('Guardando cambios...', 'neutral');

  try {
    const payload = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(readSettingsForm()),
    });

    appState.settings = payload.settings;
    appState.settingsDirty = false;
    applySettingsToForm(payload.settings);
    updateGlobalHeader();
    renderSettingsState('Cambios guardados', 'success');
    showSettingsAlert(
      payload.settings.ownerContactOverride
        ? 'Cambios guardados. El número de prueba para propietarios sigue activo.'
        : payload.settings.selectionNotificationEnabled && payload.settings.selectionNotificationRecipients
          ? 'Cambios guardados. Los avisos internos quedaron activos para las nuevas selecciones de finca.'
          : 'Cambios guardados. Se aplicarán a nuevas conversaciones y nuevos recordatorios.',
      payload.settings.ownerContactOverride ? 'warn' : 'success',
    );

    if (appState.monitoring.loaded) {
      void loadMonitoringData();
    }
  } catch (error) {
    renderSettingsState('Error guardando la configuración', 'warn');
    showSettingsAlert(error.message, 'error');
  } finally {
    appState.settingsSaving = false;
    elements.settings.save.disabled = false;
  }
}

function markSettingsDirty() {
  if (!appState.settingsLoaded) return;
  appState.settingsDirty = true;
  renderSettingsState('Cambios sin guardar', 'warn');
}

function getActiveConversation() {
  return (
    appState.simulator.conversations.find((conversation) => conversation.id === appState.simulator.activeConversationId) ||
    null
  );
}

function getBurstStatus(conversation) {
  const burst = conversation?.burstStatus || {};
  return {
    pending: burst.pending === true,
    pendingCount: Number(burst.pendingCount || 0) || 0,
    waitingUntil: burst.waitingUntil || null,
  };
}

function normalizeMessageContent(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getMessageCreatedAt(message) {
  return message?.createdAt || message?.created_at || new Date().toISOString();
}

function getMessageTimestamp(message) {
  const timestamp = Date.parse(getMessageCreatedAt(message));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeMessageRecord(message) {
  return {
    ...message,
    createdAt: getMessageCreatedAt(message),
    content: String(message?.content || ''),
    direction: message?.direction || 'INBOUND',
    messageType: message?.messageType || message?.message_type || 'TEXT',
    stateAtTime: message?.stateAtTime || message?.state_at_time || null,
    agentUsed: message?.agentUsed || message?.agent_used || '',
    localSequence: Number(message?.localSequence || message?.local_sequence || 0) || 0,
  };
}

function compareMessages(left, right) {
  const timeDiff = getMessageTimestamp(left) - getMessageTimestamp(right);
  if (timeDiff !== 0) return timeDiff;

  const directionWeight = { INBOUND: 0, OUTBOUND: 1 };
  const weightDiff = (directionWeight[left.direction] ?? 9) - (directionWeight[right.direction] ?? 9);
  if (weightDiff !== 0) return weightDiff;

  if (Boolean(left.pending) !== Boolean(right.pending)) {
    return left.pending ? 1 : -1;
  }

  const localSequenceDiff = (left.localSequence || 0) - (right.localSequence || 0);
  if (localSequenceDiff !== 0) return localSequenceDiff;

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function getPendingMessagesFor(conversationId) {
  return appState.simulator.pendingByConversation[conversationId] || [];
}

function setPendingMessagesFor(conversationId, messages) {
  const normalized = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (normalized.length) {
    appState.simulator.pendingByConversation[conversationId] = normalized;
    return;
  }
  delete appState.simulator.pendingByConversation[conversationId];
}

function addPendingMessage(conversationId, message) {
  setPendingMessagesFor(conversationId, [...getPendingMessagesFor(conversationId), message]);
}

function updatePendingMessage(conversationId, localId, patch) {
  const messages = getPendingMessagesFor(conversationId);
  if (!messages.length) return;
  setPendingMessagesFor(
    conversationId,
    messages.map((message) => (message.localId === localId ? { ...message, ...patch } : message)),
  );
}

function removePendingMessage(conversationId, localId) {
  setPendingMessagesFor(
    conversationId,
    getPendingMessagesFor(conversationId).filter((message) => message.localId !== localId),
  );
}

function getPollingState(conversationId, { create = false } = {}) {
  const existing = appState.simulator.pollingByConversation[conversationId];
  if (existing || !create) return existing || null;

  const created = {
    running: false,
    timerId: null,
    turns: [],
    attempts: 0,
    lastFingerprint: null,
    quietSince: null,
    hadReply: false,
    hadServerOutbound: false,
    startedAt: Date.now(),
  };
  appState.simulator.pollingByConversation[conversationId] = created;
  return created;
}

function clearConversationPollTimer(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState?.timerId) return;
  clearTimeout(pollState.timerId);
  pollState.timerId = null;
}

function stopConversationPolling(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState) return;
  clearConversationPollTimer(conversationId);
  delete appState.simulator.pollingByConversation[conversationId];
}

function hasActivePollingFor(conversationId) {
  const pollState = getPollingState(conversationId);
  const conversation = appState.simulator.conversations.find((item) => item.id === conversationId);
  const burstPending = getBurstStatus(conversation).pending;
  return Boolean(
    burstPending ||
      (pollState &&
        (pollState.running ||
          pollState.timerId ||
          pollState.turns.length ||
          getPendingMessagesFor(conversationId).length)),
  );
}

function buildMessageFingerprint(messages) {
  return [...messages]
    .slice(-12)
    .map((message) => `${message.id || 'no-id'}|${message.direction}|${getMessageCreatedAt(message)}|${message.content}`)
    .join('||');
}

function reconcilePendingMessages(conversationId, persistedMessages) {
  const pendingMessages = [...getPendingMessagesFor(conversationId)].sort(compareMessages);
  if (!pendingMessages.length) return;

  const persistedInbounds = persistedMessages
    .filter((message) => message.direction === 'INBOUND')
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessages(left.message, right.message));

  const usedServerIndexes = new Set();
  const remaining = [];

  for (const pending of pendingMessages) {
    const pendingText = normalizeMessageContent(pending.content);
    const pendingTimestamp = Date.parse(pending.queuedAt || pending.createdAt || new Date().toISOString());

    const match = persistedInbounds.find(({ message, index }) => {
      if (usedServerIndexes.has(index)) return false;
      if (normalizeMessageContent(message.content) !== pendingText) return false;
      const messageTimestamp = getMessageTimestamp(message);
      return messageTimestamp >= pendingTimestamp - 30000 && messageTimestamp <= pendingTimestamp + 180000;
    });

    if (match) {
      usedServerIndexes.add(match.index);
      continue;
    }

    remaining.push(pending);
  }

  setPendingMessagesFor(conversationId, remaining);
}

function getThreadMessages(conversation) {
  const persisted = (conversation?.messages || []).map(normalizeMessageRecord);
  const pending = getPendingMessagesFor(conversation?.id || '').map((message) => normalizeMessageRecord(message));
  const combined = [...persisted];

  for (const localMessage of pending) {
    const duplicate = persisted.some(
      (message) =>
        message.direction === localMessage.direction &&
        normalizeMessageContent(message.content) === normalizeMessageContent(localMessage.content) &&
        Math.abs(getMessageTimestamp(message) - getMessageTimestamp(localMessage)) <= 180000,
    );

    if (!duplicate) {
      combined.push(localMessage);
    }
  }

  return combined.sort(compareMessages);
}

function upsertConversationSnapshot(snapshot) {
  const conversations = appState.simulator.conversations;
  const index = conversations.findIndex((conversation) => conversation.id === snapshot.id);
  if (index !== -1) {
    conversations.splice(index, 1);
  }
  conversations.unshift(snapshot);
}

function hasAgentOutbound(messages, agentName) {
  return (messages || []).some(
    (message) => message.direction === 'OUTBOUND' && (message.agentUsed || '') === agentName,
  );
}

function requiresExtendedQuietWindow(snapshot, messages) {
  const outbounds = (messages || []).filter((message) => message.direction === 'OUTBOUND');
  const latestOutbound = outbounds.at(-1);
  if (!latestOutbound) return false;

  const stage = snapshot?.stage || '';
  const agent = latestOutbound.agentUsed || '';

  if (stage === 'OFFERING' && agent === 'qualifying_agent') return true;
  if (stage === 'VERIFYING_AVAILABILITY' && agent === 'offering_agent') return true;
  return false;
}

function awaitingFollowupPass(snapshot, messages) {
  const stage = snapshot?.stage || '';
  if (stage === 'OFFERING') {
    return hasAgentOutbound(messages, 'qualifying_agent') && !hasAgentOutbound(messages, 'offering_agent');
  }
  if (stage === 'VERIFYING_AVAILABILITY') {
    return hasAgentOutbound(messages, 'offering_agent') && !hasAgentOutbound(messages, 'verifying_availability_agent');
  }
  return false;
}

function scheduleConversationPoll(conversationId, delay = 1200) {
  const pollState = getPollingState(conversationId, { create: true });
  clearConversationPollTimer(conversationId);
  pollState.timerId = window.setTimeout(() => {
    void pollConversation(conversationId);
  }, delay);
}

async function pollConversation(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState) return;

  clearConversationPollTimer(conversationId);
  pollState.running = true;
  pollState.attempts += 1;

  try {
    const snapshot = await api(`/api/conversations/${conversationId}`);
    upsertConversationSnapshot(snapshot);

    const normalizedMessages = (snapshot.messages || []).map(normalizeMessageRecord).sort(compareMessages);
    reconcilePendingMessages(conversationId, normalizedMessages);
    const burstStatus = getBurstStatus(snapshot);

    const latestOutboundTimestamp = normalizedMessages
      .filter((message) => message.direction === 'OUTBOUND')
      .reduce((latest, message) => Math.max(latest, getMessageTimestamp(message)), 0);

    if (latestOutboundTimestamp) {
      pollState.hadServerOutbound = true;
    }

    for (const turn of pollState.turns) {
      const turnTimestamp = Date.parse(turn.queuedAt || turn.createdAt || new Date().toISOString());
      if (latestOutboundTimestamp && latestOutboundTimestamp >= turnTimestamp - 1000) {
        turn.repliedAt = latestOutboundTimestamp;
      }
    }

    if (pollState.turns.some((turn) => Boolean(turn.repliedAt))) {
      pollState.hadReply = true;
    }

    pollState.turns = pollState.turns.filter((turn) => !turn.repliedAt);

    const fingerprint = buildMessageFingerprint(normalizedMessages);
    if (fingerprint !== pollState.lastFingerprint) {
      pollState.lastFingerprint = fingerprint;
      pollState.quietSince = Date.now();
    } else if (!pollState.quietSince) {
      pollState.quietSince = Date.now();
    }

    renderSimulator();

    const hasPending = getPendingMessagesFor(conversationId).length > 0;
    const hasOutstandingTurns = pollState.turns.length > 0;
    const quietWindowMs = requiresExtendedQuietWindow(snapshot, normalizedMessages) ? 18000 : 5000;
    const quietEnoughAfterReply = Boolean(
      pollState.hadServerOutbound &&
        !awaitingFollowupPass(snapshot, normalizedMessages) &&
        pollState.quietSince &&
        Date.now() - pollState.quietSince >= quietWindowMs,
    );
    const pollingTimedOut = Date.now() - pollState.startedAt >= 120000;

    if ((!burstStatus.pending && !hasPending && !hasOutstandingTurns && quietEnoughAfterReply) || pollingTimedOut) {
      stopConversationPolling(conversationId);
      renderSimulator();
      return;
    }

    scheduleConversationPoll(conversationId, burstStatus.pending ? 650 : 1100);
  } catch {
    if (pollState.attempts >= 120) {
      stopConversationPolling(conversationId);
      renderSimulator();
      return;
    }

    scheduleConversationPoll(conversationId, 1800);
  } finally {
    const current = getPollingState(conversationId);
    if (current) current.running = false;
  }
}

function renderConversationList() {
  const filter = appState.simulator.filter.trim().toLowerCase();
  const conversations = appState.simulator.conversations.filter((conversation) => {
    const preview = getThreadMessages(conversation).at(-1)?.content || conversation.lastMessage?.content || '';
    if (!filter) return true;
    return (
      conversation.title.toLowerCase().includes(filter) ||
      stageLabel(conversation.stage).toLowerCase().includes(filter) ||
      String(preview).toLowerCase().includes(filter)
    );
  });

  elements.simulator.list.innerHTML = '';

  for (const conversation of conversations) {
    const threadMessages = getThreadMessages(conversation);
    const previewMessage = threadMessages.at(-1)?.content || conversation.lastMessage?.content || 'Sin mensajes todavía';
    const previewTime = threadMessages.at(-1)?.createdAt || conversation.updatedAt || conversation.createdAt;
    const node = elements.simulator.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = conversation.id;
    node.classList.toggle('is-active', conversation.id === appState.simulator.activeConversationId);
    node.querySelector('.conversation-item__avatar').textContent = initialsFromTitle(conversation.title);
    node.querySelector('.conversation-item__title').textContent = conversation.title;
    node.querySelector('.conversation-item__time').textContent = formatDateTime(previewTime);
    node.querySelector('.conversation-item__preview').textContent = previewMessage;
    node.querySelector('.conversation-item__stage').textContent = stageLabel(conversation.stage);
    node.addEventListener('click', () => {
      appState.simulator.activeConversationId = conversation.id;
      renderSimulator();
    });
    elements.simulator.list.appendChild(node);
  }
}

function renderSimulatorThread() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>Selecciona una conversación</h3>
          <p>Crea pruebas nuevas y revisa cómo cambia la etapa del agente en cada turno.</p>
        </div>
      </div>
    `;
    return;
  }

  const messages = getThreadMessages(conversation);
  const wasNearBottom =
    elements.simulator.thread.scrollHeight -
      elements.simulator.thread.scrollTop -
      elements.simulator.thread.clientHeight <
    120;

  if (!messages.length) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>${escapeHtml(conversation.title)}</h3>
          <p>Escribe el primer mensaje para iniciar la conversación con el agente.</p>
        </div>
      </div>
    `;
    return;
  }

  const blocks = [];
  let lastDateKey = '';
  let lastTimestamp = 0;

  for (const message of messages) {
    const messageTimestamp = getMessageTimestamp(message);
    const dateKey = getDateKey(message.createdAt);

    if (dateKey && dateKey !== lastDateKey) {
      blocks.push(`
        <div class="thread-divider">
          <span class="thread-divider__label">${escapeHtml(formatDateDivider(message.createdAt))}</span>
        </div>
      `);
      lastDateKey = dateKey;
    } else if (lastTimestamp && messageTimestamp - lastTimestamp > 30 * 60 * 1000) {
      blocks.push(`
        <div class="thread-divider thread-divider--gap">
          <span class="thread-divider__label">Nueva actividad · ${escapeHtml(formatTimeOnly(message.createdAt))}</span>
        </div>
      `);
    }

      const outbound = message.direction === 'OUTBOUND';
      const bubbleClass = outbound ? 'message-bubble--outbound' : 'message-bubble--inbound';
      const rowClass = outbound ? 'bubble-row--outbound' : '';
      const meta = [
        formatTimeOnly(message.createdAt),
        message.agentUsed,
        message.pending
          ? message.status === 'sending'
            ? 'enviando…'
            : message.status === 'queued'
              ? 'en cola'
              : 'pendiente'
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

      blocks.push(`
        <div class="bubble-row ${rowClass}">
          <article class="message-bubble ${bubbleClass}">
            <div>${escapeHtml(message.content || '').replace(/\n/g, '<br>')}</div>
            <footer class="message-bubble__meta">
              <span>${escapeHtml(meta)}</span>
            </footer>
          </article>
        </div>
      `);

    lastTimestamp = messageTimestamp;
  }

  const typingIndicator = hasActivePollingFor(conversation.id)
    ? `
      <div class="bubble-row">
        <article class="message-bubble message-bubble--typing">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <footer class="message-bubble__meta">
            <span>${
              getBurstStatus(conversation).pendingCount > 1
                ? `Asistente respondiendo a ${getBurstStatus(conversation).pendingCount} mensajes...`
                : 'Asistente respondiendo...'
            }</span>
          </footer>
        </article>
      </div>
    `
    : '';

  elements.simulator.thread.innerHTML = `<div class="message-group">${blocks.join('')}${typingIndicator}</div>`;
  if (wasNearBottom || hasActivePollingFor(conversation.id)) {
    elements.simulator.thread.scrollTop = elements.simulator.thread.scrollHeight;
  }
}

function renderSimulatorHeader() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.title.textContent = 'Selecciona una conversación';
    elements.simulator.avatar.textContent = 'AG';
    elements.simulator.stage.textContent = 'NEW';
    elements.simulator.status.textContent = 'Sin actividad';
    return;
  }

  const burstStatus = getBurstStatus(conversation);

  elements.simulator.title.textContent = conversation.title;
  elements.simulator.avatar.textContent = initialsFromTitle(conversation.title);
  elements.simulator.stage.textContent = stageLabel(conversation.stage);
  elements.simulator.status.textContent =
    burstStatus.pending
      ? burstStatus.pendingCount > 1
        ? `Agrupando ${burstStatus.pendingCount} mensajes del cliente`
        : 'Procesando el último mensaje del cliente'
      : getPendingMessagesFor(conversation.id).length || hasActivePollingFor(conversation.id)
        ? 'Agente respondiendo...'
      : conversation.agenteActivo === false
        ? 'HITL activo'
        : `Esperando: ${conversation.waitingFor || 'CLIENT'}`;
}

function renderSimulatorInspector() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.inspector.innerHTML = `
      <div class="inspector-empty">
        <p>Selecciona una conversación para ver la etapa, la finca elegida y el contexto completo.</p>
      </div>
    `;
    return;
  }

  const context = conversation.context || {};
  const operationalRecord = context.operational_record || conversation.conversationRow || {};
  const searchCriteria = context.search_criteria || {};
  const selectedFinca = context.selected_finca || null;
  const ownerResponse = context.owner_response || null;
  const pricing = context.pricing || {};
  const followup = context.followup || {};
  const selectedFincaLabel =
    selectedFinca?.nombre || selectedFinca?.finca_id || context.selected_finca_id || 'Sin elegir';
  const ownerStatus = ownerResponse
    ? ownerResponse.disponible === true
      ? 'Disponible'
      : ownerResponse.disponible === false
        ? 'No disponible'
        : 'Con respuesta'
    : 'Sin respuesta';
  const nextFollowup =
    followup.next_followup_at ? formatDateTimeLong(followup.next_followup_at) : 'Sin recordatorio';
  const burstStatus = getBurstStatus(conversation);
  const hasContextData = Object.keys(searchCriteria).length > 0 || Boolean(selectedFinca);

  elements.simulator.inspector.innerHTML = `
    <section class="info-card">
      <h3>Resumen</h3>
      <dl class="info-grid">
        <div class="info-row"><dt>Etapa</dt><dd>${escapeHtml(stageLabel(conversation.stage))}</dd></div>
        <div class="info-row"><dt>Esperando</dt><dd>${escapeHtml(conversation.waitingFor || 'CLIENT')}</dd></div>
        <div class="info-row"><dt>Bot activo</dt><dd>${conversation.agenteActivo === false ? 'No' : 'Sí'}</dd></div>
        <div class="info-row"><dt>Finca elegida</dt><dd>${escapeHtml(selectedFincaLabel)}</dd></div>
        <div class="info-row"><dt>Propietario</dt><dd>${escapeHtml(ownerStatus)}</dd></div>
        <div class="info-row"><dt>Próximo recordatorio</dt><dd>${escapeHtml(nextFollowup)}</dd></div>
        <div class="info-row"><dt>Ráfaga pendiente</dt><dd>${escapeHtml(
          burstStatus.pending
            ? burstStatus.pendingCount > 1
              ? `${burstStatus.pendingCount} mensajes`
              : 'Sí'
            : 'No',
        )}</dd></div>
        <div class="info-row"><dt>Última actividad</dt><dd>${escapeHtml(
          formatDateTimeLong(conversation.updatedAt || conversation.createdAt),
        )}</dd></div>
      </dl>
    </section>

    <section class="info-card info-card--context">
      <h3>Contexto</h3>
      <div class="context-list">
        ${Object.entries(searchCriteria)
          .filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
          .map(
            ([key, value]) =>
              `<span class="context-chip">${escapeHtml(key)}: ${
                Array.isArray(value)
                  ? escapeHtml(value.join(', '))
                  : escapeHtml(JSON.stringify(value).replace(/^"|"$/g, ''))
              }</span>`,
          )
          .join('') || '<span class="context-chip">Sin criterios confirmados todavía</span>'}
      </div>
      <details open class="json-panel">
        <summary>Ver contexto completo</summary>
        <pre class="json-block json-block--tall">${escapeHtml(
          JSON.stringify(context, null, 2),
        )}</pre>
      </details>
    </section>

    <section class="info-card info-card--context">
      <h3>Registro operativo</h3>
      ${
        hasContextData
          ? `
            <dl class="info-grid info-grid--compact">
              <div class="info-row"><dt>ID conversación</dt><dd>${escapeHtml(conversation.id)}</dd></div>
              <div class="info-row"><dt>Chatwoot</dt><dd>${escapeHtml(String(context.chatwoot?.conversation_id || '-'))}</dd></div>
              <div class="info-row"><dt>Precio</dt><dd>${escapeHtml(
                pricing.precio_noche ? `$${pricing.precio_noche}` : 'Sin precio confirmado',
              )}</dd></div>
              <div class="info-row"><dt>Noches</dt><dd>${escapeHtml(String(pricing.noches || '-'))}</dd></div>
            </dl>
          `
          : '<p class="inspector-empty">Todavía no hay suficiente contexto operativo para mostrar.</p>'
      }
      <details class="json-panel">
        <summary>Ver registro de base de datos</summary>
        <pre class="json-block json-block--tall">${escapeHtml(
          JSON.stringify(operationalRecord, null, 2),
        )}</pre>
      </details>
      <details class="json-panel">
        <summary>Ver pricing y respuesta del propietario</summary>
        <pre class="json-block">${escapeHtml(
          JSON.stringify(
            {
              pricing,
              owner_response: ownerResponse,
            },
            null,
            2,
          ),
        )}</pre>
      </details>
    </section>
  `;
}

function renderSimulator() {
  elements.simulator.workflowBadge.textContent = appState.workflow
    ? `${appState.workflow.workflowName} · ${appState.workflow.workflowId}`
    : 'Simulación real contra n8n';

  renderConversationList();
  renderSimulatorHeader();
  renderSimulatorThread();
  renderSimulatorInspector();

  elements.simulator.input.disabled = !appState.simulator.activeConversationId;
  elements.simulator.send.disabled = !appState.simulator.activeConversationId || !elements.simulator.input.value.trim();
}

async function bootstrapSimulator() {
  const payload = await api('/api/bootstrap');
  appState.workflow = payload.workflow;
  appState.chatwootBaseUrl = payload.chatwootBaseUrl || '';
  appState.chatwootAccountId = String(payload.chatwootAccountId || '1');
  appState.simulator.conversations = payload.conversations;
  appState.simulator.activeConversationId = payload.conversations[0]?.id || null;
  appState.simulator.loaded = true;
  appState.settings = payload.settings;
  appState.settingsLoaded = true;
  appState.timezone = payload.timezone || 'America/Bogota';
  applySettingsToForm(payload.settings);
  updateGlobalHeader();
  renderSettingsState('Configuración cargada', 'success');
  renderSimulator();
}

async function reloadConversations() {
  appState.simulator.conversations = await api('/api/conversations');
  if (!appState.simulator.activeConversationId && appState.simulator.conversations.length) {
    appState.simulator.activeConversationId = appState.simulator.conversations[0].id;
  }
  renderSimulator();
}

async function createConversation() {
  const snapshot = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  upsertConversationSnapshot(snapshot);
  appState.simulator.activeConversationId = snapshot.id;
  renderSimulator();
  elements.simulator.input.focus();
}

function autoResizeTextarea() {
  elements.simulator.input.style.height = '0px';
  const nextHeight = Math.max(54, Math.min(elements.simulator.input.scrollHeight, 180));
  elements.simulator.input.style.height = `${nextHeight}px`;
  elements.simulator.send.disabled = !appState.simulator.activeConversationId || !elements.simulator.input.value.trim();
}

async function sendMessage(event) {
  event.preventDefault();
  const conversation = getActiveConversation();
  const text = elements.simulator.input.value.trim();

  if (!conversation || !text) return;

  const localId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const localSequence = appState.simulator.nextLocalSequence++;

  addPendingMessage(conversation.id, {
    id: localId,
    localId,
    clientMessageId: localId,
    direction: 'INBOUND',
    content: text,
    messageType: 'TEXT',
    stateAtTime: conversation.stage || 'NEW',
    agentUsed: 'USER',
    createdAt,
    localSequence,
    pending: true,
    status: 'sending',
  });
  elements.simulator.input.value = '';
  autoResizeTextarea();
  renderSimulator();

  try {
    const payload = await enqueueConversationSend(conversation.id, () =>
      api(`/api/conversations/${conversation.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, clientMessageId: localId, localSequence }),
      }),
    );

    const queuedAt = payload.queuedAt || new Date().toISOString();
    updatePendingMessage(conversation.id, localId, {
      status: 'queued',
      queuedAt,
    });

    const pollState = getPollingState(conversation.id, { create: true });
    pollState.turns.push({
      localId,
      text,
      createdAt,
      queuedAt,
      localSequence,
    });

    scheduleConversationPoll(conversation.id, 250);
    renderSimulator();
    return;
  } catch (error) {
    removePendingMessage(conversation.id, localId);
    if (!elements.simulator.input.value.trim()) {
      elements.simulator.input.value = text;
    }
    autoResizeTextarea();
    renderSimulator();
    window.alert(error.message);
  }
}

function buildMonitoringQueryString() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(appState.monitoring.filters)) {
    if (value && value !== 'all') {
      params.set(key, value);
    } else if (key === 'search' && value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function renderMonitoringSummary() {
  const summary = appState.monitoring.summary || {
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

  elements.monitoring.summary.innerHTML = cards
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

function renderMonitoringTable() {
  elements.monitoring.count.textContent = `${appState.monitoring.conversations.length} conversaciones`;

  if (!appState.monitoring.conversations.length) {
    elements.monitoring.list.innerHTML = `
      <div class="inspector-empty">
        <p>No hay conversaciones para los filtros seleccionados.</p>
      </div>
    `;
    return;
  }

  elements.monitoring.list.innerHTML = appState.monitoring.conversations
    .map((conversation) => {
      const selected = conversation.waId === appState.monitoring.selectedConversationId;
      const followOn = conversation.followOn;
      const followOnLabel = followOn
        ? `${followOn.status} · ${formatCountdown(followOn.remainingMs)}`
        : 'Sin follow on';
      const botLabel = conversation.agenteActivo ? 'Activo' : 'HITL';
      const selectedFinca = conversation.selectedFincaName || 'Sin elegir';
      const lastInteraction = formatDateTime(conversation.lastInteractionAt);
      const lastMessage = conversation.lastMessage?.content || '';

      return `
        <button class="monitor-list-item ${selected ? 'monitor-list-item--active' : ''}" data-id="${escapeHtml(conversation.waId)}">
          <div class="monitor-list-item__main">
            <div class="monitor-primary">
              <strong>${escapeHtml(conversation.clientName)}</strong>
              <span>${escapeHtml(conversation.waId)}</span>
            </div>
            <p class="monitor-list-item__preview">${escapeHtml(lastMessage.slice(0, 140) || 'Sin mensajes')}</p>
          </div>
          <div class="monitor-list-item__meta">
            <div class="monitor-list-item__chips">
              <span class="stage-chip">${escapeHtml(conversation.currentState || 'NEW')}</span>
              <span class="monitor-badge ${conversation.agenteActivo ? 'monitor-badge--active' : 'monitor-badge--hitl'}">${escapeHtml(botLabel)}</span>
            </div>
            <div class="monitor-list-item__facts">
              <span>Esperando: ${escapeHtml(conversation.waitingFor || 'CLIENT')}</span>
              <span>Finca: ${escapeHtml(selectedFinca)}</span>
              <span>${escapeHtml(followOnLabel)}</span>
            </div>
            <span class="monitor-list-item__time">${escapeHtml(lastInteraction)}</span>
          </div>
        </button>
      `;
    })
    .join('');

  for (const row of elements.monitoring.list.querySelectorAll('.monitor-list-item')) {
    row.addEventListener('click', () => {
      appState.monitoring.selectedConversationId = row.dataset.id;
      renderMonitoringTable();
      void loadConversationDetail(row.dataset.id);
    });
  }
}

function renderMonitoringDetail() {
  const detail = appState.monitoring.selectedConversation;

  if (!detail) {
    elements.monitoring.detailTitle.textContent = 'Selecciona una conversación';
    elements.monitoring.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>Haz click en una conversación para ver un resumen operativo y abrirla en Chatwoot.</p>
      </div>
    `;
    return;
  }

  const conversation = detail.conversation || {};
  const settingsStatus = detail.settingsStatus || appState.monitoring.settingsStatus || {};
  const selectedFincaName = conversation.selected_finca?.nombre || conversation.selected_finca_id || 'Sin elegir';
  const chatwootUrl =
    appState.chatwootBaseUrl && conversation.chatwoot_id
      ? `${String(appState.chatwootBaseUrl).replace(/\/$/, '')}/app/accounts/${encodeURIComponent(appState.chatwootAccountId)}/conversations/${encodeURIComponent(conversation.chatwoot_id)}`
      : null;

  elements.monitoring.detailTitle.textContent = conversation.client_name || conversation.wa_id || 'Detalle';
  elements.monitoring.detailBody.innerHTML = `
    <section class="info-card">
      <h3>Resumen</h3>
      <dl class="info-grid">
        <div class="info-row"><dt>Teléfono</dt><dd>${escapeHtml(conversation.wa_id || '-')}</dd></div>
        <div class="info-row"><dt>Chatwoot</dt><dd>${escapeHtml(conversation.chatwoot_id || '-')}</dd></div>
        <div class="info-row"><dt>Etapa</dt><dd>${escapeHtml(conversation.current_state || '-')}</dd></div>
        <div class="info-row"><dt>Esperando</dt><dd>${escapeHtml(conversation.waiting_for || 'CLIENT')}</dd></div>
        <div class="info-row"><dt>Bot activo</dt><dd>${conversation.agente_activo === false ? 'No' : 'Sí'}</dd></div>
        <div class="info-row"><dt>Finca elegida</dt><dd>${escapeHtml(selectedFincaName)}</dd></div>
        <div class="info-row"><dt>Override propietario</dt><dd>${settingsStatus.ownerContactOverrideActive ? 'Activo' : 'No'}</dd></div>
      </dl>
      <div class="monitor-detail-actions">
        ${
          chatwootUrl
            ? `<a class="primary-btn monitor-detail-link" href="${escapeHtml(chatwootUrl)}" target="_blank" rel="noreferrer">Abrir en Chatwoot</a>`
            : `<span class="chat-panel__badge">Sin link disponible de Chatwoot</span>`
        }
      </div>
    </section>
  `;
}

async function loadConversationDetail(waId) {
  try {
    elements.monitoring.detailTitle.textContent = 'Cargando detalle...';
    elements.monitoring.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>Cargando conversación...</p>
      </div>
    `;
    const detail = await api(`/api/monitoring/conversations/${encodeURIComponent(waId)}`);
    appState.monitoring.selectedConversation = detail;
    renderMonitoringDetail();
  } catch (error) {
    window.alert(error.message);
  }
}

async function loadMonitoringData() {
  if (appState.monitoring.loading) return;
  appState.monitoring.loading = true;

  try {
    const query = buildMonitoringQueryString();
    const payload = await api(`/api/monitoring${query ? `?${query}` : ''}`);
    appState.monitoring.summary = payload.summary;
    appState.monitoring.conversations = payload.conversations;
    appState.monitoring.businessHours = payload.businessHours || appState.monitoring.businessHours;
    appState.monitoring.settingsStatus = payload.settingsStatus || null;
    appState.monitoring.loaded = true;
    appState.timezone = payload.timezone || appState.timezone;
    elements.monitoring.hours.textContent = `${payload.businessHours.start}-${payload.businessHours.end} · ${payload.timezone}`;

    if (
      appState.monitoring.selectedConversationId &&
      !appState.monitoring.conversations.some((item) => item.waId === appState.monitoring.selectedConversationId)
    ) {
      appState.monitoring.selectedConversationId = null;
      appState.monitoring.selectedConversation = null;
    }

    renderMonitoringSummary();
    renderMonitoringTable();

    if (appState.monitoring.selectedConversationId) {
      await loadConversationDetail(appState.monitoring.selectedConversationId);
    } else {
      appState.monitoring.selectedConversation = null;
      renderMonitoringDetail();
    }
  } catch (error) {
    elements.monitoring.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  } finally {
    appState.monitoring.loading = false;
  }
}

function bindSimulator() {
  elements.simulator.form.addEventListener('submit', sendMessage);
  elements.simulator.create.addEventListener('click', () => {
    void createConversation();
  });
  elements.simulator.search.addEventListener('input', (event) => {
    appState.simulator.filter = event.target.value || '';
    renderConversationList();
  });
  elements.simulator.input.addEventListener('input', autoResizeTextarea);
  elements.simulator.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.simulator.form.requestSubmit();
    }
  });
}

function bindMonitoring() {
  const sync = () => {
    appState.monitoring.filters.search = elements.monitoring.search.value.trim().toLowerCase();
    appState.monitoring.filters.timeframe = elements.monitoring.timeframe.value;
    appState.monitoring.filters.agent = elements.monitoring.agent.value;
    appState.monitoring.filters.waitingFor = elements.monitoring.waiting.value;
    appState.monitoring.filters.converted = elements.monitoring.converted.value;
    appState.monitoring.filters.followOn = elements.monitoring.followOn.value;
    void loadMonitoringData();
  };

  for (const element of [
    elements.monitoring.search,
    elements.monitoring.timeframe,
    elements.monitoring.agent,
    elements.monitoring.waiting,
    elements.monitoring.converted,
    elements.monitoring.followOn,
  ]) {
    element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', sync);
  }
}

function bindSettings() {
  elements.settings.form.addEventListener('input', markSettingsDirty);
  elements.settings.form.addEventListener('change', markSettingsDirty);
  elements.settings.save.addEventListener('click', (event) => {
    event.preventDefault();
    void saveSettings();
  });
}

function bindTabs() {
  for (const tab of elements.tabs) {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveTab(tab.dataset.tab);
    });
  }

  window.addEventListener('popstate', () => {
    setActiveTab(routeToTab[window.location.pathname] || 'simulator', { pushState: false });
  });
}

async function init() {
  bindTabs();
  bindSimulator();
  bindMonitoring();
  bindSettings();

  try {
    await bootstrapSimulator();
  } catch (error) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>No pude iniciar el simulador</h3>
          <p>${escapeHtml(error.message)}</p>
        </div>
      </div>
    `;
  }

  setActiveTab(appState.activeTab, { pushState: false });
  autoResizeTextarea();

  if (appState.activeTab === 'monitoring') {
    void loadMonitoringData();
  }

  if (appState.activeTab === 'settings' && !appState.settingsLoaded) {
    void loadSettings();
  }
}

void init();
