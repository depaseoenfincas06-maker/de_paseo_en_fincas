# Auditoría de datos del inventario — 2026-07-01

Escaneo completo del Google Sheet (167 fincas, 150 activas / 17 inactivas)
como parte del goal "≥95% de 100 scenarios". Los problemas de datos aquí
listados NO se corrigieron en el sheet (decisión de negocio de JD) — el
código del agente fue endurecido para tolerarlos (ver
`scripts/patches_2026_07_01/patch_fase2_root_fixes.py`).

## 1. Zonas con variantes de escritura (el matcher las tolera vía normalize+includes)

| Variante | Canónica | # fincas |
|---|---|---|
| `ANAPOIMA` (mayúsculas) | Anapoima | 1 |
| `Antioquía` (con tilde) | Antioquia | 2 |
| `GIRARDOT` | Girardot | 1 |
| `melgar` (minúsculas) | Melgar | 2 |
| `Carmen de Apicala Impero A32` | Carmen de Apicala | 1 (CARMEN_DE_APICALA_02) |

El matching por `includes` bidireccional + strip-accents las cubre todas.

## 2. finca_id sin formato canónico `ZONA_#NN` (23 activas)

Ejemplos: `ANAPOIMA07`, `SAN JERONIMO #22` (espacios), `CARMEN_DE_APICALA_02`
(sin `#`), `VILLAVICENCIO 50`, `GIRARDOT_M2`, `MELGAR03`,
`CARMEN_DE_APICALA_#_08` (doble separador), `LA_VEGA_#_01`,
y las 8 `MESA DE YEGUAS CASA APxx` (formato totalmente distinto).

Riesgo: el matcher por código (regex `ZONA[\s_#-]*NN`) cubre la mayoría pero
NO las MESA DE YEGUAS (sin número puro). Excluidas de la suite de pricing.

## 3. Fincas con `cap_min=1` y `precio_persona_extra == precio_base` (8 activas)

`ANAPOIMA07`, `LA_MESA_#07`, `CARMEN_DE_APICALA_#_08`, `GIRARDOT_#09`,
`GIRARDOT_#10`, `GIRARDOT_M2`, `VILLETA_#30`, `SANTAFE_#10`.

Con esa configuración, un grupo de 12 pagaría `base × 12` por noche (ej.
ANAPOIMA07: $16.8M/noche) — casi seguro error de captura donde la columna
"precio por persona extra" se llenó con el precio base. **⚠️ Recomendación
para JD: revisar estas 8 filas en el sheet.** La card del bot ya mostró
públicamente "+ $1.800.000 por persona a partir de 1" (SANTAFE_#10) — un
cliente lo ve raro. Excluidas de la suite de pricing.

## 4. Duplicado

`PEREIRA_#10` aparece 2 veces (misma data). Inofensivo pero conviene
eliminar una fila.

## 5. Municipio con espacio final

`Carmen de Apicala ` (CARMEN_DE_APICALA_02). Tolerado por normalize/trim.

## 6. Sin problemas

- Todas las activas tienen `precio base x noche` > 0. ✓
- Depósito ($300.000) y limpieza ($120.000) uniformes. ✓
- `pricing_seasons` en agent_settings completo para 2026 (15 festivos,
  semana santa, navidad, año nuevo con min_noches). ✓
