#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / "current_workflow.json"
SENDER_PATH = ROOT / "chatwoot_outbound_sender_workflow.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def find_node(workflow: dict, name: str) -> dict:
    for node in workflow["nodes"]:
        if node["name"] == name:
            return node
    raise RuntimeError(f"Node not found: {name}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Could not find expected block for {label}")
    return text.replace(old, new, 1)


def ensure_assignment(assignments: list[dict], name: str, value: str, typ: str = "string") -> None:
    for assignment in assignments:
        if assignment.get("name") == name:
            assignment["value"] = value
            assignment["type"] = typ
            return
    assignments.append(
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "value": value,
            "type": typ,
        }
    )


def append_ai_tool_connection(workflow: dict, source: str, target: str) -> None:
    conn = workflow.setdefault("connections", {}).setdefault(source, {}).setdefault("ai_tool", [[]])
    bucket = conn[0]
    if not any(item.get("node") == target for item in bucket):
        bucket.append({"node": target, "type": "ai_tool", "index": 0})


def patch_get_agent_settings_query(query: str) -> str:
    query = replace_once(
        query,
        "    'calido_profesional'::text as tone_preset,\n    ''::text as tone_guidelines_extra,\n",
        "    'calido_profesional'::text as tone_preset,\n"
        "    ''::text as tone_guidelines_extra,\n"
        "    ''::text as public_app_base_url,\n"
        "    ''::text as global_prompt_addendum,\n"
        "    ''::text as qualifying_prompt_addendum,\n"
        "    ''::text as offering_prompt_addendum,\n"
        "    ''::text as verifying_availability_prompt_addendum,\n"
        "    ''::text as qa_prompt_addendum,\n"
        "    ''::text as hitl_prompt_addendum,\n"
        "    ''::text as confirming_reservation_prompt_addendum,\n",
        "workflow settings defaults",
    )
    query = replace_once(
        query,
        "    'Te voy a pasar con un asesor humano para continuar con tu solicitud.'::text as handoff_message,\n"
        "    null::text as owner_contact_override,\n",
        "    'Te voy a pasar con un asesor humano para continuar con tu solicitud.'::text as handoff_message,\n"
        "    ''::text as company_knowledge,\n"
        "    '[]'::jsonb as company_documents,\n"
        "    '[{\"method\":\"Bancolombia\",\"description\":\"Transferencia o consignación\",\"surcharge\":\"\"},{\"method\":\"Davivienda\",\"description\":\"Transferencia o consignación\",\"surcharge\":\"\"},{\"method\":\"Colpatria\",\"description\":\"Transferencia o consignación\",\"surcharge\":\"\"},{\"method\":\"Nequi\",\"description\":\"Transferencia inmediata\",\"surcharge\":\"\"},{\"method\":\"Daviplata\",\"description\":\"Transferencia inmediata\",\"surcharge\":\"\"},{\"method\":\"Tarjeta Crédito/Débito/PSE\",\"description\":\"Pasarela digital\",\"surcharge\":\"+5%\"},{\"method\":\"Efectivo\",\"description\":\"Pago presencial en sedes de Anapoima o Pereira\",\"surcharge\":\"\"}]'::jsonb as payment_methods,\n"
        "    null::text as owner_contact_override,\n",
        "workflow settings company defaults",
    )
    query = replace_once(
        query,
        "select\n  coalesce(s.tone_preset, d.tone_preset) as tone_preset,\n  coalesce(s.tone_guidelines_extra, d.tone_guidelines_extra) as tone_guidelines_extra,\n",
        "select\n"
        "  coalesce(s.tone_preset, d.tone_preset) as tone_preset,\n"
        "  coalesce(s.tone_guidelines_extra, d.tone_guidelines_extra) as tone_guidelines_extra,\n"
        "  coalesce(s.public_app_base_url, d.public_app_base_url) as public_app_base_url,\n"
        "  coalesce(s.global_prompt_addendum, d.global_prompt_addendum) as global_prompt_addendum,\n"
        "  coalesce(s.qualifying_prompt_addendum, d.qualifying_prompt_addendum) as qualifying_prompt_addendum,\n"
        "  coalesce(s.offering_prompt_addendum, d.offering_prompt_addendum) as offering_prompt_addendum,\n"
        "  coalesce(s.verifying_availability_prompt_addendum, d.verifying_availability_prompt_addendum) as verifying_availability_prompt_addendum,\n"
        "  coalesce(s.qa_prompt_addendum, d.qa_prompt_addendum) as qa_prompt_addendum,\n"
        "  coalesce(s.hitl_prompt_addendum, d.hitl_prompt_addendum) as hitl_prompt_addendum,\n"
        "  coalesce(s.confirming_reservation_prompt_addendum, d.confirming_reservation_prompt_addendum) as confirming_reservation_prompt_addendum,\n",
        "workflow settings select",
    )
    query = replace_once(
        query,
        "  coalesce(s.initial_message_template, d.initial_message_template) as initial_message_template,\n"
        "  coalesce(s.handoff_message, d.handoff_message) as handoff_message,\n",
        "  coalesce(s.initial_message_template, d.initial_message_template) as initial_message_template,\n"
        "  coalesce(s.handoff_message, d.handoff_message) as handoff_message,\n"
        "  coalesce(s.company_knowledge, d.company_knowledge) as company_knowledge,\n"
        "  coalesce(s.company_documents, d.company_documents) as company_documents,\n"
        "  coalesce(s.payment_methods, d.payment_methods) as payment_methods,\n",
        "workflow settings company select",
    )
    return query


def patch_normalize_inventory(code: str) -> str:
    return replace_once(
        code,
        "      precio_persona_extra: toNumber(pick(row, ['precio_persona_extra', 'Precio Persona Extra']), 0),\n"
        "      pet_friendly: toBool(pick(row, ['pet_friendly', 'Pet Friendly', 'mascotas']), false),\n",
        "      precio_persona_extra: toNumber(pick(row, ['precio_persona_extra', 'Precio Persona Extra']), 0),\n"
        "      tiempo_en_vehiculo: pick(row, ['tiempo_en_vehiculo', 'Tiempo en Vehiculo', 'Tiempo en vehículo', 'tiempo_desde_poblacion']),\n"
        "      acomodacion_por_habitacion: pick(row, ['acomodacion_por_habitacion', 'Acomodacion por habitacion', 'Acomodación por habitación']),\n"
        "      limpieza_final_valor: toNumber(pick(row, ['limpieza_final_valor', 'Limpieza Final Valor']), null),\n"
        "      servicio_empleada_valor_8h: toNumber(pick(row, ['servicio_empleada_valor_8h', 'Servicio Empleada Valor 8H', 'servicio_empleada_valor']), null),\n"
        "      servicios_adicionales_texto: pick(row, ['servicios_adicionales_texto', 'Servicios Adicionales Texto']),\n"
        "      pet_friendly: toBool(pick(row, ['pet_friendly', 'Pet Friendly', 'mascotas']), false),\n",
        "normalize inventory extra columns",
    )


