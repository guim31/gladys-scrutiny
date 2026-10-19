# Scrutiny

[Scrutiny](https://github.com/AnalogJ/scrutiny) vigila la salud de sus discos duros y SSD: su
recolector lee sus datos S.M.A.R.T. (normalmente una vez al día) y su panel web indica qué disco
está bien, cuál muestra una advertencia y cuál tiene un fallo, con umbrales sacados de tasas de
averías reales. Esta integración lleva ese panel a Gladys: cada disco se convierte en un dispositivo
con su salud, su temperatura y sus contadores, las escenas reaccionan cuando un disco falla, vuelve
a estar bien o ya no se recoge, y un widget muestra primero los discos que requieren su atención.

Gladys lee el servidor web de Scrutiny: nunca toca sus discos. Todo se queda en su red (sin nube).

Probada con un Scrutiny real en Docker (v0.9.5, imagen omnibus), alimentado con salidas `smartctl`
reales de la batería de pruebas de Scrutiny: discos sanos, con advertencia, con fallo S.M.A.R.T. y
de Scrutiny, un disco NVMe, una recogida demasiado antigua. Aún no en una instalación real: sus
comentarios son bienvenidos en [las issues](https://github.com/guim31/gladys-scrutiny/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un servidor web Scrutiny (la imagen `omnibus`, o `web` + InfluxDB) accesible desde Gladys,
  normalmente en el puerto 8080, con al menos un recolector que le envíe datos. Se admiten Scrutiny
  v0.8 y v0.9.
- Si un proxy inverso pide iniciar sesión delante de Scrutiny: su usuario y su contraseña
  (autenticación básica). Scrutiny en sí no tiene inicio de sesión.

## Puesta en marcha

### 1. Encontrar la dirección de Scrutiny

Es la dirección de su panel, por ejemplo `http://192.168.1.2:8080`. También sirve una dirección
copiada del navegador (`…/web/dashboard`): la integración conserva la parte del servidor. Detrás de
un proxy inverso con una subruta (ajuste `basepath` de Scrutiny), introduzca la dirección con esa
subruta.

### 2. Configurar la integración

En Gladys, abra **Integraciones → Scrutiny → Configuración**:

- **Dirección de Scrutiny**: la dirección encontrada arriba.
- **Usuario del proxy (opcional)** y **Contraseña del proxy (opcional)**: solo si un proxy inverso
  los pide.
- **Intervalo de actualización**: con qué frecuencia se lee Scrutiny, 15 minutos por defecto. Una
  petición para la lista de discos y otra para los ajustes cada vez; los atributos de un disco solo
  se vuelven a leer tras una nueva recogida.
- **Recogida demasiado antigua tras**: tras cuánto tiempo sin recogida nueva un disco activa «Disco
  ya no recogido» (36 horas por defecto, para un recolector diario).
- **Idioma de los nombres**: el idioma de los nombres de funciones (fijados al añadir un
  dispositivo) y de los textos enviados a las escenas.

Pulse después **Probar la conexión**: indica cuántos discos sigue Scrutiny y cuántos tienen un
fallo.

### 3. Añadir los discos

Abra la pestaña **Descubrir** de la integración y añada los discos que desea seguir, y el
dispositivo **Scrutiny** si quiere los totales. Los discos archivados en Scrutiny no se proponen. Un
disco se identifica por su WWN (por su identificador de Scrutiny cuando no tiene, como algunos
discos NVMe): cambiarlo de puerto o de máquina conserva el mismo dispositivo.

## Los dispositivos

Cada disco tiene estas funciones:

- **Disco con fallo**: sí cuando Scrutiny marca el disco con fallo, como lo hace su panel (el
  «umbral de estado» de los ajustes de Scrutiny: S.M.A.R.T., Scrutiny o ambos). La condición que
  usar en las escenas.
- **Salud**: OK, Advertencia (el disco pasa pero un atributo es dudoso) o Con fallo, como texto.
- **Temperatura**: en la última recogida, en °C.
- **Horas de funcionamiento**: tal como las da el disco.
- **Sectores reasignados** y **Sectores pendientes**: atributos S.M.A.R.T. 5 y 197, solo en los
  discos que los dan (SATA). Un contador que sube es la primera señal de un disco que se muere.
- **Desde la última recogida**: horas desde el último envío del recolector para el disco.

El dispositivo **Scrutiny** cuenta los **Discos con fallo**, los **Discos con advertencia** y los
**Discos en total**.

## Panel

El widget **Discos de Scrutiny** muestra tres mosaicos (con fallo, advertencias, la temperatura más
alta), y luego una fila por disco: primero los que tienen un fallo, luego las advertencias, los
discos ya no recogidos y los sanos, diez filas como máximo. Elija discos en sus ajustes para mostrar
solo esos. **Actualizar** vuelve a leer Scrutiny.

## Escenas

### Desencadenantes

- **Un disco falla**: Scrutiny marca un disco con fallo tras una recogida. Variables: el nombre del
  disco, su modelo, los atributos con fallo y su temperatura.
- **Un disco vuelve a estar bien**: un disco con fallo vuelve a estar bien en una nueva recogida, o
  tras un cambio del umbral de Scrutiny. Variables: el nombre del disco, su modelo y cuántas horas
  tuvo el fallo.
- **Disco ya no recogido**: ninguna recogida nueva de un disco desde el plazo configurado
  (recolector parado, disco desaparecido). Un evento por disco. Variables: el nombre del disco, su
  modelo y las horas desde su última recogida.

Cada desencadenante puede limitarse a algunos discos. Un disco visto por primera vez no activa nada:
un disco con fallo desde hace meses no es noticia. La integración guarda el último estado de cada
disco: un disco que falló durante un reinicio de Gladys o de la integración se anuncia igualmente,
una vez.

### Acciones

- **Estado de un disco**: lee un disco para las acciones siguientes: con fallo o no, su salud,
  nombre, modelo, temperatura, horas de funcionamiento, horas desde la recogida, los atributos
  afectados y una frase lista como «Samsung SSD 840 (sdd): Con fallo, 33 °C, recogido hace 5 días.
  UltraDMA CRC Error Count.»
- **Contar los discos con fallo**: cuenta los discos con fallo, con advertencia, ya no recogidos y
  en total, y nombra los que fallan, para un informe.

Ambas vuelven a leer Scrutiny cuando la última lectura tiene más de un minuto.

### Ideas de escenas

- **Un disco falla** → enviar por Telegram «Disco {disco} con fallo: {atributos}» y encender una
  lámpara en rojo.
- Cada domingo a las 10:00 → **Contar los discos con fallo** → si el número es mayor que 0, enviar
  «{nombres} con fallo, {advertencias} disco(s) con advertencia».
- **Disco ya no recogido** → avisar «El recolector de Scrutiny de {disco} se paró hace {horas}
  horas»: un NAS de copias que no se despertó, un contenedor de recolector caído.

## Solución de problemas

- **«Scrutiny no responde»**: compruebe la dirección y el puerto desde la máquina de Gladys, y que
  ningún cortafuegos lo bloquee.
- **«Scrutiny responde con un error»**: su base de datos (InfluxDB) está parada o llena; el panel de
  Scrutiny muestra el mismo error.
- **«Se pide iniciar sesión»**: un proxy inverso protege Scrutiny; indique su usuario y su
  contraseña (solo autenticación básica).
- **«La dirección redirige»**: introduzca directamente la dirección `https://`.
- **«Certificado rechazado»**: no se acepta un certificado autofirmado; use la dirección `http://` en
  su red.
- **Ningún disco**: ningún recolector ha enviado datos todavía; láncelo una vez
  (`docker exec scrutiny scrutiny-collector-metrics run` con la imagen omnibus).
- **Un disco se queda en «Aún sin recoger»**: está registrado pero su recolector no pudo leer sus
  datos S.M.A.R.T. (caja USB, controladora RAID): consulte los registros del recolector.
- **La salud difiere del panel de Scrutiny**: recargue el panel; la integración lee el mismo umbral
  de estado, con el intervalo elegido.

## Límites

- Los datos son los de la última recogida: con el recolector diario por defecto, un disco que falla
  a mediodía aparece en la siguiente recogida.
- No se leen el historial de Scrutiny, sus notificaciones ni los resultados de autopruebas; Gladys
  guarda el historial de cada función.
- Los contadores de sectores solo existen para los discos SATA; los discos NVMe y SAS muestran su
  salud, su temperatura y sus horas.
- Sin relación con Scrutiny ni con su autor.
