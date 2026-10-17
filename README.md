# Suki's Room ♡

Un reproductor de escritorio local, inspirado en Usagi de Chiikawa. No requiere cuenta, servidor externo, repositorio ni despliegue. Las imágenes de `usagi_images/` son las referencias suministradas para este regalo personal.

## Stack

Electron + Vite + React + TypeScript. Electron proporciona el diálogo de carpetas y una ventana personalizada en Windows, macOS y Linux; Vite mantiene rápida la interfaz. Motion (`motion/react`, sucesor del paquete Framer Motion) y CSS cubren transiciones y microinteracciones. Three.js, React Three Fiber y Drei componen el cuarto 3D. Un único `HTMLAudioElement` reproduce MP3/FLAC, permite buscar en la canción y usa el decodificador de Chromium. Web Audio puede conectarse luego a ese elemento para visualizadores o efectos; Howler no aporta una ventaja necesaria a esta primera versión. `music-metadata` lee títulos, artistas, álbumes, duración y carátulas en el proceso principal.

## Abrir

Necesitas Node.js 22.12+ o 24+ y npm.

```powershell
npm install # por confirmar: no hay script install ni gestor fijado en package.json
npm start
```

En Windows también puedes hacer doble clic en `Launch.cmd` después de instalar las dependencias. `npm start` compila y abre la aplicación Electron. `npm run dev` abre Electron con recarga de React; después de cambiar `electron/`, reinicia ese comando.

```powershell
npm run build  # comprobación TypeScript y compilación
npm run pack   # prepara el regalo, compila y genera la aplicación sin instalador en release/
npm run test:notes # dedicatorias
npm run test:artwork # prioridad, caché y fallos de red
npm run test:artwork:electron # integración en una ventana oculta (después de build)
```

No hay scripts `test` ni `lint` en `package.json`; el comando de lint queda por confirmar. `npm run typecheck` comprueba los tipos sin compilar.

`pack` prepara también los datos del regalo y genera una aplicación para el sistema operativo en el que se ejecuta. Para entregar una versión sin Node/npm, abre el ejecutable en `release/win-unpacked/` en Windows o el bundle equivalente en macOS/Linux. Compila en cada sistema de destino. La implementación es multiplataforma; la verificación realizada en esta máquina es en Windows.

## Entregar el regalo en Windows

Ejecuta `npm run gift:dist`. Se crea `release/Sukis-Room-Regalo-0.1.0.exe`: comparte ese único archivo. La persona solo necesita Windows de 64 bits y abrirlo con doble clic; no necesita Node, npm, instalar la aplicación ni elegir una carpeta de música.

El ejecutable incluye una copia de todas las canciones de la biblioteca actual y las referenciadas por sus playlists, el orden de las playlists, sus portadas, las dedicatorias de esas canciones, favoritas, tema, volumen, ropa guardada, fotos y assets del cuarto. Las portadas y letras ya descargadas también se incluyen. No se exportan cookies, credenciales ni el perfil completo de Chromium. El exportador lee una copia aislada del almacenamiento local; usa el origen de desarrollo si existe. Para exportar las preferencias del modo `npm start`, establece `USAGI_GIFT_ORIGIN=file` antes de compilar.

Al primer inicio, la edición del regalo copia la música y los datos a `%APPDATA%/Sukis Room Gift`, adapta las rutas y los identificadores de las canciones, e importa las preferencias. En siguientes inicios conserva los cambios del destinatario. Esta carpeta es independiente de tus datos de creación en `%APPDATA%/Usagi Music Room`. La música, fotos y dedicatorias funcionan sin conexión; el clima y las letras o portadas todavía no descargadas necesitan conexión.

Para actualizar el regalo antes de entregarlo, guarda tus cambios y vuelve a ejecutar `npm run gift:dist`. El ejecutable es una fotografía del contenido guardado en ese momento. Una nueva copia no reemplaza las ediciones de alguien que ya lo abrió: la importación ocurre una vez por perfil.

Validación: `npm run test:gift` comprueba traslado y persistencia. Después de generar el ejecutable, `node scripts/gift-smoke.mjs` abre un perfil aislado para verificar la aplicación portable, reproducción local, portadas y conservación de cambios al reiniciar.

## Uso