def patch_build_inventory_tool_response(code: str) -> str:
    code = replace_once(
        code,
        "const ownerContactOverride = compact(settings.owner_contact_override || settings.ownerContactOverride);\n",
        "const ownerContactOverride = compact(settings.owner_contact_override || settings.ownerContactOverride);\n"
        "const currentState = compact(\n"
        "  payload.forced_state ||\n"
        "    runtimeContext.current_state ||\n"
        "    runtimeContext.conversation?.forced_state ||\n"
        "    runtimeContext.conversation?.current_state,\n"
        ");\n"
        "const exposeRealName =\n"
        "  currentState === 'CONFIRMING_RESERVATION' ||\n"
        "  runtimeContext.owner_response?.disponible === true ||\n"
        "  payload.reveal_real_name === true;\n",
        "inventory response state gating",
    )
    code = replace_once(
        code,
        "const sanitizeListItem = (item, nights) => ({\n"
        "  finca_id: item.finca_id,\n"
        "  nombre: item.nombre,\n"
        "  codigo_original: item.codigo_original,\n"
        "  zona: item.zona,\n"
        "  municipio: item.municipio,\n"
        "  capacidad_max: item.capacidad_max,\n"
        "  capacidad_minima_tarifa: item.capacidad_minima_tarifa,\n"
        "  habitaciones: item.habitaciones,\n"
        "  min_noches: item.min_noches,\n"
        "  precio_noche_base: item.precio_noche_base,\n"
        "  precio_fin_semana: item.precio_fin_semana,\n"
        "  precio_festivo: item.precio_festivo,\n"
        "  precio_semana_santa_receso: item.precio_semana_santa_receso,\n"
        "  precio_temporada_alta: item.precio_temporada_alta,\n"
        "  precio_persona_extra: item.precio_persona_extra,\n"
        "  precio_referencia_noche: nightlyReference(item, nights),\n"
        "  pet_friendly: item.pet_friendly,\n"
        "  amenidades: item.amenidades,\n"
        "  tipo_evento: item.tipo_evento,\n"
        "  descripcion_corta: item.descripcion_corta,\n"
        "  foto_url: item.foto_url,\n"
        "  owner_nombre: item.owner_nombre,\n"
        "  descuento_max_pct: item.descuento_max_pct,\n"
        "  especificacion_habitaciones: item.especificacion_habitaciones,\n"
        "  observaciones_originales: item.observaciones_originales,\n"
        "  caracteristicas_originales: item.caracteristicas_originales,\n"
        "});\n"
        "\n"
        "const sanitizeDetailItem = (item, nights) => ({\n"
        "  ...sanitizeListItem(item, nights),\n"
        "  deposito_seguridad: item.deposito_seguridad,\n"
        "  owner_contacto: ownerContactOverride || item.owner_contacto,\n"
        "  empleadas: item.empleadas,\n"
        "  administrador_nombre: item.administrador_nombre,\n"
        "  administrador_contacto: item.administrador_contacto,\n"
        "  pricing_model: item.pricing_model,\n"
        "  review_notes: item.review_notes,\n"
        "});\n",
        "const visibleFincaName = (item) => {\n"
        "  const visibleCode = compact(item?.codigo_original || item?.finca_id);\n"
        "  if (!item) return visibleCode || null;\n"
        "  return exposeRealName ? item.nombre : null;\n"
        "};\n"
        "\n"
        "const publicDisplayLabel = (item) => compact(item?.codigo_original || item?.finca_id || item?.nombre || '');\n"
        "\n"
        "const sanitizeListItem = (item, nights) => ({\n"
        "  finca_id: item.finca_id,\n"
        "  nombre: visibleFincaName(item),\n"
        "  display_name: publicDisplayLabel(item),\n"
        "  codigo_original: item.codigo_original,\n"
        "  zona: item.zona,\n"
        "  municipio: item.municipio,\n"
        "  capacidad_max: item.capacidad_max,\n"
        "  capacidad_minima_tarifa: item.capacidad_minima_tarifa,\n"
        "  habitaciones: item.habitaciones,\n"
        "  min_noches: item.min_noches,\n"
        "  precio_noche_base: item.precio_noche_base,\n"
        "  precio_fin_semana: item.precio_fin_semana,\n"
        "  precio_festivo: item.precio_festivo,\n"
        "  precio_semana_santa_receso: item.precio_semana_santa_receso,\n"
        "  precio_temporada_alta: item.precio_temporada_alta,\n"
        "  precio_persona_extra: item.precio_persona_extra,\n"
        "  precio_referencia_noche: nightlyReference(item, nights),\n"
        "  limpieza_final_valor: item.limpieza_final_valor,\n"
        "  servicio_empleada_valor_8h: item.servicio_empleada_valor_8h,\n"
        "  servicios_adicionales_texto: item.servicios_adicionales_texto,\n"
        "  tiempo_en_vehiculo: item.tiempo_en_vehiculo,\n"
        "  acomodacion_por_habitacion: item.acomodacion_por_habitacion,\n"
        "  pet_friendly: item.pet_friendly,\n"
        "  amenidades: item.amenidades,\n"
        "  tipo_evento: item.tipo_evento,\n"
        "  descripcion_corta: item.descripcion_corta,\n"
        "  foto_url: item.foto_url,\n"
        "  owner_nombre: exposeRealName ? item.owner_nombre : null,\n"
        "  descuento_max_pct: item.descuento_max_pct,\n"
        "  especificacion_habitaciones: item.especificacion_habitaciones,\n"
        "  observaciones_originales: item.observaciones_originales,\n"
        "  caracteristicas_originales: item.caracteristicas_originales,\n"
        "});\n"
        "\n"
        "const sanitizeDetailItem = (item, nights) => ({\n"
        "  ...sanitizeListItem(item, nights),\n"
        "  deposito_seguridad: item.deposito_seguridad,\n"
        "  owner_contacto: exposeRealName ? ownerContactOverride || item.owner_contacto : null,\n"
        "  empleadas: item.empleadas,\n"
        "  administrador_nombre: exposeRealName ? item.administrador_nombre : null,\n"
        "  administrador_contacto: exposeRealName ? item.administrador_contacto : null,\n"
        "  pricing_model: item.pricing_model,\n"
        "  review_notes: item.review_notes,\n"
        "});\n",
        "sanitize inventory items",
    )
    code = replace_once(
        code,
        "              finca_id: bestMatch.finca_id,\n"
        "              nombre: bestMatch.nombre,\n"
        "              owner_nombre: bestMatch.owner_nombre,\n"
        "              owner_contacto: ownerContactOverride || bestMatch.owner_contacto,\n",
        "              finca_id: bestMatch.finca_id,\n"
        "              nombre: exposeRealName ? bestMatch.nombre : null,\n"
        "              display_name: publicDisplayLabel(bestMatch),\n"
        "              owner_nombre: bestMatch.owner_nombre,\n"
        "              owner_contacto: ownerContactOverride || bestMatch.owner_contacto,\n",
        "owner contact payload",
    )
    return code


