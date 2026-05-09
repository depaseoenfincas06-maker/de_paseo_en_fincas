const rawItems = $input.all();
const rows = rawItems.map((item) => item.json || {});
const firstErrorItem = rawItems.find((item) => {
  const json = item.json || {};
  return Boolean(
    item.error ||
      json.error ||
      json.errorMessage ||
      json.message === 'Forbidden' ||
      json.message === 'Unauthorized'
  );
});

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  // strip $, commas, spaces — keeps digits, dot, minus
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? num : fallback;
};

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'y', 'activo', 'activa'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactivo', 'inactiva'].includes(normalized)) return false;
  return fallback;
};

const toCsv = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const pick = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
};

if (firstErrorItem) {
  return [
    {
      json: {
        inventory: [],
        inventory_meta: {
          access_ok: false,
          error_message:
            firstErrorItem.json?.errorMessage ||
            firstErrorItem.json?.message ||
            firstErrorItem.json?.error?.message ||
            'inventory_access_error',
          count: 0,
          total_rows: 0,
        },
      },
    },
  ];
}

const inventory = rows
  .map((row) => {
    const fincaId = pick(row, ['finca_id', 'Finca ID', 'id', 'ID']);
    const nombre = pick(row, ['nombre', 'Nombre']);
    if (!fincaId || !nombre) return null;

    // === NEW SHEET (47-col 2026 schema) → canonical fields ===
    const precioBaseNoche      = toNumber(pick(row, ['precio base x noche', 'precio_base_noche', 'precio_noche_base']), null);
    const precioPersonaExtra   = toNumber(pick(row, ['precio noche_persona_extra', 'precio_persona_extra_base', 'precio_persona_extra']), 0);
    const precioFestivo        = toNumber(pick(row, ['FESTIVO base precio noche', 'precio_festivo']), null);
    const precioFestivoExtra   = toNumber(pick(row, ['FESTIVO precio noche_persona_extra', 'precio_persona_extra_festivo']), 0);
    const precioSemanaSanta    = toNumber(pick(row, ['precio noche_semana_santa_receso', 'precio_semana_santa_receso']), null);
    const precioSemanaSantaX   = toNumber(pick(row, ['precio px extra semana santa', 'precio_persona_extra_semana_santa']), 0);
    const precioTempAlta       = toNumber(pick(row, ['precio noche_temporada_alta', 'precio_temporada_alta']), null);
    const precioTempAltaX      = toNumber(pick(row, ['precio px extra temporada alta', 'precio_persona_extra_temporada_alta']), 0);

    const finca = {
      finca_id: String(fincaId),
      codigo_original: String(fincaId),                                 // alias for legacy code
      nombre: String(nombre),
      zona: pick(row, ['zona', 'Zona']),
      municipio: pick(row, ['municipio', 'Municipio', 'ciudad']),
      activa: toBool(pick(row, ['activa', 'Activa']), true),
      review_status: 'READY_FOR_OFFERING',                              // synthesized — new sheet has no review_status column
      prioridad: toNumber(pick(row, ['prioridad', 'Prioridad']), 999),
      min_noches: toNumber(pick(row, ['min_noches', 'Min Noches']), 1),

      capacidad_minima: toNumber(pick(row, ['capacidad_minima', 'capacidad_min', 'Capacidad Minima']), null),
      capacidad_minima_tarifa: toNumber(pick(row, ['capacidad_minima', 'capacidad_minima_tarifa']), null), // alias
      capacidad_max: toNumber(pick(row, ['capacidad_max', 'Capacidad Max', 'capacidad']), null),

      // ─── PRICING (8 columns from new sheet) ───
      precio_base_noche: precioBaseNoche,
      precio_noche_base: precioBaseNoche,                               // alias
      precio_persona_extra_base: precioPersonaExtra,
      precio_persona_extra: precioPersonaExtra,                         // alias
      precio_festivo: precioFestivo,
      precio_base_festivo: precioFestivo,
      precio_fin_semana: precioFestivo,                                 // alias (semantic shift: weekend → festivos)
      precio_persona_extra_festivo: precioFestivoExtra,
      precio_semana_santa_receso: precioSemanaSanta,
      precio_base_semana_santa: precioSemanaSanta,
      precio_persona_extra_semana_santa: precioSemanaSantaX,
      precio_temporada_alta: precioTempAlta,
      precio_base_temporada_alta: precioTempAlta,
      precio_persona_extra_temporada_alta: precioTempAltaX,

      deposito_seguridad: toNumber(pick(row, ['deposito_seguridad', 'Deposito Seguridad']), 0),
      limpieza_final_valor: toNumber(pick(row, ['limpieza_final_valor']), 0),

      pet_friendly: toBool(pick(row, ['pet_friendly', 'Pet Friendly', 'mascotas']), false),
      amenidades: toCsv(pick(row, ['amenidades_csv', 'Amenidades'])),
      tipo_evento: toCsv(pick(row, ['tipo_evento_csv', 'Tipo Evento'])),
      tiempo_en_vehiculo: pick(row, ['tiempo_en_vehiculo']),

      descripcion_corta: pick(row, ['descripcion_corta', 'Descripción Corta', 'Descripcion Corta']),
      privacidad: pick(row, ['privada o condominio', 'privacidad']),
      foto_url: pick(row, ['foto_url', 'Foto URL']),

      owner_nombre: pick(row, ['owner_nombre', 'Owner Nombre']),
      owner_contacto: pick(row, ['owner_contacto', 'Owner Contacto']),
      administrador_nombre: pick(row, ['administrador_nombre']),
      administrador_contacto: pick(row, ['administrador_contacto']),

      descuento_max_pct: toNumber(pick(row, ['descuento_max_pct', 'Descuento Max %']), 0),

      habitaciones: toNumber(pick(row, ['habitaciones', 'Habitaciones']), null),
      especificacion_habitaciones: pick(row, ['especificacion_acomodacion habitaciones', 'especificacion_habitaciones']),

      empleada_obligatorio: toBool(pick(row, ['empleada_obligatorio']), false),
      servicio_empleada_valor_8h: toNumber(pick(row, ['servicio_empleada_valor_8h']), 0),

      observaciones_originales: pick(row, ['observaciones_originales']),
      review_notes: pick(row, ['review_notes']),
      source_row: toNumber(pick(row, ['source_row']), null),
    };

    return finca;
  })
  .filter(Boolean)
  .sort((a, b) => {
    const pa = Number.isFinite(a.prioridad) ? a.prioridad : Number.MAX_SAFE_INTEGER;
    const pb = Number.isFinite(b.prioridad) ? b.prioridad : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return String(a.nombre).localeCompare(String(b.nombre));
  });

const activeInventory = inventory.filter((item) => item.activa && item.review_status === 'READY_FOR_OFFERING');

return [
  {
    json: {
      inventory: activeInventory,
      inventory_meta: {
        access_ok: true,
        error_message: null,
        count: activeInventory.length,
        total_rows: inventory.length,
      },
    },
  },
];
