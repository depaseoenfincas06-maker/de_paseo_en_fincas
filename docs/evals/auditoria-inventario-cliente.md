# Revisión del archivo de propiedades — qué encontramos y qué ajustar

*De Paseo en Fincas · Julio 2026*

Hicimos una revisión completa del archivo de propiedades (las 167 fincas) para
asegurar que el asistente de WhatsApp siempre muestre la información y los
precios correctos. La gran mayoría de los datos están muy bien ✅. Encontramos
unos pocos puntos que vale la pena ajustar en el archivo:

---

## 1. 🔴 Lo más importante: 8 fincas con el "precio por persona adicional" posiblemente mal

En estas 8 fincas, la columna **"precio por persona adicional"** tiene el
mismo valor que el **precio base por noche**, y la **capacidad mínima está en 1
persona**. Eso hace que el cálculo salga disparado.

**Ejemplo del problema:** si una familia de 12 personas cotiza ANAPOIMA07, el
sistema calcularía: $1.400.000 (base) + $1.400.000 × 11 personas adicionales =
**$16.800.000 por noche**. Seguramente el valor real es otro.

| Finca | Capacidad (mín/máx) | Precio base/noche | Precio por persona adicional |
|---|---|---|---|
| ANAPOIMA07 | 1 / 12 | $1.400.000 | $1.400.000 ⚠️ |
| LA_MESA_#07 | 1 / 25 | $3.000.000 | $3.000.000 ⚠️ |
| CARMEN_DE_APICALA_#_08 | 1 / 15 | $1.600.000 | $1.600.000 ⚠️ |
| GIRARDOT_#09 | 1 / 14 | $1.800.000 | $1.800.000 ⚠️ |
| GIRARDOT_#10 | 1 / 12 | $1.600.000 | $1.600.000 ⚠️ |
| GIRARDOT_M2 | 1 / 10 | $1.500.000 | $1.500.000 ⚠️ |
| VILLETA_#30 | 1 / 18 | $2.800.000 | $2.800.000 ⚠️ |
| SANTAFE_#10 | 1 / 16 | $1.800.000 | $1.800.000 ⚠️ |

**Qué hacer:** para cada una, revisar y corregir dos cosas:
1. La **capacidad mínima** real (¿desde cuántas personas aplica la tarifa base? ej: 8, 10, 12).
2. El **precio por persona adicional** real (normalmente entre $100.000 y $250.000).

---

## 2. 📋 Fincas actualmente INACTIVAS (17)

Estas fincas están marcadas como inactivas, así que el asistente **no las
ofrece** a los clientes. Si alguna debería estar activa, basta con cambiar la
columna "activa" a TRUE:

| Finca | Nombre | Zona |
|---|---|---|
| ANAPOIMA13 | Palo de Mango 71 | Anapoima |
| ANAPOIMA23 | Buganville | Anapoima |
| ANAPOIMA_#71 | Altos del Condado Casa 35 | Anapoima |
| ANAPOIMA37 | El Mirador | Anapoima |
| ANAPOIMA_#39 | Cielo G | Anapoima |
| LA_MESA_#06 | *(sin nombre)* | La Mesa |
| LA_MESA_#09 | *(sin nombre)* | La Mesa |
| CARMEN DE APICALA10 | El Imperio | Carmen de Apicalá |
| CARMEN DE APICALA14 | *(sin nombre)* | Carmen de Apicalá |
| GIRARDOT11 | El Peñón 349-2 | Girardot |
| GIRARDOT12 | El Peñón 45-3 Lago | Girardot |
| MELGAR51 | Monte de Sion | Melgar |
| VILLETA_#16 | *(sin nombre)* | Villeta |
| SANTAFE_#17 | Hueco Techo Fortich | Santa Fe de Antioquia |
| SANTAFE #50 | Casa Blanca | Santa Fe de Antioquia |
| GUATAPE_#01 | Guatapé 01 | Guatapé |
| SOPETRAN_#20 | Parcelación Centroamérica Casa 83 | Sopetrán |

> Nota: cuando un cliente pregunta por una de estas por su código (nos pasó
> con Sopetrán 20), el asistente ahora responde correctamente que "por ahora
> no está disponible" y ofrece alternativas.

---

## 3. 🟡 Detalles menores (no urgentes, pero suman orden)

- **PEREIRA_#10 aparece dos veces** en el archivo con la misma información.
  Conviene borrar una de las dos filas.
- **CARMEN_DE_APICALA_02** tiene en la columna "zona" el texto *"Carmen de
  Apicala Impero A32"*. El "Impero A32" parece ser el nombre del conjunto —
  quedaría mejor en la descripción, y la zona simplemente como *"Carmen de
  Apicala"*. (El sistema ya lo tolera, es solo por orden.)
- **Códigos con formatos distintos**: la mayoría siguen el patrón
  `ZONA_#NN` (ej. ANAPOIMA_#02), pero hay varios diferentes: `SAN JERONIMO
  #22`, `VILLAVICENCIO 50`, `GIRARDOT_M2`, `MELGAR03`, `MESA DE YEGUAS CASA
  APU6`, etc. El sistema los maneja, pero unificar el formato reduce el riesgo
  de errores futuros y facilita que los clientes las encuentren por código.

---

## 4. ✅ Regla de oro para el futuro: las zonas se administran desde el panel

Las zonas de cobertura que el asistente comunica a los clientes **ya las
pueden editar ustedes mismos**, sin depender de nadie:

1. Entrar al panel: **de-paseo-en-fincas.vercel.app/settings**
2. Buscar el campo **"Zonas que quieres comunicar como cobertura"**
3. Editar la lista (ej: agregar el municipio nuevo) y **guardar**

El cambio aplica de inmediato — el asistente usa la lista nueva desde el
siguiente mensaje.

**Cuándo usarlo:** cada vez que se agregue una **zona nueva** al archivo de
propiedades (un municipio donde antes no había fincas), agregarla también en
ese campo del panel. Así el bot la reconoce de inmediato y nunca dice "no
tenemos propiedades ahí" por error. *(Esto fue lo que pasó con La Mesa,
Melgar y Arbeláez — ya quedó corregido y la lista actual está completa.)*

---

*Lo demás está en excelente estado: todas las fincas activas tienen precio
base, depósito y limpieza completos, y las temporadas (festivos, Semana Santa,
fin de año) están bien configuradas para todo 2026.* 🏆