NORMALIZE_POST_ACTIONS = r"""function normalizePostActions(parsed, toolOutput) {\n  const raw = parsed?.post_actions && typeof parsed.post_actions === 'object' ? { ...parsed.post_actions } : {};\n  const tool = parsed?.tool_chosen || 'NONE';\n  const intent = toolOutput?.intent || null;\n  const currentContext = $('Get Context-conversations1').item.json || {};\n  const currentExtras = currentContext.extras || currentContext.context?.extras || {};\n  const currentConfirmation =\n    currentExtras.confirming_reservation && typeof currentExtras.confirming_reservation === 'object'\n      ? currentExtras.confirming_reservation\n      : {};\n  const currentConfirmationVersion = Number(\n    currentContext.confirmacion_version || currentContext.context?.confirmacion?.version || 0,\n  );\n\n  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);\n  const mergeObjects = (base, patch) => {\n    const origin = isPlainObject(base) ? { ...base } : {};\n    for (const [key, value] of Object.entries(patch || {})) {\n      if (Array.isArray(value)) {\n        origin[key] = value;\n        continue;\n      }\n      if (isPlainObject(value) && isPlainObject(origin[key])) {\n        origin[key] = mergeObjects(origin[key], value);\n        continue;\n      }\n      origin[key] = value;\n    }\n    return origin;\n  };\n  const compactObject = (value) => {\n    const out = {};\n    for (const [key, entry] of Object.entries(value || {})) {\n      if (entry === undefined || entry === null) continue;\n      if (typeof entry === 'string' && entry.trim() === '') continue;\n      out[key] = entry;\n    }\n    return out;\n  };\n\n  if (tool === 'qualifying_agent') {\n    const extraidos = compactCriteria(toolOutput?.datos_extraidos || {});\n    if (Object.keys(extraidos).length && !raw.search_criteria) raw.search_criteria = extraidos;\n    if (toolOutput?.datos_completos === true && !raw.state_transition) raw.state_transition = 'OFFERING';\n    if (toolOutput?.datos_completos === true && !raw.waiting_for) raw.waiting_for = 'CLIENT';\n  }\n\n  if (tool === 'offering_agent') {\n    if (Array.isArray(toolOutput?.fincas_mostradas) && !raw.shown_fincas) {\n      raw.shown_fincas = toolOutput.fincas_mostradas\n        .map((item) => item?.finca_id || item?.id || null)\n        .filter(Boolean);\n    }\n    if (toolOutput?.search_criteria_update && !raw.search_criteria) raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);\n    if (toolOutput?.intent === 'CLIENT_CHOSE') {\n      raw.state_transition ||= 'VERIFYING_AVAILABILITY';\n      raw.selected_finca_id ||= toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id || '__IGNORE__';\n      raw.selected_finca ||= toolOutput.selected_finca || '__IGNORE__';\n      raw.waiting_for ||= 'OWNER';\n    }\n  }\n\n  if (tool === 'verifying_availability_agent') {\n    if (toolOutput?.selected_finca && !raw.selected_finca) raw.selected_finca = toolOutput.selected_finca;\n    if ((toolOutput?.finca_elegida_id || toolOutput?.selected_finca?.finca_id) && !raw.selected_finca_id) {\n      raw.selected_finca_id = toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id;\n    }\n    if (intent === 'CHANGE_FINCA') {\n      raw.state_transition ||= 'OFFERING';\n      raw.waiting_for ||= 'CLIENT';\n      raw.selected_finca_id ||= '__CLEAR__';\n      raw.selected_finca ||= '__CLEAR__';\n    }\n  }\n\n  if (tool === 'qa_agent') {\n    if (toolOutput?.search_criteria_update && !raw.search_criteria) {\n      raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);\n    }\n    if (toolOutput?.selected_finca && !raw.selected_finca) raw.selected_finca = toolOutput.selected_finca;\n    if ((toolOutput?.finca_elegida_id || toolOutput?.selected_finca?.finca_id) && !raw.selected_finca_id) {\n      raw.selected_finca_id = toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id;\n    }\n  }\n\n  if (tool == 'confirming_reservation_agent') {\n    if (toolOutput?.selected_finca && !raw.selected_finca) raw.selected_finca = toolOutput.selected_finca;\n    if ((toolOutput?.finca_elegida_id || toolOutput?.selected_finca?.finca_id) && !raw.selected_finca_id) {\n      raw.selected_finca_id = toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id;\n    }\n\n    const confirmationUpdate = compactObject(toolOutput?.confirmation_data_update || {});\n    if (Object.keys(confirmationUpdate).length) {\n      raw.extras = mergeObjects(currentExtras, {\n        confirming_reservation: mergeObjects(currentConfirmation, {\n          ...confirmationUpdate,\n          updated_at: new Date().toISOString(),\n        }),\n      });\n    }\n\n    if (intent === 'DOCUMENT_READY') {\n      raw.extras = mergeObjects(currentExtras, {\n        confirming_reservation: mergeObjects(currentConfirmation, {\n          ...confirmationUpdate,\n          updated_at: new Date().toISOString(),\n          document_ready: true,\n          document_ready_at: new Date().toISOString(),\n        }),\n      });\n      if (raw.confirmacion_enviada === undefined) raw.confirmacion_enviada = true;\n      if (raw.confirmacion_version === undefined) raw.confirmacion_version = currentConfirmationVersion + 1;\n      if (raw.huespedes_completos === undefined) raw.huespedes_completos = true;\n      raw.state_transition ||= 'HITL';\n      raw.waiting_for ||= 'CLIENT';\n      raw.agente_activo = false;\n      raw.hitl_reason ||= 'reservation_confirmation_sent';\n    }\n  }\n\n  if ((parsed?.action === 'HITL' || intent === 'HITL_REQUEST') && raw.agente_activo === undefined) {\n    raw.agente_activo = false;\n  }\n\n  if (parsed?.action === 'NOOP_BOT_DISABLED' && raw.agente_activo === undefined) {\n    raw.agente_activo = false;\n  }\n\n  const normalized = {\n    state_transition:\n      typeof raw.state_transition === 'string' && raw.state_transition.trim()\n        ? raw.state_transition\n        : '__IGNORE__',\n    search_criteria:\n      raw.search_criteria && typeof raw.search_criteria === 'object'\n        ? mergeCriteriaWithCurrent(raw.search_criteria)\n        : '__IGNORE__',\n    waiting_for:\n      typeof raw.waiting_for === 'string' && raw.waiting_for.trim() ? raw.waiting_for : '__IGNORE__',\n    agente_activo:\n      typeof raw.agente_activo === 'boolean' ? raw.agente_activo : '__IGNORE__',\n    shown_fincas: Array.isArray(raw.shown_fincas) ? raw.shown_fincas : '__IGNORE__',\n    selected_finca_id:\n      raw.selected_finca_id === '__CLEAR__'\n        ? '__CLEAR__'\n        : typeof raw.selected_finca_id === 'string' && raw.selected_finca_id.trim()\n          ? raw.selected_finca_id\n          : '__IGNORE__',\n    selected_finca:\n      raw.selected_finca === '__CLEAR__'\n        ? '__CLEAR__'\n        : raw.selected_finca && typeof raw.selected_finca === 'object'\n          ? raw.selected_finca\n          : '__IGNORE__',\n    owner_response:\n      raw.owner_response === '__CLEAR__'\n        ? '__CLEAR__'\n        : raw.owner_response && typeof raw.owner_response === 'object'\n          ? raw.owner_response\n          : '__IGNORE__',\n    pricing:\n      raw.pricing && typeof raw.pricing === 'object' && !Array.isArray(raw.pricing) ? raw.pricing : '__IGNORE__',\n    extras:\n      raw.extras && typeof raw.extras === 'object' && !Array.isArray(raw.extras) ? raw.extras : '__IGNORE__',\n    confirmacion_enviada:\n      typeof raw.confirmacion_enviada === 'boolean' ? raw.confirmacion_enviada : '__IGNORE__',\n    confirmacion_version:\n      Number.isFinite(Number(raw.confirmacion_version)) ? Math.max(0, Math.trunc(Number(raw.confirmacion_version))) : '__IGNORE__',\n    huespedes_completos:\n      typeof raw.huespedes_completos === 'boolean' ? raw.huespedes_completos : '__IGNORE__',\n    hitl_reason:\n      raw.hitl_reason === '__CLEAR__'\n        ? '__CLEAR__'\n        : typeof raw.hitl_reason === 'string' && raw.hitl_reason.trim()\n          ? raw.hitl_reason\n          : '__IGNORE__',\n    resume_after_qa: raw.resume_after_qa === true,\n    resume_state_after_qa:\n      typeof raw.resume_state_after_qa === 'string' && raw.resume_state_after_qa.trim()\n        ? raw.resume_state_after_qa\n        : '__IGNORE__',\n    loop_reason:\n      typeof raw.loop_reason === 'string' && raw.loop_reason.trim()\n        ? raw.loop_reason\n        : '__IGNORE__',\n  };\n\n  if (normalized.search_criteria !== '__IGNORE__' && Object.keys(normalized.search_criteria).length === 0) {\n    normalized.search_criteria = '__IGNORE__';\n  }\n\n  if (normalized.extras !== '__IGNORE__' && Object.keys(normalized.extras).length === 0) {\n    normalized.extras = '__IGNORE__';\n  }\n\n  return normalized;\n}\n\n"""