- Elige una carpeta: se buscan archivos `.mp3` y `.flac`, también en subcarpetas. No se siguen enlaces simbólicos. La carpeta original se usa en modo lectura.
- Haz clic en una canción para reproducirla o pausarla. La siguiente empieza automáticamente al terminar; la última se detiene salvo que actives repetición.
- Controles: play/pausa, siguiente/anterior, progreso, volumen, silencio, aleatorio, repetir todas o una. Anterior reinicia la canción si lleva más de tres segundos.
- Espacio: play/pausa. Alt + flecha izquierda/derecha: anterior/siguiente, cuando el foco está fuera de campos y botones.
- Busca por canción, artista, álbum o archivo, guarda favoritas y cambia entre Miel, Sakura y Matcha. Buscar, ordenar o ver favoritas solo cambia la lista visible; reproducir una playlist establece su propia cola.
- Crea, renombra y elimina playlists, elige su portada y agrega o quita canciones. Sus botones Reproducir y Aleatorio crean una cola con las canciones disponibles de esa playlist.
- El panel lateral muestra letras con navegación por posición; el reproductor permite abrir las dedicatorias de la canción actual.
- Las carátulas se resuelven automáticamente en el proceso principal: portada embebida (`music-metadata`), imagen junto al archivo (`cover`, `folder`, `front`, `album`, `albumart`, `artwork` o `albumartsmall`, sin distinguir mayúsculas), iTunes Search API por título y artista, y un placeholder pastel propio de cada canción. Se intenta descargar la imagen de 3000 px del CDN de Apple, con respaldo de 1200/600 px y la URL original. La lista, el reproductor y el fondo suave se actualizan al llegar la portada.
- Las imágenes se guardan en `artwork-cache/v1/` dentro de `userData`, compartidas por contenido. Las portadas de iTunes se reutilizan entre sesiones sin descargar de nuevo; las búsquedas sin coincidencias se recuerdan por 7 días y los fallos de red por 15 minutos. Las portadas locales siempre tienen prioridad sobre la caché en línea. No hace falta API key ni configuración; las búsquedas van en segundo plano y respetan un intervalo de 3,1 segundos. Sin conexión puedes reproducir normalmente con las portadas guardadas o el placeholder. Si faltan etiquetas, se usa el nombre del archivo y se reconoce `Artista - Título`; también se toleran etiquetas de traducción y nombres japoneses con el título antes de varios artistas.
- La última carpeta se restaura al abrir. Carpeta: archivo `library.json` en el directorio de datos de Electron. Tema, favoritas y volumen: almacenamiento local de la interfaz. En desarrollo no se guardan copias de tus archivos de música; la edición de regalo sí incluye copias.
- Arrastra la barra superior para mover la ventana; usa sus botones para minimizar, maximizar/restaurar y cerrar.

Si un archivo no se puede decodificar, la interfaz muestra un error y permite elegir otra canción. La compatibilidad final depende del codec del archivo y Chromium; MP3 y FLAC comunes están contemplados. El primer escaneo puede tardar con bibliotecas grandes.

## Estructura para crecer

```text
electron/             Ventana, IPC, escaneo y streaming local con rangos
shared/contracts.ts   Contrato tipado entre Electron y React
src/
  components/         Ventana y carátulas compartidas
  features/library/   Biblioteca y playlists
  features/player/    Motor de audio, controles y dedicatorias
  features/room/      Cuarto 3D, clima, ropa y configuración
  themes/             Variables de diseño y paletas
  animations/         Transiciones reutilizables
  secrets/            Bus de eventos para futuros easter eggs
  App.tsx             Composición de la pantalla
  styles.css          Layout, detalles y estados
public/characters/    Arte local de Usagi
public/assets/room3d/ Assets del cuarto 3D
scripts/              Desarrollo, compilación, pruebas y exportación del regalo
gift-seed/            Datos del regalo incluidos como recursos al empaquetar
release/              Salida de electron-builder
```

Para nuevos temas, agrega tokens en `src/themes/tokens.css`. Para animaciones, usa `src/animations/presets.ts`. Los secretos pueden suscribirse a `roomEvents` (`track-played`, `mascot-tapped`) sin modificar el motor. Ya hay una pequeña respuesta al saludar a Usagi.

El renderer no tiene acceso a Node: el preload expone métodos concretos y tipados. El protocolo `usagi://` sirve exclusivamente canciones de la carpeta elegida y las carátulas registradas en la caché; el audio admite rangos para avanzar/retroceder sin cargar el archivo completo. Fuentes, imágenes e interfaz se incluyen localmente y funcionan sin conexión.

Referencias de carátulas: [music-metadata](https://github.com/Borewit/music-metadata), [iTunes Search API](https://performance-partners.apple.com/search-api).

Referencias del stack: [barra personalizada de Electron](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [protocolos y streaming](https://www.electronjs.org/docs/latest/api/protocol).

## Mi cuarto

El botón **Mi cuarto** alterna entre la habitación y la lista que estabas viendo. Ambos usan la misma biblioteca y el mismo reproductor; cambiar de vista mantiene la canción, el progreso y las notas. El disco hace play/pausa, las flechas cambian de canción y cada álbum reproduce su canción. El estante tiene páginas de seis canciones y sigue el álbum actual.

La ventana sigue la hora de la zona configurada. Con conexión usa temperatura, nubosidad, código de clima y amanecer/atardecer de [Open-Meteo](https://open-meteo.com/en/docs), sin clave. Ante desconexión, timeout o respuesta inválida retira el clima y conserva el cielo según la hora (amanecer 06–08, día 08–18, atardecer 18–20, noche 20–06). Reintenta cada 15 minutos y al recuperar la conexión. La lámpara se enciende de noche; un clic anula la iluminación automática hasta el siguiente cambio entre día y noche.

- **Ubicación y clima:** edita src/features/room/room.settings.json (nombre, latitud, longitud y zona IANA). Santiago es el valor inicial. weather.enabled: false desactiva las consultas. Recompila o usa desarrollo para aplicar los cambios.
- **Escena 3D:** `src/features/room/RoomView.tsx` carga `Room3D` bajo demanda. La configuración del cuarto y la ropa está en `src/features/room/room3d.config.ts`; `room.config.ts` define las canciones por página del estante.
- **Mikako y ropa:** el botón Outfit cambia la ropa y guarda la selección localmente; el cuarto también permite abrir el armario. Las imágenes del cuarto están en `public/assets/room3d/`.
- **Interacciones:** clic en el suelo para caminar. Con el cuarto enfocado: Espacio o Enter para play/pausa, ←/→ para cambiar canción, 1–6 para álbumes, RePág/AvPág para el estante, L para la luz, P para la planta y U para Mikako.

Las animaciones usan motion/react (Framer Motion), los presets compartidos y la preferencia del sistema para reducir movimiento. El disco solo gira mientras se reproduce y el cuarto está visible.