PROPERTY_SEQUENCE_BLOCK = r"""function visibleFincaLabel(finca, allowRealName = false) {\n  if (!finca || typeof finca !== 'object') return 'Finca';\n  if (allowRealName && String(finca.nombre || '').trim()) return String(finca.nombre).trim();\n  return String(finca.codigo_original || finca.finca_id || finca.nombre || 'Finca').trim();\n}\n\nfunction buildFincaCard(finca) {\n  if (!finca || typeof finca !== 'object') return null;\n  const title = visibleFincaLabel(finca, false);\n  const code = String(finca.codigo_original || finca.finca_id || '').trim();\n  const highlights = buildHighlightLines(finca);\n  const tarifa = buildTarifaLine(finca);\n  const parts = [\n    '☀️🌴*' + title + '*🌴☀️',\n    code && code !== title ? code : null,\n    null,\n    ...highlights.map((line) => '- ' + line),\n    finca.tiempo_en_vehiculo ? 'Tiempo aproximado en vehículo: ' + String(finca.tiempo_en_vehiculo) : null,\n    tarifa,\n  ].filter((value) => value !== null && value !== undefined && String(value).trim() !== '');\n  return parts.join('\\n');\n}\n\nfunction buildMediaMessages(finca) {\n  const urls = parseUrls(finca?.foto_url);\n  if (!urls.length) return [];\n  const title = visibleFincaLabel(finca, false);\n  return [\n    {\n      type: 'media_group',\n      content: '',\n      media_url: urls[0],\n      media_urls: urls,\n      property_title: title,\n      property_id: finca?.finca_id || null,\n      property_group_id: finca?.finca_id || title,\n      property_group_photo_count: urls.length,\n    },\n  ];\n}\n\nfunction createTextMessage(content, extra = {}) {\n  const text = String(content || '').trim();\n  if (!text) return null;\n  return {\n    type: extra.type || 'text',\n    content: text,\n    media_url: extra.media_url || null,\n    media_urls: Array.isArray(extra.media_urls) ? extra.media_urls : undefined,\n    property_title: extra.property_title || null,\n    property_id: extra.property_id || null,\n  };\n}\n\nfunction createReservationDocumentItem(selectedFinca, toolOutputParsed, finalWhatsappText) {\n  if (!toolOutputParsed || toolOutputParsed.intent !== 'DOCUMENT_READY') return null;\n\n  const baseUrl = String($('config').item.json.public_app_base_url || '').trim().replace(/\/+$/, '');\n  if (!baseUrl) return null;\n\n  const context = $('Get Context-conversations1').item.json || {};\n  const searchCriteria = context.search_criteria || context.context?.search_criteria || {};\n  const pricing = context.context?.pricing || {};\n  const currentExtras = context.extras || context.context?.extras || {};\n  const confirmationData = {\n    ...(currentExtras.confirming_reservation && typeof currentExtras.confirming_reservation === 'object'\n      ? currentExtras.confirming_reservation\n      : {}),\n    ...(toolOutputParsed.confirmation_data_update && typeof toolOutputParsed.confirmation_data_update === 'object'\n      ? toolOutputParsed.confirmation_data_update\n      : {}),\n  };\n\n  const nights = Number(pricing.noches || 0) > 0 ? Number(pricing.noches) : null;\n  const nightlyRate = Number(pricing.precio_noche || selectedFinca?.precio_noche_base || 0) || null;\n  const cleaningFee =\n    Number(selectedFinca?.limpieza_final_valor || currentExtras?.limpieza_final_valor || 0) || 0;\n  const deposit = Number(pricing.deposito_seguridad || selectedFinca?.deposito_seguridad || 0) || 0;\n  const subtotal = Number(pricing.subtotal || 0) || (nightlyRate && nights ? nightlyRate * nights : 0);\n  const total = Number(pricing.total || 0) || subtotal + cleaningFee + deposit;\n  const payload = {\n    property_code: selectedFinca?.codigo_original || selectedFinca?.finca_id || null,\n    property_name: selectedFinca?.nombre || null,\n    property_zone: selectedFinca?.zona || null,\n    property_municipio: selectedFinca?.municipio || null,\n    fecha_inicio: searchCriteria.fecha_inicio || null,\n    fecha_fin: searchCriteria.fecha_fin || null,\n    noches: nights,\n    check_in: toolOutputParsed.check_in || '15:00',\n    check_out: toolOutputParsed.check_out || '11:00',\n    tarifa_noche: nightlyRate,\n    limpieza_final: cleaningFee,\n    deposito: deposit,\n    huespedes: Number(searchCriteria.personas || 0) || null,\n    subtotal,\n    total,\n    client_name: confirmationData.nombre_completo || null,\n    client_document_type: confirmationData.tipo_documento || null,\n    client_document_number: confirmationData.numero_documento || null,\n    client_phone: confirmationData.celular || context.client_name || null,\n    client_email: confirmationData.correo || null,\n    client_address: confirmationData.direccion || null,\n    company_knowledge: $('config').item.json.company_knowledge || '',\n    company_documents: (() => {\n      try {\n        return JSON.parse(String($('config').item.json.company_documents_json || '[]'));\n      } catch {\n        return [];\n      }\n    })(),\n    payment_methods: (() => {\n      try {\n        return JSON.parse(String($('config').item.json.payment_methods_json || '[]'));\n      } catch {\n        return [];\n      }\n    })(),\n  };\n\n  const encodedPayload = encodeURIComponent(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'));\n  return {\n    type: 'media_group',\n    content: String(finalWhatsappText || '').trim(),\n    media_url: baseUrl + '/api/reservation-confirmation.pdf?payload=' + encodedPayload,\n    media_urls: [baseUrl + '/api/reservation-confirmation.pdf?payload=' + encodedPayload],\n    property_title: visibleFincaLabel(selectedFinca, true),\n    property_id: selectedFinca?.finca_id || null,\n    property_group_id: 'confirmation-document-' + String(selectedFinca?.finca_id || 'reservation'),\n    property_group_photo_count: 1,\n  };\n}\n\nfunction buildPropertySequence(tool, toolOutputParsed, finalWhatsappText) {\n  const intent = toolOutputParsed?.intent || null;\n  const selectedFinca = toolOutputParsed?.selected_finca && typeof toolOutputParsed.selected_finca === 'object'\n    ? toolOutputParsed.selected_finca\n    : null;\n  const fincasMostradas = Array.isArray(toolOutputParsed?.fincas_mostradas)\n    ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')\n    : [];\n\n  const sequence = [];\n\n  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {\n    for (const finca of fincasMostradas) {\n      const card = buildFincaCard(finca);\n      const cardMessage = createTextMessage(card, {\n        property_title: visibleFincaLabel(finca, false),\n        property_id: finca?.finca_id || null,\n      });\n      if (cardMessage) sequence.push(cardMessage);\n      sequence.push(...buildMediaMessages(finca));\n    }\n    return sequence;\n  }\n\n  if (tool === 'confirming_reservation_agent') {\n    const documentItem = createReservationDocumentItem(selectedFinca, toolOutputParsed, finalWhatsappText);\n    if (documentItem) {\n      sequence.push(documentItem);\n      return sequence;\n    }\n    const trailingText = createTextMessage(finalWhatsappText);\n    if (trailingText) sequence.push(trailingText);\n    return sequence;\n  }\n\n  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {\n    const trailingText = createTextMessage(finalWhatsappText);\n    if (trailingText) sequence.push(trailingText);\n    return sequence;\n  }\n\n  return [];\n}\n\n\n"""


CONFIRMING_AGENT_TEXT = """=CONTEXT:\n{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}\n\nRECENT_MESSAGES:\n{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}\n\nCURRENT_MESSAGE:\n{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}\n\nCOMPANY_KNOWLEDGE:\n{{ JSON.stringify($('config').item.json.company_knowledge || '', null, 2) }}\n\nCOMPANY_DOCUMENTS:\n{{ $('config').item.json.company_documents_json || '[]' }}\n\nPAYMENT_METHODS:\n{{ $('config').item.json.payment_methods_json || '[]' }}\n\nINSTRUCCION:\n- Si el cliente ya entregó datos de confirmación en mensajes previos o en CURRENT_MESSAGE, extráelos y devuélvelos en confirmation_data_update.\n- Si falta algún dato, pide todos los faltantes en un solo mensaje, de forma clara y ordenada.\n- Si la finca elegida no trae el nombre real o necesitas detalles para el documento, puedes llamar inventory_reader_tool con operation=\"get_finca_details\" usando selected_finca_id.\n- No menciones propietarios ni procesos internos.\n- Cuando ya tengas nombre completo, tipo y número de documento, celular, correo y dirección, devuelve intent = \"DOCUMENT_READY\".\n- Al preparar el documento, usa también los medios de pago configurados.\n\nLOOP_CONTEXT:\n{{ JSON.stringify({\n  loop_reason: $('Merge Sets1').item.json.loop_reason || null,\n  owner_unavailable: $('Merge Sets1').item.json.owner_unavailable === true,\n  forced_state: $('Merge Sets1').item.json.forced_state || null\n}, null, 2) }}"""


CONFIRMING_AGENT_SYSTEM = """=Eres el agente del estado CONFIRMING_RESERVATION.\n\nOBJETIVO\n- Confirmar la información necesaria para reservar.\n- Capturar los datos del titular.\n- Cuando estén completos, preparar el envío del documento de confirmación y dejar la conversación lista para que continúe el equipo humano.\n\nREGLAS\n- Si necesitas validar una referencia de fecha u hora, usa current_datetime_tool.\n{{ $('config').item.json.tono }}\n{{ $('config').item.json.global_prompt_addendum }}\n{{ $('config').item.json.confirming_reservation_prompt_addendum }}\n- En esta etapa ya puedes usar el nombre real de la finca si el tool lo entrega.\n- Debes pedir y/o confirmar exactamente estos datos del titular: nombre completo, tipo y número de documento, celular, correo y dirección.\n- Si el cliente ya entregó uno o varios datos, reconócelos y pide solo los faltantes.\n- Cuando aún falten datos, no hables de documento enviado ni cierres la gestión.\n- Cuando ya estén todos los datos, explica de forma breve que compartes la confirmación de reserva con los medios de pago disponibles.\n- Nunca menciones propietarios, dueños, administradores ni contactos internos.\n- Si el cliente pide un humano o algo sale del proceso comercial, usa intent = \"HITL_REQUEST\".\n\nOUTPUT\nDevuelve EXCLUSIVAMENTE JSON válido:\n{\n  \"respuesta\": \"texto para el cliente\",\n  \"intent\": \"REQUEST_CONFIRMATION_DATA | DOCUMENT_READY | QUESTION | HITL_REQUEST\",\n  \"finca_elegida_id\": null | \"string\",\n  \"selected_finca\": null | {\n    \"finca_id\": \"string\",\n    \"nombre\": \"string\",\n    \"codigo_original\": \"string\",\n    \"zona\": \"string\",\n    \"municipio\": \"string\",\n    \"capacidad_max\": number,\n    \"habitaciones\": number,\n    \"precio_noche_base\": number,\n    \"precio_fin_semana\": number,\n    \"amenidades\": [],\n    \"descripcion_corta\": \"string\",\n    \"foto_url\": \"string\",\n    \"observaciones_originales\": \"string\",\n    \"caracteristicas_originales\": \"string\",\n    \"tiempo_en_vehiculo\": \"string\",\n    \"acomodacion_por_habitacion\": \"string\",\n    \"limpieza_final_valor\": number,\n    \"servicio_empleada_valor_8h\": number,\n    \"servicios_adicionales_texto\": \"string\"\n  },\n  \"confirmation_data_update\": {\n    \"nombre_completo\": null | \"string\",\n    \"tipo_documento\": null | \"string\",\n    \"numero_documento\": null | \"string\",\n    \"celular\": null | \"string\",\n    \"correo\": null | \"string\",\n    \"direccion\": null | \"string\"\n  },\n  \"missing_fields\": []\n}\n- Usa intent = \"REQUEST_CONFIRMATION_DATA\" mientras falte al menos un dato obligatorio.\n- Usa intent = \"DOCUMENT_READY\" solo cuando ya tengas todos los datos obligatorios y estés listo para compartir la confirmación.\n"""


WRAP_CONFIRMING_CODE = """function stripCodeFences(str) {\n  if (!str) return '';\n  return String(str)\n    .trim()\n    .replace(/^\\s*\\`\\`\\`json\\s*/i, '')\n    .replace(/^\\s*\\`\\`\\`\\s*/i, '')\n    .replace(/\\s*\\`\\`\\`\\s*$/i, '')\n    .trim();\n}\n\nfunction extractFirstJsonObject(text) {\n  const s = String(text || '');\n  const start = s.search(/[\\[{]/);\n  if (start === -1) return null;\n  const open = s[start];\n  const close = open === '{' ? '}' : ']';\n  let depth = 0;\n  let inString = false;\n  let escape = false;\n  for (let i = start; i < s.length; i += 1) {\n    const ch = s[i];\n    if (inString) {\n      if (escape) escape = false;\n      else if (ch === '\\\\') escape = true;\n      else if (ch === '\"') inString = false;\n      continue;\n    }\n    if (ch === '\"') {\n      inString = true;\n      continue;\n    }\n    if (ch === open) depth += 1;\n    else if (ch === close) {\n      depth -= 1;\n      if (depth === 0) return s.slice(start, i + 1);\n    }\n  }\n  return null;\n}\n\nfunction safeParse(text) {\n  if (text == null) return null;\n  const raw = String(text).trim();\n  try {\n    return JSON.parse(raw);\n  } catch {\n    const candidate = extractFirstJsonObject(stripCodeFences(raw));\n    if (!candidate) return { _raw: raw.slice(0, 12000) };\n    try {\n      return JSON.parse(candidate);\n    } catch {\n      return { _raw: raw.slice(0, 12000) };\n    }\n  }\n}\n\nconst rawOutput =\n  typeof $json.output === 'string'\n    ? $json.output\n    : Array.isArray($json.output) && typeof $json.output[0]?.output === 'string'\n      ? $json.output[0].output\n      : '';\n\nconst toolOutput = safeParse(stripCodeFences(rawOutput || '')) || {};\n\nreturn [\n  {\n    json: {\n      output: JSON.stringify({\n        action: toolOutput?.intent === 'HITL_REQUEST' ? 'HITL' : 'RUN_TOOL',\n        tool_chosen: 'confirming_reservation_agent',\n        tool_output: toolOutput,\n        post_actions: {},\n        final_whatsapp_text: typeof toolOutput?.respuesta === 'string' ? toolOutput.respuesta : null,\n        current_state_changed: false,\n      }),\n    },\n  },\n];\n"""


def patch_current_workflow() -> None:
    workflow = load_json(WORKFLOW_PATH)

    get_settings = find_node(workflow, "Get agent settings")
    get_settings["parameters"]["query"] = patch_get_agent_settings_query(get_settings["parameters"]["query"])

    config_node = find_node(workflow, "config")
    assignments = config_node["parameters"]["assignments"]["assignments"]
    ensure_assignment(assignments, "public_app_base_url", "={{ $('Get agent settings').item.json.public_app_base_url || '' }}")
    ensure_assignment(assignments, "global_prompt_addendum", "={{ $('Get agent settings').item.json.global_prompt_addendum || '' }}")
    ensure_assignment(assignments, "qualifying_prompt_addendum", "={{ $('Get agent settings').item.json.qualifying_prompt_addendum || '' }}")
    ensure_assignment(assignments, "offering_prompt_addendum", "={{ $('Get agent settings').item.json.offering_prompt_addendum || '' }}")
    ensure_assignment(assignments, "verifying_availability_prompt_addendum", "={{ $('Get agent settings').item.json.verifying_availability_prompt_addendum || '' }}")
    ensure_assignment(assignments, "qa_prompt_addendum", "={{ $('Get agent settings').item.json.qa_prompt_addendum || '' }}")
    ensure_assignment(assignments, "hitl_prompt_addendum", "={{ $('Get agent settings').item.json.hitl_prompt_addendum || '' }}")
    ensure_assignment(assignments, "confirming_reservation_prompt_addendum", "={{ $('Get agent settings').item.json.confirming_reservation_prompt_addendum || '' }}")
    ensure_assignment(assignments, "company_knowledge", "={{ $('Get agent settings').item.json.company_knowledge || '' }}")
    ensure_assignment(assignments, "company_documents_json", "={{ JSON.stringify($('Get agent settings').item.json.company_documents || []) }}")
    ensure_assignment(assignments, "payment_methods_json", "={{ JSON.stringify($('Get agent settings').item.json.payment_methods || []) }}")

    normalize_inventory = find_node(workflow, "Normalize Inventory")
    normalize_inventory["parameters"]["jsCode"] = patch_normalize_inventory(
        normalize_inventory["parameters"]["jsCode"]
    )

    inventory_response = find_node(workflow, "Build Inventory Tool Response")
    inventory_response["parameters"]["jsCode"] = patch_build_inventory_tool_response(
        inventory_response["parameters"]["jsCode"]
    )

    prechecks = find_node(workflow, "Compute deterministic prechecks")
    prechecks["parameters"]["jsCode"] = replace_once(
        prechecks["parameters"]["jsCode"],
        "if (\n  currentState === 'VERIFYING_AVAILABILITY' &&\n  ownerResponse &&\n  typeof ownerResponse === 'object' &&\n  ownerResponse.disponible === true\n) {\n  return [\n    {\n      json: {\n        ...base,\n        action: 'HITL',\n        route_mode: 'HITL',\n        reason: 'owner_available_confirmed',\n        final_whatsapp_text:\n          'Ya confirmé que la finca que elegiste está disponible.\\n\\n' + handoffMessage,\n        post_actions: {\n          agente_activo: false,\n          waiting_for: 'CLIENT',\n        },\n      },\n    },\n  ];\n}\n",
        "if (\n  currentState === 'VERIFYING_AVAILABILITY' &&\n  ownerResponse &&\n  typeof ownerResponse === 'object' &&\n  ownerResponse.disponible === true\n) {\n  return [\n    {\n      json: {\n        ...base,\n        route_mode: 'STATE',\n        reason: 'owner_available_confirmed',\n        skip_validator: true,\n        forced_state: 'CONFIRMING_RESERVATION',\n        effective_state: 'CONFIRMING_RESERVATION',\n        loop_reason: 'owner_available_confirmed',\n        post_actions: {\n          state_transition: 'CONFIRMING_RESERVATION',\n          waiting_for: 'CLIENT',\n        },\n      },\n    },\n  ];\n}\n",
        "precheck owner available to confirming",
    )

    code_node = find_node(workflow, "Code in JavaScript1")
    code = code_node["parameters"]["jsCode"]
    start = code.index("function normalizePostActions(parsed, toolOutput) {")
    end = code.index("function getRawOutput(itemJson) {", start)
    code = code[:start] + NORMALIZE_POST_ACTIONS + code[end:]
    start = code.index("function buildFincaCard(finca) {")
    end = code.index("function buildSelectionNotificationCandidate", start)
    code = code[:start] + PROPERTY_SEQUENCE_BLOCK + code[end:]
    code = replace_once(
        code,
        "const businessStates = new Set(['QUALIFYING', 'OFFERING', 'VERIFYING_AVAILABILITY']);",
        "const businessStates = new Set(['QUALIFYING', 'OFFERING', 'VERIFYING_AVAILABILITY', 'CONFIRMING_RESERVATION']);",
        "business states set",
    )
    code_node["parameters"]["jsCode"] = code

    update_context = find_node(workflow, "actualizar contexto1")
    update_query = update_context["parameters"]["query"]
    update_query = replace_once(
        update_query,
        "  waiting_for = case\n    when coalesce(payload.p->>'waiting_for', '__IGNORE__') <> '__IGNORE__'\n    then payload.p->>'waiting_for'\n    else c.waiting_for\n  end,\n",
        "  waiting_for = case\n    when coalesce(payload.p->>'waiting_for', '__IGNORE__') <> '__IGNORE__'\n    then payload.p->>'waiting_for'\n    else c.waiting_for\n  end,\n  confirmacion_enviada = case\n    when jsonb_typeof(payload.p->'confirmacion_enviada') = 'boolean'\n      then (payload.p->>'confirmacion_enviada')::boolean\n    else c.confirmacion_enviada\n  end,\n  confirmacion_version = case\n    when coalesce(payload.p->>'confirmacion_version', '__IGNORE__') <> '__IGNORE__'\n      then nullif(payload.p->>'confirmacion_version', '')::integer\n    else c.confirmacion_version\n  end,\n  huespedes_completos = case\n    when jsonb_typeof(payload.p->'huespedes_completos') = 'boolean'\n      then (payload.p->>'huespedes_completos')::boolean\n    else c.huespedes_completos\n  end,\n",
        "update context confirmation columns",
    )
    update_query = replace_once(
        update_query,
        "  extras = case\n    when coalesce(payload.p->>'extras', '__IGNORE__') = '__IGNORE__'\n      then c.extras\n    else payload.p->'extras'\n  end,\n",
        "  extras = case\n    when coalesce(payload.p->>'extras', '__IGNORE__') = '__IGNORE__'\n      then c.extras\n    else coalesce(c.extras, '{}'::jsonb) || coalesce(payload.p->'extras', '{}'::jsonb)\n  end,\n",
        "merge extras during update",
    )
    update_context["parameters"]["query"] = update_query

    for node_name in ["Run qualifying pass", "Run offering pass", "Run verifying_availability pass", "Run qa pass"]:
        node = find_node(workflow, node_name)
        system = node["parameters"]["options"]["systemMessage"]
        if "{{ $('config').item.json.global_prompt_addendum }}" not in system:
            system = system.replace("{{ $('config').item.json.tono }}\n", "{{ $('config').item.json.tono }}\n{{ $('config').item.json.global_prompt_addendum }}\n")
        stage_field = {
            "Run qualifying pass": "qualifying_prompt_addendum",
            "Run offering pass": "offering_prompt_addendum",
            "Run verifying_availability pass": "verifying_availability_prompt_addendum",
            "Run qa pass": "qa_prompt_addendum",
        }[node_name]
        marker = f"{{{{ $('config').item.json.{stage_field} }}}}"
        if marker not in system:
            system = system.replace("{{ $('config').item.json.global_prompt_addendum }}\n", "{{ $('config').item.json.global_prompt_addendum }}\n" + marker + "\n")
        if node_name in {"Run offering pass", "Run verifying_availability pass", "Run qa pass"}:
            if "Antes de la confirmación usa el código de la propiedad" not in system:
                system = system.replace(
                    "REGLAS\n",
                    "REGLAS\n- Antes de la confirmación usa el código de la propiedad como identificador visible y no reveles el nombre real de la finca.\n",
                )
        if node_name == "Run qa pass":
            if "tiempo en vehículo" not in system.lower():
                system = system.replace(
                    "- Si la respuesta depende del inventario real, usa inventory_reader_tool.\n",
                    "- Si la respuesta depende del inventario real, usa inventory_reader_tool.\n- Si el inventario trae tiempo en vehículo, acomodación por habitación o servicios adicionales, úsalo de forma explícita en la respuesta.\n- Si el cliente pide documentos institucionales, apóyate en COMPANY_DOCUMENTS y su descripción semántica.\n",
                )
            text = node["parameters"]["text"]
            if "COMPANY_KNOWLEDGE:" not in text:
                text += "\n\nCOMPANY_KNOWLEDGE:\n{{ JSON.stringify($('config').item.json.company_knowledge || '', null, 2) }}\n\nCOMPANY_DOCUMENTS:\n{{ $('config').item.json.company_documents_json || '[]' }}\n\nPAYMENT_METHODS:\n{{ $('config').item.json.payment_methods_json || '[]' }}"
                node["parameters"]["text"] = text
        if node_name == "Run offering pass":
            if "servicios adicionales" not in system.lower():
                system = system.replace(
                    "- Si el cliente solo pregunta algo puntual de una finca, puedes consultar operation=\"get_finca_details\" y luego seguir pidiendo eleccion.\n",
                    "- Si el cliente solo pregunta algo puntual de una finca, puedes consultar operation=\"get_finca_details\" y luego seguir pidiendo eleccion.\n- Si una finca trae tiempos en vehículo, limpieza o servicios adicionales, puedes mencionarlos cuando sean relevantes para decidir.\n",
                )
        node["parameters"]["options"]["systemMessage"] = system

    # Add confirming route and nodes
    if not any(node["name"] == "Route CONFIRMING state?" for node in workflow["nodes"]):
        route_verify = find_node(workflow, "Route VERIFYING state?")
        route_confirm = copy.deepcopy(route_verify)
        route_confirm["id"] = str(uuid.uuid4())
        route_confirm["name"] = "Route CONFIRMING state?"
        route_confirm["position"] = [4512, 416]
        route_confirm["parameters"]["conditions"]["conditions"][0]["id"] = str(uuid.uuid4())
        route_confirm["parameters"]["conditions"]["conditions"][0]["leftValue"] = "={{ ($json.effective_state || $('Get Context-conversations1').item.json.current_state || null) === 'CONFIRMING_RESERVATION' }}"

        run_verifying = find_node(workflow, "Run verifying_availability pass")
        run_confirm = copy.deepcopy(run_verifying)
        run_confirm["id"] = str(uuid.uuid4())
        run_confirm["name"] = "Run confirming_reservation pass"
        run_confirm["position"] = [4800, 416]
        run_confirm["parameters"]["text"] = CONFIRMING_AGENT_TEXT
        run_confirm["parameters"]["options"]["systemMessage"] = CONFIRMING_AGENT_SYSTEM

        wrap_verifying = find_node(workflow, "Wrap verifying result")
        wrap_confirm = copy.deepcopy(wrap_verifying)
        wrap_confirm["id"] = str(uuid.uuid4())
        wrap_confirm["name"] = "Wrap confirming result"
        wrap_confirm["position"] = [5104, 416]
        wrap_confirm["parameters"]["jsCode"] = WRAP_CONFIRMING_CODE

        workflow["nodes"].extend([route_confirm, run_confirm, wrap_confirm])

        workflow["connections"]["Route OFFERING state?"]["main"][1] = [
            {"node": "Route VERIFYING state?", "type": "main", "index": 0}
        ]
        workflow["connections"]["Route VERIFYING state?"]["main"][1] = [
            {"node": "Route CONFIRMING state?", "type": "main", "index": 0}
        ]
        workflow["connections"]["Route CONFIRMING state?"] = {
            "main": [
                [{"node": "Run confirming_reservation pass", "type": "main", "index": 0}],
                [{"node": "Build unknown state payload", "type": "main", "index": 0}],
            ]
        }
        workflow["connections"]["Run confirming_reservation pass"] = {
            "main": [[{"node": "Wrap confirming result", "type": "main", "index": 0}]]
        }
        workflow["connections"]["Wrap confirming result"] = {
            "main": [[{"node": "Code in JavaScript1", "type": "main", "index": 0}]]
        }

        append_ai_tool_connection(workflow, "inventory_reader_tool", "Run confirming_reservation pass")
        append_ai_tool_connection(workflow, "current_datetime_tool", "Run confirming_reservation pass")

    write_json(WORKFLOW_PATH, workflow)


def patch_sender_workflow() -> None:
    workflow = load_json(SENDER_PATH)
    expand = find_node(workflow, "Expand outbound items")
    expand_code = expand["parameters"]["jsCode"]
    expand_code = replace_once(
        expand_code,
        "function createTextItem(content, extra = {}) {\n"
        "  const message = compact(content);\n"
        "  if (!message) return null;\n\n"
        "  return {\n"
        "    json: {\n"
        "      ...prevData,\n"
        "      outbound_item_type: 'text',\n"
        "      content: message,\n"
        "      private: extra.private === true,\n"
        "      property_title: extra.property_title || null,\n"
        "      source_url: extra.source_url || null,\n"
        "      download_url: extra.download_url || null,\n"
        "      send_order: extra.send_order || 0,\n"
        "      media_relay_base_url: compact(prevData.media_relay_base_url || \"\"),\n"
        "    },\n"
        "  };\n"
        "}\n",
        "function blockWaitMs(photoCount) {\n"
        "  const count = Number(photoCount || 0);\n"
        "  return Math.max(15000, 15000 + Math.max(0, count) * 6000);\n"
        "}\n\n"
        "function createTextItem(content, extra = {}) {\n"
        "  const message = compact(content);\n"
        "  if (!message) return null;\n\n"
        "  return {\n"
        "    json: {\n"
        "      ...prevData,\n"
        "      outbound_item_type: 'text',\n"
        "      content: message,\n"
        "      private: extra.private === true,\n"
        "      property_title: extra.property_title || null,\n"
        "      source_url: extra.source_url || null,\n"
        "      download_url: extra.download_url || null,\n"
        "      send_order: extra.send_order || 0,\n"
        "      media_relay_base_url: compact(prevData.media_relay_base_url || \"\"),\n"
        "      property_group_id: extra.property_group_id || null,\n"
        "      wait_after_block_ms: extra.wait_after_block_ms || null,\n"
        "    },\n"
        "  };\n"
        "}\n",
        "sender block wait helper",
    )
    expand_code = replace_once(
        expand_code,
        "  for (let index = 0; index < assets.length; index += 1) {\n"
        "    const asset = assets[index];\n"
        "    const caption = index === 0 ? compact(item.content) : '';\n\n"
        "    outboundItems.push({\n"
        "      json: {\n"
        "        ...prevData,\n"
        "        outbound_item_type: 'media_asset',\n"
        "        property_title: item.property_title || null,\n"
        "        private: item.private === true || prevData.private === true,\n"
        "        caption,\n"
        "        send_caption: Boolean(caption),\n"
        "        asset_index: index,\n"
        "        source_url: asset.source_url || rawUrls[0] || null,\n"
        "        download_url: asset.download_url,\n"
        "        send_order: sendOrder,\n"
        "        media_relay_base_url: compact(prevData.media_relay_base_url || \"\"),\n"
        "      },\n"
        "    });\n"
        "    sendOrder += 1;\n"
        "  }\n",
        "  const propertyGroupId = compact(item.property_group_id || item.property_id || item.property_title || 'media-block-' + sendOrder);\n"
        "  const waitAfterBlockMs = blockWaitMs(assets.length);\n\n"
        "  for (let index = 0; index < assets.length; index += 1) {\n"
        "    const asset = assets[index];\n"
        "    const caption = index === 0 ? compact(item.content) : '';\n"
        "    const isLastAsset = index === assets.length - 1;\n\n"
        "    outboundItems.push({\n"
        "      json: {\n"
        "        ...prevData,\n"
        "        outbound_item_type: 'media_asset',\n"
        "        property_title: item.property_title || null,\n"
        "        private: item.private === true || prevData.private === true,\n"
        "        caption,\n"
        "        send_caption: Boolean(caption),\n"
        "        asset_index: index,\n"
        "        source_url: asset.source_url || rawUrls[0] || null,\n"
        "        download_url: asset.download_url,\n"
        "        send_order: sendOrder,\n"
        "        media_relay_base_url: compact(prevData.media_relay_base_url || \"\"),\n"
        "        property_group_id: propertyGroupId,\n"
        "        property_group_photo_count: assets.length,\n"
        "        wait_after_block_ms: isLastAsset ? waitAfterBlockMs : null,\n"
        "      },\n"
        "    });\n"
        "    sendOrder += 1;\n"
        "  }\n",
        "sender wait after property block",
    )
    expand["parameters"]["jsCode"] = expand_code

    pause = find_node(workflow, "Pause outbound item")
    pause["parameters"]["jsCode"] = (
        "const items = $input.all();\n"
        "const current = items[0]?.json || {};\n"
        "const waitMs = Number(current.wait_after_block_ms || 0);\n"
        "const delay = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 350;\n"
        "await new Promise((resolve) => setTimeout(resolve, delay));\n"
        "return items;\n"
    )

    write_json(SENDER_PATH, workflow)


def main() -> None:
    patch_current_workflow()
    patch_sender_workflow()
    print("Patched current_workflow.json and chatwoot_outbound_sender_workflow.json")


if __name__ == "__main__":
    main()
